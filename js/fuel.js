/* window.App.fuel — macro targets + AI meal plan grounded in USDA data. */
window.App = window.App || {};
(function () {
  "use strict";
  var el, util;
  var sel = { hall: null, meals: { breakfast: false, lunch: true, dinner: false } };

  function boot() { el = App.util.el; util = App.util; }

  function render(container) {
    boot();
    container.innerHTML = "";
    container.appendChild(macroCard(container));
    container.appendChild(planCard(container));
  }

  // ------------------------------------------------------------- macro card
  function macroCard(container) {
    var m = App.store.state.settings.macros;
    function fld(k, label) {
      var i = el("input", { type: "number", inputmode: "numeric", value: m[k],
        onchange: function () { m[k] = App.util.num(i.value, m[k]); App.store.save(); } });
      return el("label", { class: "field" }, [label, i]);
    }
    return el("div", { class: "card" }, [
      el("h2", { text: "Daily macro targets" }),
      el("div", { class: "macro-grid" }, [
        fld("calories", "kcal"), fld("protein", "protein g"),
        fld("carbs", "carbs g"), fld("fat", "fat g")
      ]),
      el("p", { class: "muted small", style: "margin:8px 0 0",
        text: "Default is tuned for a 180→165 lb cut (aggressive deficit, high protein). Adjust freely." })
    ]);
  }

  // -------------------------------------------------------------- plan card
  function planCard(container) {
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", { text: "Meal plan" }));

    var body = el("div", {});
    card.appendChild(body);

    App.menu.load().then(function (data) {
      body.innerHTML = "";
      var halls = App.menu.halls(data);
      if (!sel.hall || halls.indexOf(sel.hall) < 0) sel.hall = halls[0];

      body.appendChild(el("div", { class: "muted small", style: "margin-bottom:6px",
        text: "Menu for " + (data.date || "today") + " · source: " + (data.source || "?") }));

      // hall pills
      var hallRow = el("div", { class: "pill-row", style: "margin-bottom:8px" });
      halls.forEach(function (h) {
        hallRow.appendChild(el("button", { class: "pill", "aria-pressed": String(sel.hall === h),
          text: h, onclick: function () { sel.hall = h; render(container); } }));
      });
      body.appendChild(hallRow);

      // meal checkboxes
      var mealRow = el("div", { class: "row wrap", style: "margin-bottom:10px" });
      ["breakfast", "lunch", "dinner"].forEach(function (mk) {
        var cb = el("input", { type: "checkbox" });
        cb.checked = !!sel.meals[mk];
        cb.addEventListener("change", function () { sel.meals[mk] = cb.checked; });
        mealRow.appendChild(el("label", { class: "row small", style: "gap:6px;width:auto" },
          [cb, mk[0].toUpperCase() + mk.slice(1)]));
      });
      body.appendChild(mealRow);

      var out = el("div", {});
      var status = el("div", { class: "progress-note" });

      var btn = el("button", { class: "btn", text: "Generate meal plan", onclick: function () {
        var meals = Object.keys(sel.meals).filter(function (k) { return sel.meals[k]; });
        if (!meals.length) { util.toast("Pick at least one meal"); return; }
        if (!App.ai.hasKey()) { util.toast("Add your Anthropic API key in Settings"); return; }
        generate(sel.hall, meals, data, btn, status, out);
      } });
      body.appendChild(btn);
      body.appendChild(status);
      body.appendChild(out);

      // show cached plan if present
      var cacheKey = sel.hall + "|" + Object.keys(sel.meals).filter(function (k) { return sel.meals[k]; }).join(",");
      var cached = (App.store.state.fuelPlans[data.date] || {})[cacheKey];
      if (cached) renderPlan(cached, out, true);
    }).catch(function (e) {
      body.innerHTML = "";
      body.appendChild(el("div", { class: "err", text:
        "Could not load menu.json (" + (e.message || e) + ").\nRun the scraper / deploy so menu.json is present next to the app." }));
    });

    return card;
  }

  function generate(hall, meals, data, btn, status, out) {
    out.innerHTML = "";
    btn.disabled = true;
    var dishes = App.menu.dishesFor(data, hall, meals);
    if (!dishes.length) { status.textContent = "No dishes for that selection."; btn.disabled = false; return; }

    status.innerHTML = "<span class='spinner'></span>Looking up " + dishes.length + " dishes in USDA…";
    App.usda.searchMany(dishes, function (done, total) {
      status.innerHTML = "<span class='spinner'></span>USDA " + done + "/" + total + "…";
    }).then(function (usdaMap) {
      var matched = dishes.filter(function (d) { return usdaMap[d] && usdaMap[d].matched; }).length;
      status.innerHTML = "<span class='spinner'></span>USDA matched " + matched + "/" + dishes.length +
        ". Asking Claude to build the plan…";
      var payload = {
        hall: hall, meals: meals,
        targets: scaledTargets(meals),
        stats: statsLine(),
        dishes: dishes.map(function (d) { return { name: d, usda: usdaMap[d] }; })
      };
      return App.ai.mealPlan(payload);
    }).then(function (plan) {
      status.textContent = "";
      // cache
      var cacheKey = hall + "|" + meals.join(",");
      if (!App.store.state.fuelPlans[data.date]) App.store.state.fuelPlans[data.date] = {};
      App.store.state.fuelPlans[data.date][cacheKey] = plan;
      App.store.save();
      renderPlan(plan, out, false);
    }).catch(function (e) {
      status.textContent = "";
      out.appendChild(el("div", { class: "err", text: String(e.message || e) }));
    }).then(function () { btn.disabled = false; });
  }

  function scaledTargets(meals) {
    // split the daily target across selected meals with rough weights
    var w = { breakfast: 0.25, lunch: 0.375, dinner: 0.375 };
    var m = App.store.state.settings.macros;
    var frac = meals.reduce(function (a, k) { return a + (w[k] || 0.33); }, 0);
    frac = frac || 1;
    return {
      calories: Math.round(m.calories * frac),
      protein: Math.round(m.protein * frac),
      carbs: Math.round(m.carbs * frac),
      fat: Math.round(m.fat * frac)
    };
  }

  function statsLine() {
    var s = App.store.state.settings.stats;
    return s.height + ", " + s.weightLb + " lb, goal " + s.goalWeightLb + " lb. " + s.notes;
  }

  function renderPlan(plan, out, fromCache) {
    out.innerHTML = "";
    if (fromCache) out.appendChild(el("div", { class: "muted small", text: "Showing last saved plan for this selection." }));

    var wrap = el("div", { class: "card", style: "background:var(--surface-2)" });
    wrap.appendChild(el("h3", { text: (plan.meals || []).join(" + ") + " @ " + (plan.hall || "") }));

    (plan.items || []).forEach(function (it) {
      var isUsda = (it.source || "").toLowerCase().indexOf("usda") === 0;
      wrap.appendChild(el("div", { class: "plan-item" }, [
        el("div", { class: "pi-top" }, [
          el("span", { class: "pi-name" }, [
            document.createTextNode(it.dish + " "),
            el("span", { class: "badge " + (isUsda ? "usda" : "ai"), text: isUsda ? "USDA" : "AI est." })
          ]),
          el("span", { class: "pi-portion", text: (it.portion || "") + (it.grams ? " · " + it.grams + " g" : "") })
        ]),
        el("div", { class: "pi-macros", text:
          Math.round(it.calories) + " kcal · P " + r1(it.protein) + " · C " + r1(it.carbs) + " · F " + r1(it.fat) +
          (it.note ? "  — " + it.note : "") })
      ]));
    });

    var targets = scaledTargets(plan.meals || []);
    var tot = plan.totals || sumItems(plan.items);
    wrap.appendChild(totalsGrid(tot, targets));
    if (plan.notes) wrap.appendChild(el("p", { class: "muted small", style: "margin-top:10px", text: plan.notes }));
    out.appendChild(wrap);
  }

  function sumItems(items) {
    return (items || []).reduce(function (a, it) {
      a.calories += +it.calories || 0; a.protein += +it.protein || 0;
      a.carbs += +it.carbs || 0; a.fat += +it.fat || 0; return a;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }

  function totalsGrid(tot, target) {
    function cell(label, val, tgt, unit) {
      var d = Math.round(val - tgt);
      var cls = Math.abs(d) <= Math.max(3, tgt * 0.08) ? "ok" : (d > 0 ? "over" : "under");
      return el("div", { class: "t" }, [
        el("div", { class: "v", text: Math.round(val) + (unit || "") }),
        el("div", { class: "l", text: label }),
        el("div", { class: "d " + cls, text: (d >= 0 ? "+" : "") + d + " vs " + tgt })
      ]);
    }
    return el("div", { class: "totals" }, [
      cell("kcal", tot.calories, target.calories, ""),
      cell("protein", tot.protein, target.protein, "g"),
      cell("carbs", tot.carbs, target.carbs, "g"),
      cell("fat", tot.fat, target.fat, "g")
    ]);
  }

  function r1(n) { return Math.round((+n || 0) * 10) / 10; }

  App.fuel = { render: render };
})();
