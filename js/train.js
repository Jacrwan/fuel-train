/* window.App.train — program + day view, quick logging, progress. */
window.App = window.App || {};
(function () {
  "use strict";
  var el = null, util = null;
  var selectedWd = null;     // "monday".. ; null => today
  var editMode = false;

  function boot() { el = App.util.el; util = App.util; }

  function currentWd() { return selectedWd || util.weekdayKeyOf(new Date()); }
  function resolvedDate() {
    // date the current weekday view writes to: today if it's that weekday, else the most recent past one
    return util.mostRecentDateForWeekday(currentWd(), true) || util.todayISO();
  }

  function setsFor(dateISO, exId) {
    var day = App.store.state.logs[dateISO];
    return (day && day[exId]) ? day[exId] : [];
  }

  function lastPerformance(exId, beforeISO) {
    var logs = App.store.state.logs;
    var dates = Object.keys(logs).filter(function (d) { return d < beforeISO && logs[d][exId] && logs[d][exId].length; });
    dates.sort();
    if (!dates.length) return null;
    var d = dates[dates.length - 1];
    return { date: d, sets: logs[d][exId] };
  }

  function fmtSets(sets) {
    return sets.map(function (s) {
      var w = App.util.num(s.weight, 0);
      return (w ? w + "×" + s.reps : s.reps + " reps");
    }).join(", ");
  }

  // ------------------------------------------------------------------ render
  function render(container) {
    boot();
    container.innerHTML = "";
    container.appendChild(daySwitcher());

    var wd = currentWd();
    var dateISO = resolvedDate();
    var isToday = dateISO === util.todayISO();

    container.appendChild(el("div", { class: "row spread", style: "margin:2px 2px 12px" }, [
      el("div", { class: "muted small", text:
        wd.charAt(0).toUpperCase() + wd.slice(1) + " · " + util.prettyDate(dateISO) + (isToday ? " (today)" : " (retro-log)") }),
      el("button", { class: "mini", text: editMode ? "Done" : "Edit day",
        onclick: function () { editMode = !editMode; render(container); } })
    ]));

    var program = App.store.state.program[wd] || [];
    if (!program.length && !editMode) {
      container.appendChild(el("div", { class: "card muted", text: "Rest day — nothing programmed for " + wd + "." }));
    }

    program.forEach(function (ex, idx) {
      container.appendChild(exerciseBlock(ex, idx, dateISO, container));
    });

    if (editMode) container.appendChild(addExerciseForm(wd, container));

    container.appendChild(aiCard(container));
  }

  function daySwitcher() {
    var wrap = el("div", { class: "pill-row", style: "margin-bottom:12px" });
    var today = util.weekdayKeyOf(new Date());
    util.WD_ORDER.forEach(function (wd) {
      wrap.appendChild(el("button", {
        class: "pill", "aria-pressed": String(currentWd() === wd),
        text: util.WD_SHORT[wd] + (wd === today ? " •" : ""),
        onclick: function () { selectedWd = wd; render(document.getElementById("view")); }
      }));
    });
    return wrap;
  }

  function setbar(count, target) {
    var wrap = el("span", { class: "setbar", "aria-label": count + " of " + target + " sets" });
    var n = Math.max(target, count);
    for (var i = 0; i < n; i++) {
      wrap.appendChild(el("i", { class: i < target ? (i < count ? "on" : "") : "extra" }));
    }
    return wrap;
  }

  function exerciseBlock(ex, idx, dateISO, container) {
    var sets = setsFor(dateISO, ex.id);
    var done = sets.length >= ex.targetSets;
    var block = el("div", { class: "ex" + (done ? " done" : "") });

    var head = el("div", { class: "ex-head" }, [
      el("span", { class: "ex-name grow", text: ex.name, role: "button", tabindex: "0",
        onclick: function () { showHistory(ex, dateISO); } }),
      el("span", { class: "ex-headmeta" }, [
        el("span", { class: "ex-target", text: ex.targetSets + " × " + ex.targetReps }),
        setbar(sets.length, ex.targetSets)
      ])
    ]);
    block.appendChild(head);

    var last = lastPerformance(ex.id, dateISO);
    block.appendChild(el("div", { class: "ex-last" }, last
      ? [document.createTextNode("last · " + util.prettyDate(last.date) + ": "),
         el("b", { text: fmtSets(last.sets) })]
      : [el("span", { class: "muted", text: "last · no prior log" })]));

    if (sets.length) {
      var chips = el("div", { class: "set-chips" });
      sets.forEach(function (s, si) {
        var w = App.util.num(s.weight, 0);
        chips.appendChild(el("span", { class: "set-chip" }, [
          document.createTextNode(w ? w + "×" + s.reps : s.reps + " reps"),
          el("button", { text: "✕", title: "remove set", onclick: function () {
            sets.splice(si, 1);
            if (!sets.length) delete App.store.state.logs[dateISO][ex.id];
            App.store.save();
            render(container);
          } })
        ]));
      });
      block.appendChild(chips);
    }

    // entry row
    var wIn = el("input", { type: "number", inputmode: "decimal", step: "1", placeholder: "lb",
      value: suggestWeight(ex.id, dateISO, sets) });
    var rIn = el("input", { type: "number", inputmode: "numeric", step: "1", placeholder: "reps" });
    function addSet() {
      var reps = App.util.num(rIn.value, NaN);
      if (!isFinite(reps)) { rIn.focus(); return; }
      var store = App.store.state.logs;
      if (!store[dateISO]) store[dateISO] = {};
      if (!store[dateISO][ex.id]) store[dateISO][ex.id] = [];
      store[dateISO][ex.id].push({ weight: App.util.num(wIn.value, 0), reps: reps });
      App.store.save();
      render(container);
    }
    rIn.addEventListener("keydown", function (e) { if (e.key === "Enter") addSet(); });

    var entry = el("div", { class: "ex-entry" }, [
      el("label", { class: "field" }, ["Weight (lb)", wIn]),
      el("label", { class: "field" }, ["Reps", rIn]),
      el("button", { class: "mini", text: "Add set", onclick: addSet })
    ]);
    block.appendChild(entry);

    if (editMode) {
      block.appendChild(el("div", { class: "ex-editrow" }, [
        el("button", { class: "mini icon", text: "▲", onclick: function () { move(ex, idx, -1, container); } }),
        el("button", { class: "mini icon", text: "▼", onclick: function () { move(ex, idx, 1, container); } }),
        el("button", { class: "mini", text: "Edit", onclick: function () { editExercise(ex, container); } }),
        el("span", { class: "grow" }),
        el("button", { class: "mini", text: "Delete", onclick: function () {
          var arr = App.store.state.program[currentWd()];
          arr.splice(arr.indexOf(ex), 1);
          App.store.save(); render(container);
        } })
      ]));
    }
    return block;
  }

  function suggestWeight(exId, dateISO, todaySets) {
    if (todaySets.length) return todaySets[todaySets.length - 1].weight || "";
    var last = lastPerformance(exId, dateISO);
    if (last && last.sets.length) return last.sets[0].weight || "";
    return "";
  }

  function move(ex, idx, dir, container) {
    var arr = App.store.state.program[currentWd()];
    var j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    var tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
    App.store.save(); render(container);
  }

  function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || ("ex-" + Date.now());
  }

  function addExerciseForm(wd, container) {
    var name = el("input", { placeholder: "Exercise name" });
    var sets = el("input", { type: "number", value: "3", inputmode: "numeric" });
    var reps = el("input", { placeholder: "8-10", value: "8-10" });
    return el("div", { class: "card" }, [
      el("h3", { text: "Add exercise to " + wd }),
      el("label", { class: "field" }, ["Name", name]),
      el("div", { class: "row" }, [
        el("label", { class: "field grow" }, ["Sets", sets]),
        el("label", { class: "field grow" }, ["Reps", reps])
      ]),
      el("button", { class: "btn secondary", style: "margin-top:10px", text: "Add", onclick: function () {
        if (!name.value.trim()) { name.focus(); return; }
        App.store.state.program[wd].push({
          id: slug(name.value), name: name.value.trim(),
          targetSets: App.util.num(sets.value, 3), targetReps: reps.value.trim() || "8-10"
        });
        App.store.save(); render(container);
      } })
    ]);
  }

  function editExercise(ex, container) {
    var name = el("input", { value: ex.name });
    var sets = el("input", { type: "number", value: ex.targetSets, inputmode: "numeric" });
    var reps = el("input", { value: ex.targetReps });
    var m = util.openModal("Edit exercise", el("div", {}, [
      el("label", { class: "field" }, ["Name", name]),
      el("div", { class: "row" }, [
        el("label", { class: "field grow" }, ["Sets", sets]),
        el("label", { class: "field grow" }, ["Reps", reps])
      ]),
      el("button", { class: "btn", style: "margin-top:12px", text: "Save", onclick: function () {
        ex.name = name.value.trim() || ex.name;
        ex.targetSets = App.util.num(sets.value, ex.targetSets);
        ex.targetReps = reps.value.trim() || ex.targetReps;
        App.store.save(); m.close(); render(container);
      } })
    ]));
  }

  // --------------------------------------------------------------- history
  function showHistory(ex, beforeOrEqISO) {
    var logs = App.store.state.logs;
    var dates = Object.keys(logs).filter(function (d) { return logs[d][ex.id] && logs[d][ex.id].length; });
    dates.sort(); dates.reverse();
    dates = dates.slice(0, 10);

    var body = el("div", {});
    if (!dates.length) {
      body.appendChild(el("p", { class: "muted", text: "No sessions logged yet." }));
    } else {
      var table = el("div", {});
      dates.forEach(function (d) {
        var ss = logs[d][ex.id];
        var maxW = Math.max.apply(null, ss.map(function (s) { return App.util.num(s.weight, 0); }));
        var top;
        if (maxW > 0) {
          var atMax = ss.filter(function (s) { return App.util.num(s.weight, 0) === maxW; });
          var bestReps = Math.max.apply(null, atMax.map(function (s) { return App.util.num(s.reps, 0); }));
          top = maxW + "×" + bestReps;
        } else {
          top = Math.max.apply(null, ss.map(function (s) { return App.util.num(s.reps, 0); })) + " reps";
        }
        var vol = ss.reduce(function (a, s) {
          var w = App.util.num(s.weight, 0);
          return a + (w ? w * App.util.num(s.reps, 0) : App.util.num(s.reps, 0));
        }, 0);
        table.appendChild(el("div", { class: "row spread", style: "padding:8px 0;border-bottom:1px solid var(--border)" }, [
          el("span", { class: "small", text: util.prettyDate(d) }),
          el("span", { class: "small", text: "top " + top }),
          el("span", { class: "small muted", text: "vol " + Math.round(vol) })
        ]));
      });
      body.appendChild(table);
      body.appendChild(el("p", { class: "muted small", text: "Volume = Σ weight×reps (or total reps for bodyweight)." }));
    }
    util.openModal(ex.name + " — last " + dates.length + " session" + (dates.length === 1 ? "" : "s"), body);
  }

  // ------------------------------------------------------------- AI actions
  function aiCard(container) {
    var card = el("div", { class: "card" });
    card.appendChild(el("h3", { text: "Program (AI)" }));
    card.appendChild(el("p", { class: "muted small", style: "margin:0 0 10px",
      text: "Uses your recent logs + goal to propose an updated week. You review a diff before anything changes." }));
    var status = el("div", { class: "progress-note" });

    var genBtn = el("button", { class: "btn secondary", text: "Generate / update program", onclick: function () {
      if (!App.ai.hasKey()) { util.toast("Add your Anthropic API key in Settings"); return; }
      genBtn.disabled = true; status.innerHTML = "<span class='spinner'></span>Asking the coach…";
      App.ai.generateProgram({}).then(function (np) {
        status.textContent = "";
        showProgramDiff(np, container);
      }).catch(function (e) { status.innerHTML = ""; card.appendChild(el("div", { class: "err", text: String(e.message || e) })); })
        .then(function () { genBtn.disabled = false; });
    } });

    card.appendChild(genBtn);
    card.appendChild(status);
    return card;
  }

  function showProgramDiff(np, container) {
    var old = App.store.state.program;
    var body = el("div", {});
    util.WD_ORDER.concat(["sunday"]).filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (wd) {
      var o = (old[wd] || []).map(fmtEx);
      var n = ((np && np[wd]) || []).map(fmtEx);
      var box = el("div", { class: "diff-day" }, [el("h4", { text: wd })]);
      var union = o.slice();
      n.forEach(function (line) { if (union.indexOf(line) < 0) union.push(line); });
      if (!union.length) box.appendChild(el("div", { class: "diff-line same", text: "(rest)" }));
      union.forEach(function (line) {
        var inO = o.indexOf(line) >= 0, inN = n.indexOf(line) >= 0;
        box.appendChild(el("div", {
          class: "diff-line " + (inO && inN ? "same" : inN ? "add" : "del"),
          text: (inO && inN ? "  " : inN ? "+ " : "− ") + line
        }));
      });
      body.appendChild(box);
    });
    body.appendChild(el("button", { class: "btn", style: "margin-top:6px", text: "Replace my program with this", onclick: function () {
      if (np && typeof np === "object") {
        App.util.WEEKDAYS.forEach(function (wd) { if (!np[wd]) np[wd] = []; });
        App.store.state.program = np;
        App.store.relinkLogs();
        App.store.save();
        util.closeModal();
        util.toast("Program updated");
        render(container);
      }
    } }));
    body.appendChild(el("button", { class: "btn ghost", style: "margin-top:8px", text: "Keep my current program", onclick: util.closeModal }));
    util.openModal("Proposed program", body);
  }

  function fmtEx(e) { return e.name + " — " + e.targetSets + "×" + e.targetReps; }

  App.train = { render: render };
})();
