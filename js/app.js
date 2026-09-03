/* window.App bootstrap: tab routing, settings, service worker. */
(function () {
  "use strict";
  var el;
  var activeTab = "fuel";

  document.addEventListener("DOMContentLoaded", function () {
    App.store.load();
    el = App.util.el;

    document.querySelectorAll(".tab").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });
    document.getElementById("btn-settings").addEventListener("click", openSettings);

    switchTab("fuel");
    registerSW();
  });

  var TITLES = { fuel: "Fuel", train: "Train", progress: "Progress" };
  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    });
    document.getElementById("topbar-title").textContent = TITLES[tab] || "Fuel";
    var view = document.getElementById("view");
    view.scrollTop = 0;
    window.scrollTo(0, 0);
    ({ fuel: App.fuel, train: App.train, progress: App.progress })[tab].render(view);
  }

  // ---------------------------------------------------------------- settings
  function openSettings() {
    var s = App.store.state.settings;
    var body = el("div", {});

    var usda = el("input", { type: "password", value: s.usdaKey, placeholder: "DEMO_KEY (rate-limited)",
      onchange: function () { s.usdaKey = usda.value.trim(); App.store.save(); } });
    var anth = el("input", { type: "password", value: s.anthropicKey, placeholder: "sk-ant-…",
      onchange: function () { s.anthropicKey = anth.value.trim(); App.store.save(); } });
    var model = el("input", { value: s.model || "claude-sonnet-4-6",
      onchange: function () { s.model = model.value.trim() || "claude-sonnet-4-6"; App.store.save(); } });

    var st = s.stats;
    function statFld(k, label, type) {
      var i = el("input", { type: type || "text", value: st[k],
        onchange: function () { st[k] = type === "number" ? App.util.num(i.value, st[k]) : i.value; App.store.save(); } });
      return el("label", { class: "field" }, [label, i]);
    }
    var notes = el("textarea", { onchange: function () { st.notes = notes.value; App.store.save(); } });
    notes.value = st.notes;

    body.appendChild(el("h3", { text: "API keys (stored on this device only)" }));
    body.appendChild(el("label", { class: "field" }, ["USDA FoodData Central key", usda]));
    body.appendChild(el("p", { class: "muted small", html:
      'Free, instant: <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov/api-key-signup</a>. ' +
      'DEMO_KEY works for a few requests then rate-limits.' }));
    body.appendChild(el("label", { class: "field", style: "margin-top:10px" }, ["Anthropic API key", anth]));
    body.appendChild(el("p", { class: "muted small", html:
      'From <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. ' +
      'Sent directly from your browser to api.anthropic.com. Personal use only — anyone with access to this device can read it.' }));
    body.appendChild(el("label", { class: "field", style: "margin-top:10px" }, ["Model", model]));

    body.appendChild(el("hr", { class: "sep" }));
    body.appendChild(el("h3", { text: "Stats & goal (fed to the AI)" }));
    body.appendChild(el("div", { class: "row" }, [
      statFld("height", "Height"), statFld("weightLb", "Weight (lb)", "number"), statFld("goalWeightLb", "Goal (lb)", "number")
    ]));
    body.appendChild(el("label", { class: "field", style: "margin-top:10px" }, ["Notes", notes]));

    body.appendChild(el("hr", { class: "sep" }));
    body.appendChild(el("h3", { text: "Data" }));
    body.appendChild(el("div", { class: "row wrap" }, [
      el("button", { class: "mini", text: "Export JSON", onclick: function () {
        navigator.clipboard && navigator.clipboard.writeText(App.store.exportJSON());
        App.util.toast("Copied store JSON to clipboard");
      } }),
      el("button", { class: "mini", text: "Import JSON", onclick: function () {
        var t = prompt("Paste exported JSON:");
        if (t) { try { App.store.importJSON(t); App.util.toast("Imported"); App.util.closeModal(); switchTab(activeTab); }
          catch (e) { App.util.toast("Invalid JSON"); } }
      } }),
      el("button", { class: "mini", text: "Reset program to default", onclick: function () {
        if (confirm("Reset the weekly program to the built-in default? Logs are kept.")) {
          var d = JSON.parse(App.store.exportJSON());
          App.store.reset();
          var fresh = App.store.state;
          fresh.logs = d.logs || {}; fresh.settings = d.settings || fresh.settings;
          App.store.save(); App.util.toast("Program reset"); App.util.closeModal(); switchTab(activeTab);
        }
      } })
    ]));

    App.util.openModal("Settings", body);
  }

  // -------------------------------------------------------------------- SW
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
    navigator.serviceWorker.register("sw.js").catch(function (e) { console.warn("SW register failed", e); });
  }
})();
