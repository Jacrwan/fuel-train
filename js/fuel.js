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

      var dateLbl = data.date === App.util.todayISO() ? "Today" : (data.date || "");
      body.appendChild(el("div", { class: "muted small", style: "margin-bottom:8px" }, [
        document.createTextNode(dateLbl + "'s menu · " + (data.date ? App.util.prettyDate(data.date) : "")),
        data.source === "heuristic" ? el("span", { class: "faint", text: "  (fallback parse)" }) : null
      ]));

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
    if (!plan.extras) plan.extras = [];
    var rerender = function () { App.store.save(); renderPlan(plan, out, fromCache); };

    var eatenCount = (plan.items || []).filter(function (i) { return i.eaten; }).length +
      plan.extras.filter(function (e) { return e.eaten; }).length;
    var totalCount = (plan.items || []).length + plan.extras.length;

    var wrap = el("div", { class: "plan" });
    wrap.appendChild(el("div", { class: "row spread", style: "margin-bottom:10px" }, [
      el("h3", { style: "margin:0", text: (plan.meals || []).map(cap).join(" + ") + " · " + (plan.hall || "") }),
      el("span", { class: "faint small", text: eatenCount + " / " + totalCount + " eaten" })
    ]));

    (plan.items || []).forEach(function (it) {
      wrap.appendChild(planItemRow(it, false, rerender));
    });

    // --- ate something else ---
    wrap.appendChild(el("div", { class: "subhead", style: "margin-top:14px", text: "Ate something else" }));
    if (!plan.extras.length) {
      wrap.appendChild(el("p", { class: "faint small", style: "margin:0 0 8px",
        text: "Add anything you ate that wasn't suggested. Macros optional — filled ones count toward your eaten totals." }));
    }
    plan.extras.forEach(function (ex, i) {
      wrap.appendChild(planItemRow(ex, true, rerender, function () {
        plan.extras.splice(i, 1); rerender();
      }));
    });
    wrap.appendChild(extraForm(plan, rerender));

    // --- totals ---
    var targets = scaledTargets(plan.meals || []);
    var planned = plan.totals || sumMacros(plan.items);
    var eaten = sumEaten(plan);
    wrap.appendChild(totalsSection(eaten, planned, targets));

    if (plan.notes) wrap.appendChild(el("p", { class: "muted small", style: "margin-top:12px", text: plan.notes }));
    out.appendChild(wrap);
  }

  function planItemRow(it, isExtra, rerender, onRemove) {
    var name = it.dish || it.name || "";
    var hasMacros = [it.calories, it.protein, it.carbs, it.fat].some(function (v) { return +v > 0; });
    var isUsda = !isExtra && (it.source || "").toLowerCase().indexOf("usda") === 0;

    var cb = el("input", { type: "checkbox" });
    cb.checked = !!it.eaten;
    cb.addEventListener("change", function () { it.eaten = cb.checked; rerender(); });

    var meta = [];
    if (it.portion) meta.push(it.portion);
    if (it.grams) meta.push(it.grams + " g");
    var macroStr = hasMacros
      ? Math.round(it.calories || 0) + " kcal  ·  P " + r1(it.protein) + "  C " + r1(it.carbs) + "  F " + r1(it.fat)
      : (isExtra ? "no macros entered" : "");

    var nameChildren = [document.createTextNode(name)];
    if (!isExtra) nameChildren.push(el("span", { class: "badge " + (isUsda ? "usda" : "ai"), text: isUsda ? "USDA" : "AI est." }));
    if (isExtra && onRemove) nameChildren.push(el("button", { class: "linkx", text: "remove",
      onclick: function (e) { e.preventDefault(); e.stopPropagation(); onRemove(); } }));

    var body = el("div", { class: "grow", onclick: function (e) {
      if (e.target.closest("button")) return;
      cb.click();
    } }, [
      el("div", { class: "pi-name" }, nameChildren),
      (meta.length || macroStr) ? el("div", { class: "pi-meta" }, [
        meta.length ? el("span", { text: meta.join(" · ") }) : null,
        (meta.length && macroStr) ? el("span", { class: "dot", text: "·" }) : null,
        macroStr ? el("span", { text: macroStr }) : null
      ]) : null,
      it.note ? el("div", { class: "pi-note", text: it.note }) : null
    ]);

    return el("div", { class: "plan-item eatable" + (it.eaten ? " on" : "") }, [cb, body]);
  }

  function extraForm(plan, rerender) {
    var name = el("input", { placeholder: "e.g. Clif bar, cold brew…" });
    function mini(ph) { return el("input", { type: "number", inputmode: "decimal", placeholder: ph }); }
    var kcal = mini("kcal"), p = mini("P"), c = mini("C"), f = mini("F");
    function add() {
      if (!name.value.trim()) { name.focus(); return; }
      plan.extras.push({
        name: name.value.trim(),
        calories: App.util.num(kcal.value, 0), protein: App.util.num(p.value, 0),
        carbs: App.util.num(c.value, 0), fat: App.util.num(f.value, 0),
        eaten: true
      });
      rerender();
    }
    name.addEventListener("keydown", function (e) { if (e.key === "Enter") add(); });
    return el("div", { class: "extra-form" }, [
      name,
      el("div", { class: "row", style: "gap:6px;margin-top:6px" }, [kcal, p, c, f]),
      el("button", { class: "mini", style: "margin-top:6px;width:100%;height:38px", text: "Add food", onclick: add })
    ]);
  }

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function sumMacros(items) {
    return (items || []).reduce(function (a, it) {
      a.calories += +it.calories || 0; a.protein += +it.protein || 0;
      a.carbs += +it.carbs || 0; a.fat += +it.fat || 0; return a;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }
  function sumEaten(plan) {
    var eatenItems = (plan.items || []).filter(function (i) { return i.eaten; })
      .concat(plan.extras.filter(function (e) { return e.eaten; }));
    return sumMacros(eatenItems);
  }

  function totalsSection(eaten, planned, target) {
    function cell(label, val, tgt) {
      var d = Math.round(val - tgt);
      var cls = Math.abs(d) <= Math.max(3, tgt * 0.08) ? "ok" : (d > 0 ? "over" : "under");
      return el("div", { class: "t" }, [
        el("div", { class: "v", text: Math.round(val) }),
        el("div", { class: "l", text: label + " / " + tgt }),
        el("div", { class: "d " + cls, text: (d >= 0 ? "+" : "−") + Math.abs(d) })
      ]);
    }
    return el("div", { style: "margin-top:14px" }, [
      el("div", { class: "subhead", style: "margin-bottom:6px", text: "Eaten vs. target (this selection)" }),
      el("div", { class: "totals" }, [
        cell("kcal", eaten.calories, target.calories),
        cell("protein", eaten.protein, target.protein),
        cell("carbs", eaten.carbs, target.carbs),
        cell("fat", eaten.fat, target.fat)
      ]),
      el("p", { class: "faint small", style: "margin:8px 0 0", text:
        "Full plan if you ate everything: " + Math.round(planned.calories) + " kcal · P " +
        r1(planned.protein) + " C " + r1(planned.carbs) + " F " + r1(planned.fat) })
    ]);
  }

  function r1(n) { return Math.round((+n || 0) * 10) / 10; }

  App.fuel = { render: render };
})();
