/* window.App.ai — Anthropic API calls (direct from the browser).
   Three actions: meal plan, generate/update program, analyze progress.
   The API key is stored locally (Settings) and sent with the
   `anthropic-dangerous-direct-browser-access` header. Single-user, personal use. */
window.App = window.App || {};
(function () {
  "use strict";
  var ENDPOINT = "https://api.anthropic.com/v1/messages";

  // Fixed model for every AI call in the app.
  var MODEL = "claude-haiku-4-5";

  function cfg() {
    return { key: (App.store.state.settings.anthropicKey || "").trim(), model: MODEL };
  }

  function rawCall(body) {
    var c = cfg();
    if (!c.key) return Promise.reject(new Error("No Anthropic API key set. Add one in Settings."));
    body.model = body.model || c.model;
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": c.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var msg = (data && data.error && data.error.message) || ("HTTP " + r.status);
          throw new Error("Anthropic API: " + msg);
        }
        return data;
      });
    });
  }

  function callClaude(opts) {
    return rawCall({
      max_tokens: opts.maxTokens || 2000,
      system: opts.system || "",
      messages: [{ role: "user", content: opts.user }]
    }).then(function (data) {
      return ((data.content || []).filter(function (b) { return b.type === "text"; })[0] || {}).text || "";
    });
  }

  /* Agentic tool loop. messages: [{role, content}]. Calls onStep(kind, payload)
     for UI: kind = "text" | "tool" | "tool_result". Returns final assistant text. */
  function runToolLoop(opts) {
    var messages = opts.messages; // caller's live array — mutated in place so history persists
    var maxTurns = opts.maxTurns || 8;

    function turn(n) {
      if (n > maxTurns) return Promise.resolve("(stopped after " + maxTurns + " steps)");
      return rawCall({
        max_tokens: opts.maxTokens || 2500,
        system: opts.system || "",
        tools: opts.tools,
        messages: messages
      }).then(function (data) {
        messages.push({ role: "assistant", content: data.content });
        var textParts = (data.content || []).filter(function (b) { return b.type === "text" && b.text.trim(); });
        textParts.forEach(function (b) { if (opts.onStep) opts.onStep("text", b.text); });

        var toolUses = (data.content || []).filter(function (b) { return b.type === "tool_use"; });
        if (data.stop_reason !== "tool_use" || !toolUses.length) {
          return textParts.map(function (b) { return b.text; }).join("\n\n");
        }

        return Promise.all(toolUses.map(function (tu) {
          if (opts.onStep) opts.onStep("tool", { name: tu.name, input: tu.input });
          return Promise.resolve(opts.runTool(tu.name, tu.input)).then(function (result) {
            if (opts.onStep) opts.onStep("tool_result", { name: tu.name, result: result });
            return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 6000) };
          });
        })).then(function (results) {
          messages.push({ role: "user", content: results });
          return turn(n + 1);
        });
      });
    }
    return turn(1);
  }

  /* pull the first balanced {...} or [...] JSON value out of a string */
  function extractJSON(text) {
    var start = -1, open = "", close = "";
    for (var i = 0; i < text.length; i++) {
      if (text[i] === "{" || text[i] === "[") { start = i; open = text[i]; close = open === "{" ? "}" : "]"; break; }
    }
    if (start < 0) throw new Error("No JSON found in model response");
    var depth = 0, inStr = false, esc = false;
    for (var j = start; j < text.length; j++) {
      var ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === open) depth++;
        else if (ch === close) { depth--; if (depth === 0) return JSON.parse(text.slice(start, j + 1)); }
      }
    }
    throw new Error("Unbalanced JSON in model response");
  }

  // ---------------------------------------------------------------- meal plan
  function mealPlan(input) {
    // input: { hall, meals:[...], targets:{calories,protein,carbs,fat}, dishes:[{name, usda}] , stats }
    var lines = input.dishes.map(function (d) {
      var u = d.usda && d.usda.per100g;
      if (d.usda && d.usda.matched && u && u.kcal != null) {
        return "- " + d.name + "  [USDA per 100g: " +
          Math.round(u.kcal) + " kcal, P " + r1(u.protein) + ", C " + r1(u.carbs) + ", F " + r1(u.fat) +
          (d.usda.description ? "; matched \"" + d.usda.description + "\"" : "") + "]";
      }
      return "- " + d.name + "  [no reliable USDA match — estimate from the dish name]";
    }).join("\n");

    var t = input.targets;
    var system =
      "You are a sports-nutrition assistant helping a lean-bulk-averse athlete on an " +
      "aggressive cut plan meals from a fixed university dining-hall menu. Be realistic " +
      "about dining-hall portions. Prefer high-protein, high-volume, lower-calorie picks. " +
      "Only choose dishes from the provided list. Respond with JSON only, no prose.";

    var user =
      "ATHLETE: " + (input.stats || "") + "\n\n" +
      "MEAL(S) TO PLAN: " + input.meals.join(", ") + " at " + input.hall + "\n\n" +
      "TARGETS for this plan (the whole selection combined):\n" +
      "  calories " + t.calories + " kcal, protein " + t.protein + " g, carbs " + t.carbs + " g, fat " + t.fat + " g\n\n" +
      "AVAILABLE DISHES (with USDA per-100g macros where available):\n" + lines + "\n\n" +
      "Pick specific dishes and portion sizes that get as close as possible to the targets. " +
      "For each item give grams AND a human portion (e.g. \"1.5 cups\", \"2 pieces\"). " +
      "Compute each item's macros from the USDA per-100g values when present; otherwise estimate " +
      "and mark source \"ai-estimated\". Aim to hit protein at or slightly above target and stay " +
      "at or below the calorie target.\n\n" +
      "Return exactly this JSON shape:\n" +
      '{\n' +
      '  "hall": "' + input.hall + '",\n' +
      '  "meals": ' + JSON.stringify(input.meals) + ',\n' +
      '  "items": [\n' +
      '    {"dish": "", "grams": 0, "portion": "", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "source": "usda" | "ai-estimated", "note": ""}\n' +
      '  ],\n' +
      '  "totals": {"calories": 0, "protein": 0, "carbs": 0, "fat": 0},\n' +
      '  "notes": ""\n' +
      "}";

    return callClaude({ system: system, user: user, maxTokens: 2500 }).then(extractJSON);
  }

  // ---------------------------------------------------------- generate program
  function generateProgram(opts) {
    var st = App.store.state;
    var system =
      "You are a strength coach. Update a 7-day training program for an athlete on an " +
      "aggressive cut who wants a lean, athletic (not bulky) physique. Keep compound lifts " +
      "central, keep volume sustainable in a deficit, respect their schedule (gym Mon–Fri, " +
      "one bodyweight day on the weekend, Sunday rest is fine). Progress or swap exercises " +
      "based on the recent logs (what's stalling, what's missing). Respond with JSON only.";

    var user =
      "ATHLETE: " + statsBlob() + "\n\n" +
      "CURRENT PROGRAM (JSON):\n" + JSON.stringify(st.program, null, 1) + "\n\n" +
      "RECENT LOGS (last ~2 weeks, JSON of date -> exerciseId -> sets[{weight,reps}]):\n" +
      JSON.stringify(recentLogs(14), null, 1) + "\n\n" +
      (opts && opts.instructions ? "EXTRA INSTRUCTIONS: " + opts.instructions + "\n\n" : "") +
      "Return the full updated program in exactly the same JSON shape as CURRENT PROGRAM: " +
      "an object keyed monday..sunday, each an array of " +
      '{"id","name","targetSets","targetReps"}. Keep ids stable when an exercise is unchanged; ' +
      "use kebab-case ids for new exercises. JSON only.";

    return callClaude({ system: system, user: user, maxTokens: 3000 }).then(extractJSON);
  }

  // ---------------------------------------------------------- analyze progress
  function analyzeProgress() {
    var system =
      "You are a strength coach reviewing training logs. Give a short, concrete assessment: " +
      "what's progressing, what's stalling, consistency vs. the planned schedule, and one or " +
      "two specific suggestions. ~150-220 words, no preamble. Plain text only — no Markdown, " +
      "no **bold**, no ## headings, no bullet asterisks.";
    var user =
      "ATHLETE: " + statsBlob() + "\n\n" +
      "PROGRAM (JSON):\n" + JSON.stringify(App.store.state.program) + "\n\n" +
      "LOGS (last ~5 weeks, date -> exerciseId -> sets):\n" +
      JSON.stringify(recentLogs(35), null, 1);
    return callClaude({ system: system, user: user, maxTokens: 1200 });
  }

  // ---------------------------------------------------------------- helpers
  function r1(n) { return n == null ? "?" : Math.round(n * 10) / 10; }
  function statsBlob() {
    var s = App.store.state.settings.stats;
    return s.height + ", " + s.weightLb + " lb, goal " + s.goalWeightLb + " lb. " + s.notes;
  }
  function recentLogs(days) {
    var logs = App.store.state.logs, cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var out = {};
    Object.keys(logs).forEach(function (iso) {
      if (App.util.isoToDate(iso) >= cutoff) out[iso] = logs[iso];
    });
    return out;
  }

  /* one-shot: parse a free-text "what I ate" description into food items */
  function parseFoods(text) {
    var system = "You convert a casual description of food eaten into structured items with " +
      "realistic macro estimates. Respond with JSON only.";
    var user = 'The user ate: "' + text + '"\n\nReturn JSON:\n' +
      '{"items":[{"name":"","calories":0,"protein":0,"carbs":0,"fat":0,"assumptions":""}]}';
    return callClaude({ system: system, user: user, maxTokens: 1200 }).then(extractJSON);
  }

  App.ai = {
    mealPlan: mealPlan,
    generateProgram: generateProgram,
    analyzeProgress: analyzeProgress,
    parseFoods: parseFoods,
    runToolLoop: runToolLoop,
    _extractJSON: extractJSON,
    hasKey: function () { return !!cfg().key; }
  };
})();
