/* window.App.menu — load today's dining-hall menu from menu.json */
window.App = window.App || {};
(function () {
  "use strict";
  var cache = null;

  // menu.json lives next to index.html; the scraper commits it to the repo root
  // and GitHub Pages serves it from there. Relative path works locally too.
  var MENU_URL = "menu.json";

  function load(force) {
    if (cache && !force) return Promise.resolve(cache);
    return fetch(MENU_URL, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("menu.json HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        cache = data;
        return data;
      });
  }

  function halls(data) {
    return Object.keys((data && data.menu) || {});
  }

  function dishesFor(data, hall, meals) {
    // meals: array like ["breakfast","lunch","dinner"]
    var out = [];
    var seen = {};
    var h = (data.menu && data.menu[hall]) || {};
    (meals || []).forEach(function (m) {
      (h[m] || []).forEach(function (dish) {
        var key = dish.toLowerCase();
        if (!seen[key]) { seen[key] = 1; out.push(dish); }
      });
    });
    return out;
  }

  App.menu = { load: load, halls: halls, dishesFor: dishesFor, URL: MENU_URL,
    get cache() { return cache; } };
})();
