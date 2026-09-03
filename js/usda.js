/* window.App.usda — USDA FoodData Central lookups (per-100g macros), cached. */
window.App = window.App || {};
(function () {
  "use strict";
  var SEARCH = "https://api.nal.usda.gov/fdc/v1/foods/search";

  function key() {
    return (App.store.state.settings.usdaKey || "").trim() || "DEMO_KEY";
  }

  function pickNutrients(food) {
    var out = { kcal: null, protein: null, carbs: null, fat: null };
    (food.foodNutrients || []).forEach(function (n) {
      var num = n.nutrientNumber || (n.nutrient && n.nutrient.number);
      var val = (n.value != null) ? n.value : n.amount;
      if (val == null) return;
      if (num === "208" || num === 208) { if (out.kcal == null) out.kcal = val; }
      else if (num === "203" || num === 203) out.protein = val;
      else if (num === "204" || num === 204) out.fat = val;
      else if (num === "205" || num === 205) out.carbs = val;
    });
    return out;
  }

  function searchOne(dish) {
    var lc = dish.toLowerCase();
    var cache = App.store.state.usdaCache;
    if (cache[lc]) return Promise.resolve(cache[lc]);

    var url = SEARCH + "?api_key=" + encodeURIComponent(key()) +
      "&query=" + encodeURIComponent(dish) +
      "&pageSize=1&dataType=" + encodeURIComponent("Foundation,SR Legacy,Survey (FNDDS),Branded");

    return fetch(url)
      .then(function (r) {
        if (r.status === 429) throw new Error("USDA rate limit (429). Add your own free API key in Settings.");
        if (!r.ok) throw new Error("USDA HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var food = (data.foods || [])[0];
        var rec;
        if (food) {
          var per100 = pickNutrients(food);
          rec = {
            matched: per100.kcal != null || per100.protein != null,
            per100g: per100,
            fdcId: food.fdcId,
            description: food.description,
            dataType: food.dataType
          };
        } else {
          rec = { matched: false, per100g: { kcal: null, protein: null, carbs: null, fat: null } };
        }
        cache[lc] = rec;
        App.store.save();
        return rec;
      })
      .catch(function (e) {
        // Don't cache transient errors; surface a non-match so the plan can proceed.
        console.warn("USDA lookup failed for", dish, e);
        return { matched: false, error: String(e && e.message || e),
                 per100g: { kcal: null, protein: null, carbs: null, fat: null } };
      });
  }

  /* Look up many dishes with limited concurrency.
     onProgress(done, total). Returns Promise<{dish: rec}>. */
  function searchMany(dishes, onProgress, concurrency) {
    concurrency = concurrency || 4;
    var i = 0, done = 0, total = dishes.length, results = {};
    return new Promise(function (resolve) {
      function next() {
        if (i >= total) {
          if (done >= total) resolve(results);
          return;
        }
        var idx = i++;
        var dish = dishes[idx];
        searchOne(dish).then(function (rec) {
          results[dish] = rec;
          done++;
          if (onProgress) onProgress(done, total);
          next();
        });
      }
      if (total === 0) { resolve(results); return; }
      for (var c = 0; c < concurrency; c++) next();
    });
  }

  App.usda = { searchOne: searchOne, searchMany: searchMany, activeKeyIsDemo: function () {
    return !((App.store.state.settings.usdaKey || "").trim());
  } };
})();
