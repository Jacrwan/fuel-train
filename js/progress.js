/* window.App.progress — bodyweight trend, training calendar, consistency, AI review. */
window.App = window.App || {};
(function () {
  "use strict";
  var el, util;
  var calMonth = null; // Date pinned to the 1st of the shown month

  function boot() { el = App.util.el; util = App.util; if (!calMonth) { var n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); } }

  function render(container) {
    boot();
    container.innerHTML = "";
    container.appendChild(bodyweightCard(container));
    container.appendChild(statsCard());
    container.appendChild(calendarCard(container));
    container.appendChild(aiCard());
  }

  // ------------------------------------------------------------- bodyweight
  function weighEntries() {
    var w = App.store.state.weighins || {};
    return Object.keys(w).sort().map(function (d) { return { date: d, lb: +w[d] }; });
  }

  function bodyweightCard(container) {
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", { text: "Bodyweight" }));

    var entries = weighEntries();
    var goal = App.store.state.settings.stats.goalWeightLb;

    if (entries.length) {
      var last = entries[entries.length - 1];
      var toGo = util.round(last.lb - goal, 1);
      var rate = weeklyRate(entries);
      card.appendChild(el("div", { class: "wt-now" }, [
        el("span", { class: "big", text: last.lb + " lb" }),
        el("span", { class: "muted small", text: "as of " + util.prettyDate(last.date) })
      ]));
      card.appendChild(el("div", { class: "row small", style: "margin-top:4px;gap:16px" }, [
        el("span", { class: toGo > 0 ? "muted" : "", text: (toGo > 0 ? toGo + " lb to goal" : toGo === 0 ? "at goal 🎯" : Math.abs(toGo) + " lb under goal") }),
        rate != null ? el("span", { class: rate < 0 ? "" : "muted",
          text: (rate < 0 ? "▼ " : "▲ ") + Math.abs(rate) + " lb/wk" }) : null
      ]));
      if (entries.length >= 2) card.appendChild(sparkline(entries, goal));
    } else {
      card.appendChild(el("p", { class: "muted small", style: "margin:0 0 4px", text:
        "Log your weight a few times a week to see the trend and pace toward " + goal + " lb." }));
    }

    // quick entry
    var wIn = el("input", { type: "number", inputmode: "decimal", step: "0.1", placeholder: "lb",
      value: entries.length ? entries[entries.length - 1].lb : App.store.state.settings.stats.weightLb });
    function log() {
      var v = App.util.num(wIn.value, NaN);
      if (!isFinite(v) || v <= 0) { wIn.focus(); return; }
      App.store.state.weighins[util.todayISO()] = util.round(v, 1);
      // keep the profile stat roughly in sync so the AI sees current weight
      App.store.state.settings.stats.weightLb = util.round(v, 1);
      App.store.save();
      render(container);
    }
    wIn.addEventListener("keydown", function (e) { if (e.key === "Enter") log(); });
    card.appendChild(el("div", { class: "row", style: "margin-top:12px;align-items:flex-end" }, [
      el("label", { class: "field grow" }, ["Today's weight", wIn]),
      el("button", { class: "mini", style: "height:42px;padding:0 16px", text: "Log", onclick: log })
    ]));
    return card;
  }

  function weeklyRate(entries) {
    if (entries.length < 2) return null;
    var cut = util.isoToDate(entries[entries.length - 1].date);
    cut.setDate(cut.getDate() - 21);
    var recent = entries.filter(function (e) { return util.isoToDate(e.date) >= cut; });
    if (recent.length < 2) recent = entries.slice(-4);
    var a = recent[0], b = recent[recent.length - 1];
    var days = (util.isoToDate(b.date) - util.isoToDate(a.date)) / 86400000;
    if (days <= 0) return null;
    return util.round((b.lb - a.lb) / days * 7, 2);
  }

  function sparkline(entries, goal) {
    var pts = entries.slice(-30);
    var W = 300, H = 56, pad = 6;
    var xs = pts.map(function (p) { return util.isoToDate(p.date).getTime(); });
    var ys = pts.map(function (p) { return p.lb; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    // scale to the weigh-in data only (plus a little headroom); the goal is usually
    // far away and would flatten the trend if forced into range.
    var dMin = Math.min.apply(null, ys), dMax = Math.max.apply(null, ys);
    var padY = Math.max(0.5, (dMax - dMin) * 0.15);
    var minY = dMin - padY, maxY = dMax + padY;
    var rx = maxX === minX ? 1 : maxX - minX, ry = maxY === minY ? 1 : maxY - minY;
    function X(v) { return pad + (v - minX) / rx * (W - 2 * pad); }
    function Y(v) { return H - pad - (v - minY) / ry * (H - 2 * pad); }
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(xs[i]).toFixed(1) + " " + Y(ys[i]).toFixed(1); }).join(" ");
    var goalLine = (goal >= minY && goal <= maxY)
      ? '<line x1="0" y1="' + Y(goal).toFixed(1) + '" x2="' + W + '" y2="' + Y(goal).toFixed(1) +
        '" stroke="#43c07a" stroke-dasharray="3 3" stroke-width="1" opacity="0.7"/>' : "";
    var svg =
      '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      goalLine +
      '<path d="' + d + '" fill="none" stroke="#5b9dff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + X(xs[xs.length - 1]).toFixed(1) + '" cy="' + Y(ys[ys.length - 1]).toFixed(1) + '" r="3" fill="#5b9dff"/>' +
      '</svg>';
    return el("div", { style: "margin-top:10px", html: svg }, []);
  }

  // -------------------------------------------------------------- consistency
  function statsCard() {
    var logs = App.store.state.logs;
    var now = new Date();
    var monthCount = 0, weekCount = 0;
    var weekStart = startOfWeek(now);
    Object.keys(logs).forEach(function (iso) {
      if (!Object.keys(logs[iso]).length) return;
      var d = util.isoToDate(iso);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthCount++;
      if (d >= weekStart) weekCount++;
    });

    return el("div", { class: "card" }, [
      el("h2", { text: "Consistency" }),
      el("div", { class: "stat-row" }, [
        stat(streak(), "day streak"),
        stat(weekCount, "this week"),
        stat(monthCount, "this month")
      ]),
      el("p", { class: "faint small", style: "margin:10px 0 0",
        text: "Streak counts consecutive planned training days completed (rest days don't break it)." })
    ]);
  }
  function stat(v, l) { return el("div", { class: "stat" }, [el("div", { class: "v", text: String(v) }), el("div", { class: "l", text: l })]); }

  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var wd = (x.getDay() + 6) % 7; // Mon=0
    x.setDate(x.getDate() - wd);
    return x;
  }

  function streak() {
    var logs = App.store.state.logs, program = App.store.state.program;
    var d = new Date();
    var count = 0;
    // if today is a planned day not yet logged, start from yesterday (don't punish "not done yet")
    var todayKey = util.weekdayKeyOf(d);
    var todayIso = util.todayISO();
    var todayPlanned = (program[todayKey] || []).length > 0;
    var todayDone = logs[todayIso] && Object.keys(logs[todayIso]).length > 0;
    if (todayPlanned && !todayDone) d.setDate(d.getDate() - 1);

    for (var i = 0; i < 120; i++) {
      var iso = util.toISO(d);
      var wd = util.weekdayKeyOf(d);
      var planned = (program[wd] || []).length > 0;
      var done = logs[iso] && Object.keys(logs[iso]).length > 0;
      if (planned) {
        if (done) count++;
        else break;
      }
      d.setDate(d.getDate() - 1);
    }
    return count;
  }

  // ---------------------------------------------------------------- calendar
  function calendarCard(container) {
    var card = el("div", { class: "card" });
    var monthLabel = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    card.appendChild(el("div", { class: "cal-head" }, [
      el("button", { class: "mini icon", text: "‹", "aria-label": "Previous month", onclick: function () {
        calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(container);
      } }),
      el("span", { class: "m", text: monthLabel }),
      el("button", { class: "mini icon", text: "›", "aria-label": "Next month", onclick: function () {
        calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(container);
      } })
    ]));

    var grid = el("div", { class: "cal-grid" });
    ["M", "T", "W", "T", "F", "S", "S"].forEach(function (d) { grid.appendChild(el("div", { class: "cal-dow", text: d })); });

    var first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
    var lead = (first.getDay() + 6) % 7; // Mon-first
    var daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
    var logs = App.store.state.logs, program = App.store.state.program;
    var todayIso = util.todayISO();

    for (var i = 0; i < lead; i++) grid.appendChild(el("div", { class: "cal-cell empty" }));

    for (var day = 1; day <= daysInMonth; day++) {
      var date = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
      var iso = util.toISO(date);
      var wd = util.weekdayKeyOf(date);
      var planned = (program[wd] || []).length > 0;
      var logged = logs[iso] && Object.keys(logs[iso]).length > 0;
      var future = iso > todayIso;

      var cls = "cal-cell";
      if (future) cls += " future";
      else if (logged) cls += " trained";
      else if (planned) cls += " missed";
      else cls += " rest";
      if (iso === todayIso) cls += " today";

      (function (iso2) {
        grid.appendChild(el("div", { class: cls, text: String(day),
          onclick: function () { dayDetail(iso2); } }));
      })(iso);
    }
    card.appendChild(grid);

    card.appendChild(el("div", { class: "cal-legend" }, [
      legend("var(--good)", "trained"), legend("transparent", "missed", "var(--bad)"),
      legend("var(--surface)", "rest / unplanned")
    ]));
    return card;
  }
  function legend(bg, label, ring) {
    return el("span", {}, [
      el("i", { style: "background:" + bg + (ring ? ";border:1px solid " + ring : "") }),
      document.createTextNode(label)
    ]);
  }

  function dayDetail(iso) {
    var logs = App.store.state.logs, program = App.store.state.program;
    var wd = util.weekdayKeyOf(iso);
    var day = logs[iso] || {};
    var body = el("div", {});
    var planned = program[wd] || [];

    if (!Object.keys(day).length) {
      body.appendChild(el("p", { class: "muted", text: planned.length
        ? "Planned (" + wd + ") but nothing logged." : "Rest day — nothing planned." }));
    } else {
      Object.keys(day).forEach(function (exId) {
        var sets = day[exId];
        var name = (findEx(exId) || {}).name || exId;
        var maxW = Math.max.apply(null, sets.map(function (s) { return App.util.num(s.weight, 0); }));
        var vol = sets.reduce(function (a, s) { var w = App.util.num(s.weight, 0); return a + (w ? w * App.util.num(s.reps, 0) : App.util.num(s.reps, 0)); }, 0);
        body.appendChild(el("div", { class: "row spread", style: "padding:7px 0;border-bottom:1px solid var(--border)" }, [
          el("span", { class: "small", text: name }),
          el("span", { class: "small muted", text: sets.map(function (s) {
            var w = App.util.num(s.weight, 0); return w ? w + "×" + s.reps : s.reps + "r";
          }).join(", ") + "  ·  vol " + Math.round(vol) })
        ]));
      });
    }
    util.openModal(new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }), body);
  }
  function findEx(id) {
    var p = App.store.state.program, out = null;
    Object.keys(p).forEach(function (wd) { (p[wd] || []).forEach(function (e) { if (e.id === id) out = e; }); });
    return out;
  }

  // ------------------------------------------------------------- AI review
  function aiCard() {
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", { text: "AI review" }));
    var status = el("div", { class: "progress-note" });
    var btn = el("button", { class: "btn ghost", text: "Analyze my progress", onclick: function () {
      if (!App.ai.hasKey()) { util.toast("Add your Anthropic API key in Settings"); return; }
      btn.disabled = true; status.innerHTML = "<span class='spinner'></span>Reviewing your logs…";
      App.ai.analyzeProgress().then(function (text) {
        status.textContent = "";
        util.openModal("Progress analysis", el("div", { style: "white-space:pre-wrap;font-size:14px;line-height:1.5", text: App.util.plainText(text) }));
      }).catch(function (e) { status.innerHTML = ""; card.appendChild(el("div", { class: "err", text: String(e.message || e) })); })
        .then(function () { btn.disabled = false; });
    } });
    card.appendChild(el("p", { class: "muted small", style: "margin:0 0 10px",
      text: "Sends the last ~5 weeks of logs + your goal to Claude for a short written assessment." }));
    card.appendChild(btn);
    card.appendChild(status);
    return card;
  }

  App.progress = { render: render };
})();
