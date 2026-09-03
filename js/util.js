/* window.App.util — small shared helpers */
window.App = window.App || {};
(function () {
  "use strict";

  var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  var WD_SHORT = { sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat" };
  var WD_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function toISO(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function todayISO() { return toISO(new Date()); }

  function weekdayKeyOf(dOrISO) {
    var d = typeof dOrISO === "string" ? isoToDate(dOrISO) : dOrISO;
    return WEEKDAYS[d.getDay()];
  }

  function isoToDate(iso) {
    var p = iso.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  /* Most recent date (YYYY-MM-DD) whose weekday === wdKey, scanning back from today.
     includeToday: if false, start at yesterday. lookback: days to search. */
  function mostRecentDateForWeekday(wdKey, includeToday, lookback) {
    lookback = lookback || 28;
    var d = new Date();
    if (!includeToday) d.setDate(d.getDate() - 1);
    for (var i = 0; i < lookback; i++) {
      if (WEEKDAYS[d.getDay()] === wdKey) return toISO(d);
      d.setDate(d.getDate() - 1);
    }
    return null;
  }

  function prettyDate(iso) {
    var d = isoToDate(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") {
        node.addEventListener(k.slice(2), attrs[k]);
      } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  var toastTimer = null;
  function toast(msg) {
    var existing = document.querySelector(".toast");
    if (existing) existing.remove();
    var t = el("div", { class: "toast", text: msg });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 3200);
  }

  function onKey(e) { if (e.key === "Escape") closeModal(); }
  function openModal(title, bodyNode) {
    closeModal();
    var backdrop = el("div", { class: "modal-backdrop", onclick: function (e) {
      if (e.target === backdrop) closeModal();
    } });
    var modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title }, [
      el("button", { class: "mini icon close-x", text: "✕", "aria-label": "Close", onclick: closeModal }),
      el("h2", { text: title }),
      bodyNode
    ]);
    backdrop.appendChild(modal);
    document.getElementById("modal-root").appendChild(backdrop);
    document.addEventListener("keydown", onKey);
    return { close: closeModal, modal: modal };
  }
  function closeModal() {
    var r = document.getElementById("modal-root");
    if (r) r.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }

  function round(n, dp) {
    var f = Math.pow(10, dp || 0);
    return Math.round((+n || 0) * f) / f;
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback || 0);
  }

  App.util = {
    WEEKDAYS: WEEKDAYS, WD_SHORT: WD_SHORT, WD_ORDER: WD_ORDER,
    toISO: toISO, todayISO: todayISO, isoToDate: isoToDate,
    weekdayKeyOf: weekdayKeyOf, mostRecentDateForWeekday: mostRecentDateForWeekday,
    prettyDate: prettyDate,
    el: el, toast: toast, openModal: openModal, closeModal: closeModal,
    round: round, num: num
  };
})();
