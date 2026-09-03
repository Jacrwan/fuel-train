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
  function toolChip(name, input, _r) {
    var arg = input && Object.keys(input).length ? "  " + JSON.stringify(input).slice(0, 80) : "";
    return el("div", { class: "tool-chip", text: "⚙ " + name + arg });
  }
  function toolResultChip(r) {
    var ok = r && (r.ok !== false);
    var txt;
    if (!r) txt = "done";
    else if (r.error) txt = "error: " + r.error;
    else if (r.added) txt = "added " + (r.added.name || "") + (r.day ? " → " + r.day : "");
    else if (r.removed) txt = "removed " + r.removed;
    else if (r.logged) txt = "logged " + r.logged.name;
    else if (r.macro_targets) txt = "targets: " + r.macro_targets.calories + " kcal / " + r.macro_targets.protein + "P";
    else if (r.exercise && r.exercise.name) txt = "updated " + r.exercise.name;
    else if (r.plan) txt = "meal plan ready";
    else txt = "ok";
    return el("div", { class: "tool-chip " + (ok ? "ok" : "bad"), text: (ok ? "✓ " : "✗ ") + txt });
  }

  function send(text, container) {
    text = (text || "").trim();
    if (!text || busy) return;
    if (!App.ai.hasKey()) { util.toast("Add your Anthropic API key in Settings"); return; }

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
