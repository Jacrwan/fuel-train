/* Single-blob persistent store (localStorage). window.App.store */
window.App = window.App || {};
(function () {
  "use strict";
  var KEY = "fueltrain.v1";

  function defaultProgram() {
    var mk = function (id, name, sets, reps) {
      return { id: id, name: name, targetSets: sets, targetReps: reps };
    };
    return {
      monday: [ // Push
        mk("bench-press", "Bench Press", 4, "6-8"),
        mk("incline-db-press", "Incline DB Press", 3, "8-10"),
        mk("overhead-press", "Overhead Press", 3, "6-8"),
        mk("cable-fly", "Cable Fly", 3, "12-15"),
        mk("triceps-pushdown", "Triceps Pushdown", 3, "10-12")
      ],
      tuesday: [ // Pull
        mk("barbell-row", "Barbell Row", 4, "6-8"),
        mk("lat-pulldown", "Lat Pulldown", 3, "8-10"),
        mk("seated-cable-row", "Seated Cable Row", 3, "8-10"),
        mk("face-pull", "Face Pull", 3, "15-20"),
        mk("db-curl", "DB Curl", 3, "10-12")
      ],
      wednesday: [ // Legs
        mk("back-squat", "Back Squat", 4, "5-8"),
        mk("romanian-deadlift", "Romanian Deadlift", 3, "8-10"),
        mk("leg-press", "Leg Press", 3, "10-12"),
        mk("leg-curl", "Seated Leg Curl", 3, "10-12"),
        mk("standing-calf-raise", "Standing Calf Raise", 4, "10-15")
      ],
      thursday: [ // Upper
        mk("weighted-pullup", "Weighted Pull-up", 4, "6-8"),
        mk("incline-barbell-press", "Incline Barbell Press", 3, "6-8"),
        mk("chest-supported-row", "Chest-Supported Row", 3, "10-12"),
        mk("db-lateral-raise", "DB Lateral Raise", 4, "12-20"),
        mk("ez-bar-curl", "EZ-Bar Curl", 3, "8-10"),
        mk("overhead-triceps-ext", "Overhead Triceps Ext", 3, "10-12")
      ],
      friday: [ // Lower + core
        mk("deadlift", "Deadlift", 3, "3-5"),
        mk("bulgarian-split-squat", "Bulgarian Split Squat", 3, "8-10"),
        mk("hip-thrust", "Hip Thrust", 3, "8-12"),
        mk("leg-extension", "Leg Extension", 3, "12-15"),
        mk("hanging-leg-raise", "Hanging Leg Raise", 3, "10-15")
      ],
      saturday: [ // Bodyweight
        mk("pushups", "Push-ups", 4, "AMRAP"),
        mk("pullups", "Pull-ups", 4, "AMRAP"),
        mk("pistol-squat", "Pistol Squat", 3, "6-8"),
        mk("dips", "Dips", 3, "AMRAP"),
        mk("plank", "Plank", 3, "60s")
      ],
      sunday: []
    };
  }

  function defaults() {
    return {
      version: 1,
      settings: {
        usdaKey: "",
        anthropicKey: "",
        model: "claude-sonnet-4-6",
        macros: { calories: 2000, protein: 190, carbs: 175, fat: 60 },
        stats: {
          height: "6'0\"",
          weightLb: 180,
          goalWeightLb: 165,
          notes:
            "Cutting from ~180 lb to 165 lb on an aggressive deficit. Want a lean, " +
            "athletic build — not bulky. Trains at the gym Monday–Friday plus " +
            "one bodyweight session on the weekend. Eats at UC Berkeley dining halls."
        }
      },
      program: defaultProgram(),
      logs: {},          // "YYYY-MM-DD" -> { exerciseId: [ {weight, reps}, ... ] }
      weighins: {},       // "YYYY-MM-DD" -> lb (number)
      usdaCache: {},      // dishName(lower) -> {per100g:{kcal,protein,carbs,fat}, fdcId, description, matched}
      fuelPlans: {}       // "YYYY-MM-DD" -> { "hall|meal": planObject }
    };
  }

  function deepMerge(base, over) {
    if (Array.isArray(base)) return over === undefined ? base : over;
    if (typeof base !== "object" || base === null) return over === undefined ? base : over;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over || {}).forEach(function (k) {
      out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
    });
    return out;
  }

  var state = defaults();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        // shallow-merge settings so new default keys appear; keep user data as-is
        state = deepMerge(defaults(), parsed);
      }
    } catch (e) {
      console.warn("store load failed, using defaults", e);
      state = defaults();
    }
    return state;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error("store save failed", e);
      App.util && App.util.toast("Could not save — storage full or blocked");
    }
  }

  App.store = {
    KEY: KEY,
    get state() { return state; },
    load: load,
    save: save,
    reset: function () { state = defaults(); save(); },
    exportJSON: function () { return JSON.stringify(state, null, 2); },
    importJSON: function (text) {
      var parsed = JSON.parse(text);
      state = deepMerge(defaults(), parsed);
      save();
    }
  };
})();
