/* window.App.tools — the app's mutation surface, shared by the Coach chat and
   the Fuel "what did you eat" box. Each tool mutates App.store.state, saves, and
   returns a small JSON-able result. App.tools.onChange() is called after any
   mutation so the active view can re-render. */
window.App = window.App || {};
(function () {
  "use strict";
  var DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  function num(v, d) { return App.util.num(v, d === undefined ? 0 : d); }
  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || ("ex-" + Date.now());
  }
  function today() { return App.util.todayISO(); }
  function fireChange() { if (typeof App.tools.onChange === "function") { try { App.tools.onChange(); } catch (e) {} } }
  function save() { App.store.save(); fireChange(); }

  function findExercise(day, idOrName) {
    var arr = App.store.state.program[day] || [];
    var q = String(idOrName || "").toLowerCase();
    return arr.find(function (e) { return e.id === idOrName || e.id.toLowerCase() === q || e.name.toLowerCase() === q; }) || null;
  }
  function findExerciseAnywhere(idOrName) {
    var p = App.store.state.program, q = String(idOrName || "").toLowerCase(), hit = null;
    DAYS.forEach(function (d) { (p[d] || []).forEach(function (e) {
      if (e.id === idOrName || e.id.toLowerCase() === q || e.name.toLowerCase() === q) hit = e;
    }); });
    return hit;
  }

  // -------------------------------------------------------------- snapshot
  function snapshot() {
    var s = App.store.state;
    var lg = {}, cut = new Date(); cut.setDate(cut.getDate() - 21);
    Object.keys(s.logs).forEach(function (iso) { if (App.util.isoToDate(iso) >= cut) lg[iso] = s.logs[iso]; });
    var wc = {}, wcut = new Date(); wcut.setDate(wcut.getDate() - 40);
    Object.keys(s.weighins).forEach(function (iso) { if (App.util.isoToDate(iso) >= wcut) wc[iso] = s.weighins[iso]; });

    var menu = App.menu.cache;
    var menuInfo = null;
    if (menu && menu.menu) {
      menuInfo = { date: menu.date, halls: {} };
      Object.keys(menu.menu).forEach(function (h) {
        menuInfo.halls[h] = {};
        ["breakfast", "lunch", "dinner"].forEach(function (m) {
          menuInfo.halls[h][m] = (menu.menu[h][m] || []).length;
        });
      });
    }

    var eaten = s.eatenLog[today()] || [];
    var et = eaten.reduce(function (a, f) {
      a.calories += num(f.calories); a.protein += num(f.protein); a.carbs += num(f.carbs); a.fat += num(f.fat); return a;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

    return {
      today: today(),
      weekday: App.util.weekdayKeyOf(new Date()),
      macro_targets: s.settings.macros,
      stats: s.settings.stats,
      program: s.program,
      recent_logs: lg,
      recent_weighins: wc,
      today_eaten: { items: eaten, totals: round4(et), vs_target: {
        calories: Math.round(et.calories - s.settings.macros.calories),
        protein: Math.round(et.protein - s.settings.macros.protein),
        carbs: Math.round(et.carbs - s.settings.macros.carbs),
        fat: Math.round(et.fat - s.settings.macros.fat)
      } },
      menu_today: menuInfo,
      saved_meal_plans_today: Object.keys(s.fuelPlans[today()] || {})
    };
  }
  function round4(o) { return { calories: Math.round(o.calories), protein: r1(o.protein), carbs: r1(o.carbs), fat: r1(o.fat) }; }
  function r1(n) { return Math.round((+n || 0) * 10) / 10; }

  // -------------------------------------------------------------- eaten log
  function logFood(f) {
    var date = f.date || today();
    if (!App.store.state.eatenLog[date]) App.store.state.eatenLog[date] = [];
    var entry = {
      id: "f" + Date.now() + Math.floor(Math.random() * 1000),
      name: f.name, calories: num(f.calories), protein: num(f.protein),
      carbs: num(f.carbs), fat: num(f.fat), source: f.source || "manual"
    };
    if (f.ref) entry.ref = f.ref;
    App.store.state.eatenLog[date].push(entry);
    save();
    return entry;
  }
  function removeFood(idOrName, date) {
    date = date || today();
    var arr = App.store.state.eatenLog[date] || [];
    var q = String(idOrName || "").toLowerCase();
    var i = arr.findIndex(function (f) { return f.id === idOrName || f.name.toLowerCase() === q; });
    if (i < 0) return { ok: false, error: "no matching food '" + idOrName + "' on " + date };
    var removed = arr.splice(i, 1)[0];
    save();
    return { ok: true, removed: removed.name };
  }

  // -------------------------------------------------------------- tool defs
  var defs = [
    { name: "get_state", description: "Read the current app state: macro targets, body stats & goal, the full weekly program, the last 3 weeks of workout logs, recent weigh-ins, today's dining-hall menu (dish counts per hall/meal), and everything logged as eaten today. Call this first if you need context.", input_schema: { type: "object", properties: {}, additionalProperties: false } },

    { name: "set_macros", description: "Update daily macro targets. Only pass the fields you want to change.", input_schema: { type: "object", properties: {
      calories: { type: "number" }, protein: { type: "number" }, carbs: { type: "number" }, fat: { type: "number" } }, additionalProperties: false } },

    { name: "add_exercise", description: "Add an exercise to one day of the weekly program.", input_schema: { type: "object", properties: {
      day: { type: "string", enum: DAYS }, name: { type: "string" },
      sets: { type: "number" }, reps: { type: "string", description: "e.g. '6-8', 'AMRAP', '60s'" },
      position: { type: "number", description: "0-based index to insert at; omit to append" } },
      required: ["day", "name"], additionalProperties: false } },

    { name: "update_exercise", description: "Change an existing exercise's name, target sets, or target reps.", input_schema: { type: "object", properties: {
      day: { type: "string", enum: DAYS }, exercise: { type: "string", description: "current id or name" },
      new_name: { type: "string" }, sets: { type: "number" }, reps: { type: "string" } },
      required: ["day", "exercise"], additionalProperties: false } },

    { name: "remove_exercise", description: "Remove an exercise from a day.", input_schema: { type: "object", properties: {
      day: { type: "string", enum: DAYS }, exercise: { type: "string", description: "id or name" } },
      required: ["day", "exercise"], additionalProperties: false } },

    { name: "reorder_exercise", description: "Move an exercise to a new position within its day.", input_schema: { type: "object", properties: {
      day: { type: "string", enum: DAYS }, exercise: { type: "string" }, to_index: { type: "number" } },
      required: ["day", "exercise", "to_index"], additionalProperties: false } },

    { name: "set_program_day", description: "Replace an entire day's exercise list. Use for a full redesign of one day.", input_schema: { type: "object", properties: {
      day: { type: "string", enum: DAYS },
      exercises: { type: "array", items: { type: "object", properties: {
        name: { type: "string" }, sets: { type: "number" }, reps: { type: "string" } }, required: ["name"] } } },
      required: ["day", "exercises"], additionalProperties: false } },

    { name: "log_set", description: "Record a completed set for an exercise on a given date (defaults to today).", input_schema: { type: "object", properties: {
      exercise: { type: "string", description: "id or name (searched across all days)" },
      weight: { type: "number", description: "lb; 0 for bodyweight" }, reps: { type: "number" },
      date: { type: "string", description: "YYYY-MM-DD; defaults to today" } },
      required: ["exercise", "reps"], additionalProperties: false } },

    { name: "add_weighin", description: "Record a bodyweight entry (lb) for a date (defaults to today). Also updates the current-weight stat.", input_schema: { type: "object", properties: {
      lb: { type: "number" }, date: { type: "string" } }, required: ["lb"], additionalProperties: false } },

    { name: "log_food", description: "Add a food to today's eaten log (or another date). Estimate macros from your nutrition knowledge if not given; pass 0s only if truly unknown.", input_schema: { type: "object", properties: {
      name: { type: "string" }, calories: { type: "number" }, protein: { type: "number" },
      carbs: { type: "number" }, fat: { type: "number" }, date: { type: "string" } },
      required: ["name"], additionalProperties: false } },

    { name: "remove_food", description: "Remove a food from a day's eaten log by name or id.", input_schema: { type: "object", properties: {
      food: { type: "string" }, date: { type: "string" } }, required: ["food"], additionalProperties: false } },

    { name: "set_meal_selection", description: "Set which dining hall and meals the Fuel tab is planning for.", input_schema: { type: "object", properties: {
      hall: { type: "string" }, meals: { type: "array", items: { type: "string", enum: ["breakfast", "lunch", "dinner"] } } },
      required: ["hall", "meals"], additionalProperties: false } },

    { name: "generate_meal_plan", description: "Run the full Fuel pipeline for the current hall/meal selection: USDA lookups + an AI plan hitting the macro targets. Returns the plan. Slow (USDA calls).", input_schema: { type: "object", properties: {}, additionalProperties: false } }
  ];

  // -------------------------------------------------------------- runner
  function run(name, input) {
    input = input || {};
    var s = App.store.state;
    try {
      switch (name) {
        case "get_state": return snapshot();

        case "set_macros": {
          ["calories", "protein", "carbs", "fat"].forEach(function (k) {
            if (input[k] != null) s.settings.macros[k] = num(input[k]);
          });
          save();
          return { ok: true, macro_targets: s.settings.macros };
        }

        case "add_exercise": {
          if (!s.program[input.day]) return { ok: false, error: "bad day" };
          var ex = { id: slug(input.name), name: input.name,
            targetSets: input.sets != null ? num(input.sets) : 3, targetReps: input.reps || "8-10" };
          var arr = s.program[input.day];
          if (input.position != null && input.position >= 0 && input.position < arr.length) arr.splice(input.position, 0, ex);
          else arr.push(ex);
          save();
          return { ok: true, added: ex, day: input.day };
        }

        case "update_exercise": {
          var e = findExercise(input.day, input.exercise);
          if (!e) return { ok: false, error: "exercise not found on " + input.day };
          if (input.new_name) e.name = input.new_name;
          if (input.sets != null) e.targetSets = num(input.sets);
          if (input.reps != null) e.targetReps = input.reps;
          save();
          return { ok: true, exercise: e };
        }

        case "remove_exercise": {
          var arr2 = s.program[input.day] || [];
          var e2 = findExercise(input.day, input.exercise);
          if (!e2) return { ok: false, error: "exercise not found on " + input.day };
          arr2.splice(arr2.indexOf(e2), 1);
          save();
          return { ok: true, removed: e2.name, day: input.day };
        }

        case "reorder_exercise": {
          var arr3 = s.program[input.day] || [];
          var e3 = findExercise(input.day, input.exercise);
          if (!e3) return { ok: false, error: "not found" };
          arr3.splice(arr3.indexOf(e3), 1);
          var t = Math.max(0, Math.min(arr3.length, num(input.to_index)));
          arr3.splice(t, 0, e3);
          save();
          return { ok: true, day: input.day, order: arr3.map(function (x) { return x.name; }) };
        }

        case "set_program_day": {
          if (!(input.day in s.program)) return { ok: false, error: "bad day" };
          s.program[input.day] = (input.exercises || []).map(function (x) {
            return { id: slug(x.name), name: x.name, targetSets: x.sets != null ? num(x.sets) : 3, targetReps: x.reps || "8-10" };
          });
          save();
          return { ok: true, day: input.day, exercises: s.program[input.day] };
        }

        case "log_set": {
          var ex4 = findExerciseAnywhere(input.exercise);
          var id = ex4 ? ex4.id : slug(input.exercise);
          var date = input.date || today();
          if (!s.logs[date]) s.logs[date] = {};
          if (!s.logs[date][id]) s.logs[date][id] = [];
          s.logs[date][id].push({ weight: num(input.weight), reps: num(input.reps) });
          save();
          return { ok: true, date: date, exercise: ex4 ? ex4.name : input.exercise, sets_today: s.logs[date][id].length };
        }

        case "add_weighin": {
          var wd = input.date || today();
          s.weighins[wd] = App.util.round(num(input.lb), 1);
          s.settings.stats.weightLb = s.weighins[wd];
          save();
          return { ok: true, date: wd, lb: s.weighins[wd] };
        }

        case "log_food": {
          var entry = logFood({ name: input.name, calories: input.calories, protein: input.protein,
            carbs: input.carbs, fat: input.fat, date: input.date, source: "coach" });
          return { ok: true, logged: entry, today_totals: snapshot().today_eaten.totals };
        }

        case "remove_food": return removeFood(input.food, input.date);

        case "set_meal_selection": {
          App.fuel.setSelection(input.hall, input.meals);
          fireChange();
          return { ok: true, hall: input.hall, meals: input.meals };
        }

        case "generate_meal_plan": {
          return App.fuel.generateCurrent().then(function (plan) {
            return { ok: true, plan: plan };
          }).catch(function (err) { return { ok: false, error: String(err && err.message || err) }; });
        }

        default: return { ok: false, error: "unknown tool " + name };
      }
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  App.tools = { defs: defs, run: run, snapshot: snapshot, logFood: logFood, removeFood: removeFood, onChange: null, DAYS: DAYS };
})();
