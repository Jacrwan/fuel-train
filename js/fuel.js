/* window.App.fuel — daily macro targets, today's intake log, and an AI meal plan
   grounded in USDA data. All "eaten" data lives in App.store.state.eatenLog[date]. */
window.App = window.App || {};
(function () {
  "use strict";
  var el, util;
  var sel = { hall: null, meals: ["lunch"] };
  var selLoaded = false;

  function boot() {
    el = App.util.el; util = App.util;
    if (!selLoaded) {
      var saved = App.store.state.settings.fuelSel;
      if (saved && saved.hall) { sel.hall = saved.hall; sel.meals = (saved.meals && saved.meals.length) ? saved.meals.slice() : ["lunch"]; }
      selLoaded = true;
    }
  }
  function saveSel() { App.store.state.settings.fuelSel = { hall: sel.hall, meals: sel.meals.slice() }; App.store.save(); }
  function today() { return App.util.todayISO(); }
  function planKey() { return sel.hall + "|" + sel.meals.slice().sort().join(","); }

  function render(container) {
    boot();
    container.innerHTML = "";
    container.appendChild(macroCard());
    container.appendChild(intakeCard(container));
    container.appendChild(planCard(container));
  }
  function rerender() { render(document.getElementById("view")); }

  // ------------------------------------------------------------- macro card
  function macroCard() {
    var m = App.store.state.settings.macros;
    function fld(k, label) {
      var i = el("input", { type: "number", inputmode: "numeric", value: m[k],
        onchange: function () { m[k] = App.util.num(i.value, m[k]); App.store.save(); rerender(); } });
      return el("label", { class: "field" }, [label, i]);
    }
    return el("div", { class: "card" }, [
      el("h2", { text: "Daily macro targets" }),
      el("div", { class: "macro-grid" }, [
        fld("calories", "kcal"), fld("protein", "protein g"),
        fld("carbs", "carbs g"), fld("fat", "fat g")
      ]),
      el("p", { class: "muted small", style: "margin:8px 0 0",
        text: "Default is tuned for a 180→165 lb cut (aggressive deficit, high protein)." })
    ]);
  }

  // ------------------------------------------------------------- intake card
  function todayEaten() { return App.store.state.eatenLog[today()] || []; }
  function eatenTotals() {
    return todayEaten().reduce(function (a, f) {
      a.calories += +f.calories || 0; a.protein += +f.protein || 0;
      a.carbs += +f.carbs || 0; a.fat += +f.fat || 0; return a;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }

  function intakeCard(container) {
    var card = el("div", { class: "card" });
    var eaten = todayEaten();
    card.appendChild(el("div", { class: "row spread", style: "margin-bottom:10px" }, [
      el("h2", { style: "margin:0", text: "Today's intake" }),
      el("span", { class: "faint small", text: eaten.length + " item" + (eaten.length === 1 ? "" : "s") })
    ]));

    card.appendChild(totalsGrid(eatenTotals(), App.store.state.settings.macros));

    if (eaten.length) {
      var list = el("div", { style: "margin-top:12px" });
      eaten.forEach(function (f) {
        var has = [f.calories, f.protein, f.carbs, f.fat].some(function (v) { return +v > 0; });
        list.appendChild(el("div", { class: "food-row" }, [
          el("div", { class: "grow" }, [
            el("div", { class: "fr-name", text: f.name }),
            el("div", { class: "pi-meta", text: has
              ? Math.round(f.calories || 0) + " kcal · P " + r1(f.protein) + " C " + r1(f.carbs) + " F " + r1(f.fat)
              : "no macros" })
          ]),
          el("button", { class: "linkx", text: "remove", onclick: function () {
            var arr = App.store.state.eatenLog[today()] || [];
            var i = arr.indexOf(f); if (i >= 0) arr.splice(i, 1);
            App.store.save(); rerender();
          } })
        ]));
      });
      card.appendChild(list);
    }

    // manual add
    card.appendChild(el("div", { class: "subhead", style: "margin-top:14px", text: "Add a food" }));
    card.appendChild(manualForm());

    // AI parse
    card.appendChild(el("div", { class: "subhead", style: "margin-top:14px", text: "…or describe what you ate" }));
    card.appendChild(aiFoodForm(card));
    return card;
  }

  function manualForm() {
    var name = el("input", { placeholder: "e.g. Chipotle chicken bowl" });
    function mini(ph) { return el("input", { type: "number", inputmode: "decimal", placeholder: ph }); }
    var kcal = mini("kcal"), p = mini("P"), c = mini("C"), f = mini("F");
    function add() {
      if (!name.value.trim()) { name.focus(); return; }
      App.tools.logFood({ name: name.value.trim(), calories: kcal.value, protein: p.value,
        carbs: c.value, fat: f.value, source: "manual" });
      rerender();
    }
    name.addEventListener("keydown", function (e) { if (e.key === "Enter") add(); });
    return el("div", {}, [
      name,
      el("div", { class: "row", style: "gap:6px;margin-top:6px" }, [kcal, p, c, f]),
      el("button", { class: "mini", style: "margin-top:6px;width:100%;height:38px", text: "Add food", onclick: add })
    ]);
  }

  function aiFoodForm(card) {
    var ta = el("textarea", { placeholder: "e.g. large iced latte with oat milk, a bacon egg and cheese bagel, and a banana" });
    var status = el("div", { class: "progress-note" });
    var btn = el("button", { class: "btn secondary", style: "margin-top:6px", text: "Add with AI", onclick: function () {
      var text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      if (!App.ai.hasKey()) { util.toast("Add your Anthropic API key in Settings"); return; }
      btn.disabled = true; status.innerHTML = "<span class='spinner'></span>Estimating macros…";
      App.ai.parseFoods(text).then(function (res) {
        (res.items || []).forEach(function (it) {
          App.tools.logFood({ name: it.name, calories: it.calories, protein: it.protein,
            carbs: it.carbs, fat: it.fat, source: "ai" });
        });
        util.toast("Added " + (res.items || []).length + " item(s)");
        rerender();
      }).catch(function (e) { status.innerHTML = ""; card.appendChild(el("div", { class: "err", text: String(e.message || e) })); })
        .then(function () { btn.disabled = false; });
    } });
    return el("div", {}, [ta, btn, status]);
  }

  // -------------------------------------------------------------- plan card
  function planCard(container) {
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", { text: "Dining-hall meal plan" }));
    var body = el("div", {});
    card.appendChild(body);

    App.menu.load().then(function (data) {
      body.innerHTML = "";
      var halls = App.menu.halls(data);
      if (!sel.hall || halls.indexOf(sel.hall) < 0) sel.hall = halls[0];

      var dateLbl = data.date === today() ? "Today" : (data.date || "");
      body.appendChild(el("div", { class: "muted small", style: "margin-bottom:8px" }, [
        document.createTextNode(dateLbl + "'s menu · " + (data.date ? App.util.prettyDate(data.date) : "")),
        data.source === "heuristic" ? el("span", { class: "faint", text: "  (fallback parse)" }) : null
      ]));

      if (data.date !== today()) {
        body.appendChild(el("div", { class: "err", style: "margin-bottom:8px", text:
          "⚠ This menu is dated " + data.date + ", not today. If you're online, fully close and reopen the app to refresh it." }));
      }

      var hallRow = el("div", { class: "pill-row", style: "margin-bottom:8px" });
      halls.forEach(function (h) {
        hallRow.appendChild(el("button", { class: "pill", "aria-pressed": String(sel.hall === h),
          text: h, onclick: function () { sel.hall = h; saveSel(); rerender(); } }));
      });
      body.appendChild(hallRow);

      var mealRow = el("div", { class: "pill-row", style: "margin-bottom:8px" });
      ["breakfast", "lunch", "dinner"].forEach(function (mk) {
        mealRow.appendChild(el("button", { class: "pill", "aria-pressed": String(sel.meals.indexOf(mk) >= 0),
          text: cap(mk), onclick: function () {
            var i = sel.meals.indexOf(mk);
            if (i >= 0) sel.meals.splice(i, 1); else sel.meals.push(mk);
            saveSel(); rerender();
          } }));
      });
      body.appendChild(mealRow);

      // let the user eyeball the actual scraped dishes for this selection
      var curDishes = App.menu.dishesFor(data, sel.hall, sel.meals);
      var dishList = el("div", { class: "dish-peek", hidden: "hidden", text: curDishes.join(" · ") });
      body.appendChild(el("button", { class: "linkx", style: "margin-bottom:10px",
        text: curDishes.length + " dishes on " + (sel.hall || "?") + " " + sel.meals.map(cap).join("/") + " — show",
        onclick: function (e) { dishList.hidden = !dishList.hidden; e.target.textContent =
          curDishes.length + " dishes on " + (sel.hall || "?") + " " + sel.meals.map(cap).join("/") + (dishList.hidden ? " — show" : " — hide"); } }));
      body.appendChild(dishList);

      var status = el("div", { class: "progress-note" });
      var out = el("div", {});

      var btn = el("button", { class: "btn", text: "Generate meal plan", onclick: function () {
        if (!sel.meals.length) { util.toast("Pick at least one meal"); return; }
        if (!App.ai.hasKey()) { util.toast("Add your Anthropic API key in Settings"); return; }
        btn.disabled = true;
        runGenerate(data, function (s) { status.innerHTML = s; }).then(function () {
          status.textContent = ""; rerender();
        }).catch(function (e) {
          status.textContent = ""; out.appendChild(el("div", { class: "err", text: String(e.message || e) }));
        }).then(function () { btn.disabled = false; });
      } });
      body.appendChild(btn);
      body.appendChild(status);
      body.appendChild(out);

      var cached = (App.store.state.fuelPlans[data.date] || {})[planKey()];
      if (cached) renderPlan(cached, out);
    }).catch(function (e) {
      body.innerHTML = "";
      body.appendChild(el("div", { class: "err", text:
        "Could not load menu.json (" + (e.message || e) + ")." }));
    });
    return card;
  }

  function runGenerate(data, onStatus) {
    var hall = sel.hall, meals = sel.meals.slice();
    var dishes = App.menu.dishesFor(data, hall, meals);
    if (!dishes.length) return Promise.reject(new Error("No dishes for that selection."));
    onStatus("<span class='spinner'></span>Looking up " + dishes.length + " dishes in USDA…");
    return App.usda.searchMany(dishes, function (done, total) {
      onStatus("<span class='spinner'></span>USDA " + done + "/" + total + "…");
    }).then(function (usdaMap) {
      var matched = dishes.filter(function (d) { return usdaMap[d] && usdaMap[d].matched; }).length;
      onStatus("<span class='spinner'></span>USDA matched " + matched + "/" + dishes.length + ". Building the plan…");
      return App.ai.mealPlan({
        hall: hall, meals: meals, targets: scaledTargets(meals), stats: statsLine(),
        dishes: dishes.map(function (d) { return { name: d, usda: usdaMap[d] }; })
      });
    }).then(function (plan) {
      // guard against the model inventing dishes not on the scraped menu
      var have = {};
      dishes.forEach(function (d) { have[looseName(d)] = d; });
      (plan.items || []).forEach(function (it) {
        var match = have[looseName(it.dish)];
        if (match) { it.dish = match; it.offMenu = false; }
        else { it.offMenu = true; }
      });
      plan.offMenuCount = (plan.items || []).filter(function (it) { return it.offMenu; }).length;
      plan.dishCount = dishes.length;

      var d = data.date || today();
      if (!App.store.state.fuelPlans[d]) App.store.state.fuelPlans[d] = {};
      App.store.state.fuelPlans[d][hall + "|" + meals.slice().sort().join(",")] = plan;
      App.store.save();
      return plan;
    });
  }

  function looseName(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }

  function scaledTargets(meals) {
    var w = { breakfast: 0.25, lunch: 0.375, dinner: 0.375 };
    var m = App.store.state.settings.macros;
    var frac = meals.reduce(function (a, k) { return a + (w[k] || 0.33); }, 0) || 1;
    return { calories: Math.round(m.calories * frac), protein: Math.round(m.protein * frac),
      carbs: Math.round(m.carbs * frac), fat: Math.round(m.fat * frac) };
  }
  function statsLine() {
    var s = App.store.state.settings.stats;
    return s.height + ", " + s.weightLb + " lb, goal " + s.goalWeightLb + " lb. " + s.notes;
  }

  // --------------------------------------------------------- render a plan
  function isEaten(ref) { return todayEaten().some(function (e) { return e.ref === ref; }); }

  function renderPlan(plan, out) {
    out.innerHTML = "";
    var key = (plan.hall || sel.hall) + "|" + (plan.meals || sel.meals).slice().sort().join(",");
    var eatenN = (plan.items || []).filter(function (it) { return isEaten(key + "::" + it.dish); }).length;

    var wrap = el("div", { class: "plan" });
    wrap.appendChild(el("div", { class: "row spread", style: "margin-bottom:10px" }, [
      el("h3", { style: "margin:0", text: (plan.meals || []).map(cap).join(" + ") + " · " + (plan.hall || "") }),
      el("span", { class: "faint small", text: eatenN + " / " + (plan.items || []).length + " eaten" })
    ]));
    if (plan.offMenuCount) {
      wrap.appendChild(el("div", { class: "err small", style: "margin-bottom:8px", text:
        plan.offMenuCount + (plan.offMenuCount === 1 ? " item isn't" : " items aren't") +
        " on today's " + (plan.hall || "") + " menu (AI slip) — ignore it and regenerate." }));
    }

    (plan.items || []).forEach(function (it) {
      var ref = key + "::" + it.dish;
      var on = isEaten(ref);
      var isUsda = (it.source || "").toLowerCase().indexOf("usda") === 0;
      var cb = el("input", { type: "checkbox" });
      cb.checked = on;
      cb.addEventListener("change", function () {
        if (cb.checked) {
          App.tools.logFood({ name: it.dish, calories: it.calories, protein: it.protein,
            carbs: it.carbs, fat: it.fat, source: "plan", ref: ref });
        } else {
          var arr = App.store.state.eatenLog[today()] || [];
          for (var i = arr.length - 1; i >= 0; i--) if (arr[i].ref === ref) arr.splice(i, 1);
          App.store.save();
        }
        rerender();
      });
      var meta = [];
      if (it.portion) meta.push(it.portion);
      if (it.grams) meta.push(it.grams + " g");
      meta.push(Math.round(it.calories || 0) + " kcal · P " + r1(it.protein) + " C " + r1(it.carbs) + " F " + r1(it.fat));
      var nameKids = [
        document.createTextNode(it.dish),
        el("span", { class: "badge " + (isUsda ? "usda" : "ai"), text: isUsda ? "USDA" : "AI est." })
      ];
      if (it.offMenu) nameKids.push(el("span", { class: "badge off", text: "not on menu" }));
      var bodyDiv = el("div", { class: "grow", onclick: function (e) { if (!e.target.closest("button")) cb.click(); } }, [
        el("div", { class: "pi-name" }, nameKids),
        el("div", { class: "pi-meta", text: meta.join("  ·  ") }),
        it.note ? el("div", { class: "pi-note", text: it.note }) : null
      ]);
      wrap.appendChild(el("div", { class: "plan-item eatable" + (on ? " on" : "") + (it.offMenu ? " off" : "") }, [cb, bodyDiv]));
    });

    var planned = plan.totals || (plan.items || []).reduce(function (a, it) {
      a.calories += +it.calories || 0; a.protein += +it.protein || 0; a.carbs += +it.carbs || 0; a.fat += +it.fat || 0; return a;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
    wrap.appendChild(el("p", { class: "faint small", style: "margin-top:12px", text:
      "If you ate the whole plan: " + Math.round(planned.calories) + " kcal · P " + r1(planned.protein) +
      " C " + r1(planned.carbs) + " F " + r1(planned.fat) + ". Checked items count toward Today's intake above." }));
    if (plan.notes) wrap.appendChild(el("p", { class: "muted small", style: "margin-top:6px", text: plan.notes }));
    out.appendChild(wrap);
  }

  // ----------------------------------------------------------------- shared
  function totalsGrid(eaten, target) {
    function cell(label, val, tgt) {
      var d = Math.round(val - tgt);
      var cls = Math.abs(d) <= Math.max(3, tgt * 0.08) ? "ok" : (d > 0 ? "over" : "under");
      return el("div", { class: "t" }, [
        el("div", { class: "v", text: Math.round(val) }),
        el("div", { class: "l", text: label + " / " + tgt }),
        el("div", { class: "d " + cls, text: (d >= 0 ? "+" : "−") + Math.abs(d) })
      ]);
    }
    return el("div", {}, [
      el("div", { class: "subhead", style: "margin-bottom:6px", text: "Eaten vs. daily target" }),
      el("div", { class: "totals" }, [
        cell("kcal", eaten.calories, target.calories),
        cell("protein", eaten.protein, target.protein),
        cell("carbs", eaten.carbs, target.carbs),
        cell("fat", eaten.fat, target.fat)
      ])
    ]);
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function r1(n) { return Math.round((+n || 0) * 10) / 10; }

  App.fuel = {
    render: render,
    setSelection: function (hall, meals) {
      if (hall) sel.hall = hall;
      if (Array.isArray(meals) && meals.length) sel.meals = meals.slice();
    },
    getSelection: function () { return { hall: sel.hall, meals: sel.meals.slice() }; },
    generateCurrent: function () {
      return App.menu.load().then(function (data) {
        return runGenerate(data, function () {});
      });
    }
  };
})();
