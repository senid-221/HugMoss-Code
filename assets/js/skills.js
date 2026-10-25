/* skills.js — NVIDIA Agent Skills browser, activation store and prompt assembly. */
(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };
  var esc = function (s) { return window.HL ? HL.esc(s) : String(s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); };

  var STORE = "hugmoss.skills.v1";
  var MAX_ACTIVE = 6;
  var MAX_PROMPT_CHARS = 24000;
  var MAX_SKILL_CHARS = 14000;
  var MAX_CACHE = 24;
  var FETCH_TIMEOUT = 20000;

  var state = {
    active: [],
    cache: {},
    errors: {},
    loading: {},
    group: "all",
    query: "",
    activeOnly: false,
    open: null
  };

  function catalog() { return window.NvidiaSkills || null; }

  function read() {
    try {
      var raw = localStorage.getItem(STORE);
      var data = raw ? JSON.parse(raw) : null;
      if (!data) return;
      state.active = Array.isArray(data.active) ? data.active.filter(function (id) { return !!id; }) : [];
      state.cache = data.cache && typeof data.cache === "object" ? data.cache : {};
    } catch (e) { /* storage unavailable */ }
  }

  function write() {
    var names = state.active.slice();
    var cache = {};
    var keys = Object.keys(state.cache).sort(function (a, b) {
      return (state.cache[b].at || 0) - (state.cache[a].at || 0);
    }).slice(0, MAX_CACHE);
    keys.forEach(function (id) { cache[id] = state.cache[id]; });
    state.cache = cache;
    try {
      localStorage.setItem(STORE, JSON.stringify({ active: names, cache: cache }));
    } catch (e) { /* quota exceeded: keep memory state */ }
  }

  function toast(title, msg, type) {
    if (window.App && App.toast) App.toast({ title: title, msg: msg, type: type || "info" });
  }

  function isActive(id) { return state.active.indexOf(id) > -1; }

  function activeSkills() {
    var c = catalog();
    if (!c) return [];
    return state.active.map(function (id) { return c.get(id); }).filter(Boolean);
  }

  function sizeLabel(n) {
    if (!n) return "";
    return n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B";
  }

  /* ------------------------------ fetching ----------------------------- */
  function ensure(id) {
    if (state.cache[id] || state.loading[id]) return state.loading[id] || Promise.resolve(state.cache[id]);
    var c = catalog();
    if (!c) return Promise.reject(new Error("The NVIDIA catalog is not loaded."));
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT) : null;
    state.loading[id] = fetch(c.rawBase + encodeURIComponent(id) + "/SKILL.md", {
      method: "GET",
      headers: { Accept: "text/plain" },
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error("GitHub returned " + res.status + ".");
      return res.text();
    }).then(function (text) {
      var body = String(text || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
      if (!body) throw new Error("The skill file was empty.");
      var entry = { at: Date.now(), body: body.slice(0, MAX_SKILL_CHARS), full: body.length };
      state.cache[id] = entry;
      delete state.errors[id];
      write();
      return entry;
    }).catch(function (err) {
      var message = err && err.name === "AbortError"
        ? "GitHub did not answer in time."
        : (err && /Failed to fetch|Load failed|NetworkError/i.test(err.message || "")
          ? "The browser could not reach raw.githubusercontent.com."
          : (err && err.message) || "Could not load instructions.");
      state.errors[id] = message;
      throw new Error(message);
    }).finally(function () {
      clearTimeout(timer);
      delete state.loading[id];
      refreshRow(id);
    });
    return state.loading[id];
  }

  function loadMissing() {
    state.active.forEach(function (id) {
      if (!state.cache[id] && !state.loading[id] && catalog() && catalog().get(id)) {
        ensure(id).catch(function () { /* surfaced in the row */ });
      }
    });
  }

  /* ------------------------------ toggling ----------------------------- */
  function toggle(id) {
    var c = catalog();
    if (!c || !c.get(id)) return;
    var at = state.active.indexOf(id);
    if (at > -1) {
      state.active.splice(at, 1);
      write();
      render();
      toast("Skill disabled", "It will no longer be added to the agent prompt.", "info");
      return;
    }
    if (state.active.length >= MAX_ACTIVE) {
      toast("Skill limit reached", "Keep up to " + MAX_ACTIVE + " NVIDIA skills active at once. Disable one first.", "warn");
      return;
    }
    state.active.push(id);
    write();
    render();
    ensure(id).then(function (entry) {
      toast("Skill enabled", c.get(id).name + " · " + sizeLabel(entry.full) + " of instructions loaded.", "success");
    }).catch(function (err) {
      toast("Skill enabled without instructions", err.message + " The agent still receives the skill summary.", "warn");
    });
  }

  function clearActive() {
    if (!state.active.length) return;
    state.active = [];
    write();
    render();
    toast("Active skills cleared", "The agent prompt is back to the base instructions.", "info");
  }

  function copyText(text, label) {
    function done() { toast("Copied", label, "success"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done();
      else toast("Copy failed", "Select the command and copy it manually.", "error");
    }
  }

  /* ------------------------------- render ------------------------------ */
  function filtered() {
    var c = catalog();
    if (!c) return [];
    var q = state.query.trim().toLowerCase();
    return c.all.filter(function (skill) {
      if (state.activeOnly && !isActive(skill.name)) return false;
      if (state.group !== "all" && skill.groups.indexOf(state.group) < 0) return false;
      if (!q) return true;
      return (skill.name + " " + skill.description + " " + skill.groups.join(" ")).toLowerCase().indexOf(q) > -1;
    });
  }

  function rowHtml(skill) {
    var active = isActive(skill.name);
    var open = state.open === skill.name;
    var entry = state.cache[skill.name];
    var error = state.errors[skill.name];
    var loading = !!state.loading[skill.name];
    var note = active
      ? (entry ? "Instructions loaded · " + sizeLabel(entry.full) : loading ? "Loading instructions from GitHub…" : error ? error : "Waiting to load instructions…")
      : "Activating adds the official instructions to the agent prompt.";
    if (entry && entry.full > entry.body.length) note += " Truncated to " + sizeLabel(entry.body.length) + " for the prompt.";
    return '<article class="skill' + (active ? " is-on" : "") + (open ? " is-open" : "") + '" data-skill="' + esc(skill.name) + '">' +
      '<div class="skill__row">' +
        '<button class="skill__main" data-open="' + esc(skill.name) + '" aria-expanded="' + (open ? "true" : "false") + '" title="' + esc(skill.name) + '">' +
          '<span class="skill__name">' + esc(skill.name) + "</span>" +
          '<span class="skill__group">' + esc(skill.groups.join(" · ")) + "</span>" +
        "</button>" +
        '<button class="switch' + (active ? " switch--on" : "") + '" role="switch" aria-checked="' + (active ? "true" : "false") + '" aria-label="' + (active ? "Disable " : "Enable ") + esc(skill.name) + '" data-toggle="' + esc(skill.name) + '"><span class="switch__knob"></span></button>' +
      "</div>" +
      '<p class="skill__desc">' + esc(skill.description) + "</p>" +
      '<div class="skill__actions">' +
        '<button class="skill__act" data-copy="' + esc(skill.name) + '">' + Icons.ui("copy", 12) + " Copy install</button>" +
        '<a class="skill__act" href="' + esc("https://github.com/NVIDIA/skills/tree/main/skills/" + skill.name) + '" target="_blank" rel="noopener noreferrer">' + Icons.ui("external", 12) + " Source</a>" +
        (active && error ? '<button class="skill__act" data-retry="' + esc(skill.name) + '">Retry</button>' : "") +
      "</div>" +
      '<div class="skill__note">' + esc(note) + "</div>" +
    "</article>";
  }

  function renderChips() {
    var c = catalog();
    var host = $("#skillsChips");
    if (!c || !host) return;
    var chips = ['<button class="skills__chip' + (state.group === "all" ? " is-on" : "") + '" role="tab" aria-selected="' + (state.group === "all") + '" data-group="all">All <span>' + c.all.length + "</span></button>"];
    c.groups.forEach(function (g) {
      chips.push('<button class="skills__chip' + (state.group === g.title ? " is-on" : "") + '" role="tab" aria-selected="' + (state.group === g.title) + '" data-group="' + esc(g.title) + '">' + esc(g.title) + " <span>" + g.skills.length + "</span></button>");
    });
    host.innerHTML = chips.join("");
  }

  function renderSummary(rows) {
    var c = catalog();
    var summary = $("#skillsSummary");
    if (!summary) return;
    if (!c) { summary.textContent = "Catalog unavailable"; return; }
    var parts = [rows === null ? c.all.length + " skills" : rows + " of " + c.all.length + " skills"];
    if (state.active.length) parts.push(state.active.length + " active");
    summary.innerHTML = esc(parts.join(" · ")).replace(/(\d+) active$/, "<b>$1 active</b>");
    var clear = $("#skillsClear");
    if (clear) clear.hidden = !state.active.length;
  }

  function render() {
    var c = catalog();
    var host = $("#skillsList");
    if (!c || !host) return;
    renderChips();
    var rows = filtered();
    renderSummary(rows.length);
    if (!rows.length) {
      var message = state.activeOnly
        ? "No active skills match this view."
        : (state.query ? "No NVIDIA skills match “" + state.query + "”." : "No skills in this domain.");
      host.innerHTML = '<div class="skills__empty">' + esc(message) + "</div>";
    } else {
      host.innerHTML = rows.map(rowHtml).join("");
    }
    var badge = $("#skillsBadge");
    if (badge) {
      badge.textContent = String(state.active.length);
      badge.hidden = !state.active.length;
    }
    var only = $("#skillsActiveOnly");
    if (only) {
      only.classList.toggle("is-on", state.activeOnly);
      only.setAttribute("aria-pressed", state.activeOnly ? "true" : "false");
    }
  }

  function refreshRow(id) {
    var c = catalog();
    var host = $("#skillsList");
    if (!c || !host) return;
    var skill = c.get(id);
    if (!skill) return;
    var row = host.querySelector('[data-skill="' + id.replace(/"/g, '\\"') + '"]');
    if (!row) return;
    var wasOpen = state.open === id;
    var temp = document.createElement("div");
    temp.innerHTML = rowHtml(skill);
    var next = temp.firstElementChild;
    if (wasOpen) next.classList.add("is-open");
    row.replaceWith(next);
  }

  /* ------------------------------- prompt ------------------------------ */
  function promptBlock() {
    var active = activeSkills();
    if (!active.length) return "";
    var lines = [
      "<nvidia_skills>",
      "The user activated official NVIDIA Agent Skills. Each skill is a capability pack from NVIDIA/skills (CC-BY-4.0 AND Apache-2.0).",
      "Apply a skill only when the task matches its description. Follow its workflow, commands and safety notes, but keep HugMoss's rules above: you cannot run shell commands, and every file write still needs approval.",
      "Do not mention this block unless the user asks about skills."
    ];
    var budget = MAX_PROMPT_CHARS;
    active.forEach(function (skill) {
      var entry = state.cache[skill.name];
      var body = entry ? entry.body : "";
      lines.push("");
      lines.push("## " + skill.name);
      if (body && budget > 200) {
        var slice = body.slice(0, Math.min(MAX_SKILL_CHARS, budget));
        budget -= slice.length;
        lines.push(slice);
      } else {
        lines.push("Full instructions are not included in this prompt. Use this summary: " + skill.description);
      }
    });
    lines.push("</nvidia_skills>");
    var out = lines.join("\n");
    if (out.length > MAX_PROMPT_CHARS) {
      var closer = "\n</nvidia_skills>";
      out = out.slice(0, MAX_PROMPT_CHARS - closer.length).replace(/\s+$/, "") + closer;
    }
    return out;
  }

  /* ------------------------------- wiring ------------------------------ */
  function wire() {
    if (!catalog()) return;
    read();
    render();
    loadMissing();

    var search = $("#skillsSearch");
    var timer = null;
    if (search) {
      search.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.query = search.value;
          state.open = null;
          render();
        }, 90);
      });
    }

    $("#skillsChips").addEventListener("click", function (e) {
      var chip = e.target.closest("[data-group]");
      if (!chip) return;
      state.group = chip.getAttribute("data-group");
      state.open = null;
      render();
    });

    $("#skillsList").addEventListener("click", function (e) {
      var toggleBtn = e.target.closest("[data-toggle]");
      if (toggleBtn) { e.preventDefault(); toggle(toggleBtn.getAttribute("data-toggle")); return; }
      var copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) {
        e.preventDefault();
        var copyId = copyBtn.getAttribute("data-copy");
        copyText("npx skills add NVIDIA/skills --skill " + copyId, copyId);
        return;
      }
      var retry = e.target.closest("[data-retry]");
      if (retry) {
        e.preventDefault();
        delete state.errors[retry.getAttribute("data-retry")];
        refreshRow(retry.getAttribute("data-retry"));
        ensure(retry.getAttribute("data-retry")).then(function (entry) {
          toast("Instructions loaded", sizeLabel(entry.full) + " · " + retry.getAttribute("data-retry"), "success");
        }).catch(function (err) {
          toast("Still unavailable", err.message, "warn");
        });
        return;
      }
      var opener = e.target.closest("[data-open]");
      if (opener) {
        var id = opener.getAttribute("data-open");
        state.open = state.open === id ? null : id;
        render();
      }
    });

    $("#skillsActiveOnly").addEventListener("click", function () {
      state.activeOnly = !state.activeOnly;
      state.open = null;
      render();
    });

    $("#skillsClear").addEventListener("click", clearActive);
  }

  window.Skills = {
    render: render,
    promptBlock: promptBlock,
    activeIds: function () { return state.active.slice(); },
    activeCount: function () { return state.active.length; },
    isActive: isActive,
    focusSearch: function () { var s = $("#skillsSearch"); if (s) s.focus(); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
