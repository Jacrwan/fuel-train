/* window.App.coach — chat with an AI coach that can read and change everything
   (program, logs, weigh-ins, macros, eaten food, meal-plan selection). */
window.App = window.App || {};
(function () {
  "use strict";
  var el, util;
  var busy = false;
  var liveSteps = [];   // transient step chips for the in-flight turn

  function boot() { el = App.util.el; util = App.util; }

  var SYSTEM =
    "You are the in-app coach for a personal nutrition + training PWA. The user is cutting " +
    "from ~180 to 165 lb on an aggressive deficit, wants a lean athletic build (not bulky), " +
    "trains at a gym Mon–Fri plus one weekend bodyweight day, and eats at UC Berkeley dining halls.\n\n" +
    "You have tools to read and modify the app: macro targets, the weekly program (add/remove/" +
    "edit/reorder exercises, replace a whole day), workout set logs, weigh-ins, the food eaten " +
    "today, the dining-hall meal selection, and meal-plan generation. Call get_state first when " +
    "you need current context. Make the change the user asks for directly with tools — don't just " +
    "describe it. For large or destructive changes (replacing a whole training day, deleting " +
    "several things), briefly say what you did after doing it. Weights are pounds. Keep replies " +
    "short and concrete.\n\n" +
    "SCOPE: only change the day(s) the user actually names. If they ask about \"today\" or a " +
    "specific weekday or \"going forward\", that means that one weekday slot in the weekly " +
    "template — do NOT touch the other days. Only rewrite the whole week if the user explicitly " +
    "says so (e.g. \"redo my entire program\"). Prefer add_exercise / update_exercise / " +
    "remove_exercise over set_program_day; use set_program_day only when redesigning one day wholesale.\n\n" +
    "Write in plain text only. Do not use Markdown — no **bold**, no ##/### headings, no *** " +
    "rules, no bullet markdown. Short paragraphs; if you list things use plain lines.";

  function render(container) {
    boot();
    container.innerHTML = "";
    var wrap = el("div", { class: "chat" });

    var scroll = el("div", { class: "chat-scroll", id: "chat-scroll" });
    renderTranscript(scroll);
    wrap.appendChild(scroll);

    var ta = el("textarea", { class: "chat-input", rows: "1",
      placeholder: busy ? "Coach is working…" : "Message the coach…" });
    ta.disabled = busy;
    autosize(ta);
    ta.addEventListener("input", function () { autosize(ta); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(ta.value, container); }
    });
    var sendBtn = el("button", { class: "mini", text: "Send", disabled: busy ? "disabled" : null,
      onclick: function () { send(ta.value, container); } });
    var clearBtn = el("button", { class: "mini", text: "Clear", onclick: function () {
      if (!busy && confirm("Clear the chat history?")) { App.store.state.chat = []; App.store.save(); render(container); }
    } });

    wrap.appendChild(el("div", { class: "chat-bar" }, [ta, el("div", { class: "row", style: "gap:6px" }, [sendBtn, clearBtn])]));
    container.appendChild(wrap);
    scrollDown();
  }

  function renderTranscript(scroll) {
    var chat = App.store.state.chat || [];
    if (!chat.length && !liveSteps.length) {
      scroll.appendChild(el("div", { class: "empty-state", html:
        "Try:<br>“add a hamstring curl to Wednesday”<br>“I ate a burrito and a coke for lunch”<br>" +
        "“bump my protein target to 200”<br>“how's my squat trending?”" }));
      return;
    }
    chat.forEach(function (msg) {
      if (msg.role === "user" && typeof msg.content === "string") {
        scroll.appendChild(bubble("user", msg.content));
      } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
        msg.content.forEach(function (b) {
          if (b.type === "text" && b.text.trim()) scroll.appendChild(bubble("assistant", b.text));
          else if (b.type === "tool_use") scroll.appendChild(toolChip(b.name, b.input, null));
        });
      } else if (msg.role === "user" && Array.isArray(msg.content)) {
        msg.content.forEach(function (b) {
          if (b.type === "tool_result") {
            var r; try { r = JSON.parse(b.content); } catch (e) { r = null; }
            scroll.appendChild(toolResultChip(r));
          }
        });
      }
    });
    liveSteps.forEach(function (s) { scroll.appendChild(s); });
  }

  function bubble(who, text) {
    return el("div", { class: "msg " + who }, [
      el("div", { class: "bub", text: who === "assistant" ? App.util.plainText(text) : text })
    ]);
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function exList(arr) {
    return (arr || []).map(function (e) {
      return (e.name || e) + (e.sets != null ? " " + e.sets + "×" + (e.reps || "") : "");
    }).join(", ");
  }

  /* human-readable "what the AI is about to do" line */
  function describeCall(name, i) {
    i = i || {};
    switch (name) {
      case "get_state": return "Reading your program, logs and targets";
      case "set_macros": {
        var p = ["calories", "protein", "carbs", "fat"].filter(function (k) { return i[k] != null; })
          .map(function (k) { return k + " " + i[k]; });
        return "Set macro targets — " + (p.join(", ") || "?");
      }
      case "add_exercise": return "Add “" + i.name + "” to " + cap(i.day) +
        (i.sets != null ? " (" + i.sets + "×" + (i.reps || "") + ")" : "");
      case "update_exercise": return "Update “" + i.exercise + "” on " + cap(i.day) +
        (i.new_name ? " → “" + i.new_name + "”" : "") +
        (i.sets != null || i.reps != null ? " (" + (i.sets != null ? i.sets + "×" : "") + (i.reps || "") + ")" : "");
      case "remove_exercise": return "Remove “" + i.exercise + "” from " + cap(i.day);
      case "reorder_exercise": return "Move “" + i.exercise + "” to slot " + (i.to_index + 1) + " on " + cap(i.day);
      case "set_program_day": return "Rebuild " + cap(i.day) + ": " + exList(i.exercises);
      case "log_set": return "Log " + i.exercise + " — " + (i.weight ? i.weight + "×" : "") + i.reps +
        (i.date ? " (" + i.date + ")" : "");
      case "add_weighin": return "Log bodyweight " + i.lb + " lb" + (i.date ? " (" + i.date + ")" : "");
      case "log_food": return "Log food — " + i.name +
        (i.calories ? " (" + Math.round(i.calories) + " kcal)" : "");
      case "remove_food": return "Remove food — " + i.food;
      case "set_meal_selection": return "Plan for " + i.hall + " · " + (i.meals || []).join(" + ");
      case "generate_meal_plan": return "Generate a dining-hall meal plan";
      default: return name + " " + JSON.stringify(i);
    }
  }

  /* human-readable result line */
  function describeResult(r) {
    if (!r) return { ok: true, text: "done" };
    if (r.error) return { ok: false, text: r.error };
    if (r.today && r.program) return { ok: true, text: "read app state" };
    if (r.added) return { ok: true, text: "added " + (r.added.name || "") + (r.day ? " to " + cap(r.day) : "") };
    if (r.removed) return { ok: true, text: "removed " + r.removed + (r.day ? " from " + cap(r.day) : "") };
    if (r.exercises && r.day) return { ok: true, text: cap(r.day) + " set — " + exList(r.exercises) };
    if (r.exercise && r.exercise.name) return { ok: true, text: "updated " + r.exercise.name +
      " (" + r.exercise.targetSets + "×" + r.exercise.targetReps + ")" };
    if (r.order) return { ok: true, text: cap(r.day) + " order: " + r.order.join(", ") };
    if (r.logged) return { ok: true, text: "logged " + r.logged.name };
    if (r.lb != null) return { ok: true, text: "bodyweight " + r.lb + " lb saved" };
    if (r.macro_targets) return { ok: true, text: "targets now " + r.macro_targets.calories + " kcal / " +
      r.macro_targets.protein + "P / " + r.macro_targets.carbs + "C / " + r.macro_targets.fat + "F" };
    if (r.plan) return { ok: true, text: "meal plan ready (" + ((r.plan.items || []).length) + " items)" };
    if (r.hall) return { ok: true, text: "plan set to " + r.hall + " · " + (r.meals || []).join(" + ") };
    if (r.sets_today != null) return { ok: true, text: (r.exercise || "set") + " — " + r.sets_today + " set(s) today" };
    if (r.ok === false) return { ok: false, text: "failed" };
    return { ok: true, text: "done" };
  }

  function chipWithDetail(cls, label, detailObj) {
    var pre = el("pre", { class: "tool-detail", hidden: "hidden", text: JSON.stringify(detailObj, null, 2) });
    var chip = el("div", { class: "tool-chip " + cls, text: label, onclick: function () { pre.hidden = !pre.hidden; } });
    return el("div", {}, [chip, pre]);
  }

  function toolChip(name, input) {
    return chipWithDetail("act", "⚙ " + describeCall(name, input), { tool: name, input: input });
  }
  function toolResultChip(r) {
    var d = describeResult(r);
    return chipWithDetail(d.ok ? "ok" : "bad", (d.ok ? "✓ " : "✗ ") + d.text, r);
  }

  function send(text, container) {
    text = (text || "").trim();
    if (!text || busy) return;
    if (!App.ai.hasKey()) { util.toast("Add your Anthropic API key in Settings"); return; }

    // snapshot the whole store so a bad AI edit can be undone (Settings → Restore)
    try {
      localStorage.setItem("fueltrain.snapshot", JSON.stringify({
        at: Date.now(), note: text.slice(0, 80), state: App.store.state
      }));
    } catch (e) {}

    if (!App.store.state.chat) App.store.state.chat = [];
    App.store.state.chat.push({ role: "user", content: text });
    App.store.save();
    busy = true; liveSteps = [];
    render(container);

    var scroll = document.getElementById("chat-scroll");
    function step(kind, payload) {
      if (kind === "tool") liveSteps.push(toolChip(payload.name, payload.input));
      else if (kind === "tool_result") liveSteps.push(toolResultChip(payload.result));
      else if (kind === "text") liveSteps.push(bubble("assistant", payload));
      if (scroll) { scroll.appendChild(liveSteps[liveSteps.length - 1]); scrollDown(); }
    }

    App.ai.runToolLoop({
      system: SYSTEM,
      messages: App.store.state.chat,
      tools: App.tools.defs,
      runTool: App.tools.run,
      onStep: step,
      maxTokens: 2500,
      maxTurns: 10
    }).then(function () {
      App.store.relinkLogs();
      App.store.save();
    }).catch(function (e) {
      App.store.state.chat.push({ role: "assistant", content: [{ type: "text", text: "⚠️ " + (e.message || e) }] });
      App.store.save();
    }).then(function () {
      busy = false; liveSteps = [];
      render(container);
    });
  }

  function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }
  function scrollDown() {
    var s = document.getElementById("chat-scroll");
    if (s) s.scrollTop = s.scrollHeight;
  }

  App.coach = { render: render, isBusy: function () { return busy; } };
})();
