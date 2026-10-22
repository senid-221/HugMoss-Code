/* app.js — IDE shell: explorer, editor, tabs, diff, search, SCM, palette, settings, status bar. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* -------------------------- persistent settings ------------------------ */
  var STORE_KEY = "hugmoss.ide.settings";
  var defaults = {
    theme: "dark",
    fontSize: 13,
    wrap: false,
    minimap: true,
    agentMode: "agent",
    sbW: 264,
    agW: 400,
    panelH: 220,
    sidebarOpen: true,
    agentOpen: true,
    panelOpen: true,
    panelTab: "terminal"
  };
  var settings = (function () {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? Object.assign({}, defaults, JSON.parse(raw)) : Object.assign({}, defaults);
    } catch (e) { return Object.assign({}, defaults); }
  })();
  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
    }, 250);
  }

  /* ------------------------------- state -------------------------------- */
  var state = {
    view: "explorer",
    tabs: [],            /* {path, kind:'file'|'diff'|'welcome', dirty} */
    active: null,
    expanded: { "": true, src: true, "src/components": true },
    cursor: { line: 1, col: 1 },
    scm: [
      { path: "src/components/StatsCard.tsx", kind: "M" },
      { path: "src/hooks/useFarmData.ts", kind: "M" },
      { path: "src/components/Skeleton.tsx", kind: "U" }
    ],
    problems: [],
    searchSel: -1
  };

  var LANG_LABEL = {
    ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React",
    json: "JSON", css: "CSS", md: "Markdown", html: "HTML", svg: "SVG", env: "Dotenv",
    gitignore: "gitignore", txt: "Plain Text"
  };

  /* agent-authored files live in the workspace as the post-edit state; the
     pre-edit state is stored as `head`, so the changes read as uncommitted work. */
  var FINAL = {};
  Object.keys(WS.files).forEach(function (p) {
    if (WS.files[p].head != null) FINAL[p] = WS.files[p].content;
  });
  WS.reveal("src/components/Skeleton.tsx");

  /* ------------------------------- helpers ------------------------------ */
  function baseName(p) { return p.split("/").pop(); }
  function dirName(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function extKey(p) { return WS.language(p); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function clock() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }

  function toast(opts) {
    var host = $("#toasts");
    var el = document.createElement("div");
    el.className = "toast toast--" + (opts.type || "info");
    var icon = { success: "check", error: "errorCircle", warn: "warning", agent: "sparkle", info: "infoCircle" }[opts.type || "info"];
    el.innerHTML =
      '<span class="toast__icon">' + Icons.ui(icon, 15) + "</span>" +
      '<div class="toast__body"><div class="toast__title"></div>' +
      (opts.msg ? '<div class="toast__msg"></div>' : "") + "</div>" +
      '<button class="toast__close" aria-label="Dismiss notification">' + Icons.ui("close", 13) + "</button>";
    $(".toast__title", el).textContent = opts.title || "";
    if (opts.msg) $(".toast__msg", el).textContent = opts.msg;
    host.appendChild(el);
    var t = setTimeout(close, opts.timeout || 4200);
    function close() {
      clearTimeout(t);
      if (!el.parentNode) return;
      el.classList.add("is-out");
      setTimeout(function () { if (el.parentNode) el.remove(); }, 190);
    }
    $(".toast__close", el).addEventListener("click", close);
  }

  function logOutput(channel, text, cls) {
    var host = $("#pview-output");
    var line = document.createElement("div");
    line.className = "out-line";
    line.innerHTML = '<span class="out-time">' + clock() + "</span>" +
      '<span class="' + (cls || "out-info") + '">' + HL.esc((channel ? channel + " · " : "") + text) + "</span>";
    host.appendChild(line);
    host.scrollTop = host.scrollHeight;
  }

  /* =============================== THEME ================================ */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", settings.theme);
    var btn = $("#themeToggle");
    btn.innerHTML = Icons.ui(settings.theme === "dark" ? "sun" : "moon", 16);
    btn.setAttribute("data-tip", settings.theme === "dark" ? "Light Theme (Alt+T)" : "Dark Theme (Alt+T)");
    $$(".theme-card").forEach(function (c) {
      var on = c.getAttribute("data-theme-choice") === settings.theme;
      c.classList.toggle("theme-card--active", on);
      c.setAttribute("aria-checked", String(on));
    });
    renderMinimap();
  }
  function toggleTheme() {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    persist();
    applyTheme();
    logOutput("hugmoss", "theme switched to " + settings.theme, "out-info");
  }

  /* ============================== EDITOR =============================== */
  var inputLayer = null;

  function ensureInputLayer() {
    if (inputLayer) return inputLayer;
    inputLayer = document.createElement("textarea");
    inputLayer.className = "editor-input";
    inputLayer.setAttribute("aria-label", "Code editor");
    inputLayer.spellcheck = false;
    inputLayer.autocapitalize = "off";
    inputLayer.autocomplete = "off";
    $("#codeWrap").appendChild(inputLayer);

    inputLayer.addEventListener("input", onEditInput);
    inputLayer.addEventListener("keydown", onEditKeys);
    ["click", "keyup", "mouseup", "select", "input"].forEach(function (ev) {
      inputLayer.addEventListener(ev, updateCursorReadout);
    });
    inputLayer.addEventListener("scroll", syncInputScroll);
    return inputLayer;
  }

  var renderTimer = null;
  function onEditInput() {
    var tab = activeTab();
    if (!tab || tab.kind !== "file") return;
    WS.setContent(tab.path, inputLayer.value);
    if (!tab.dirty) { tab.dirty = true; renderTabs(); renderScm(); }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      var pos = inputLayer.selectionStart;
      renderCode(tab.path);
      restoreCaret(pos);
    }, 55);
  }
  function restoreCaret(pos) {
    try {
      inputLayer.selectionStart = inputLayer.selectionEnd = pos;
    } catch (e) { /* node replaced */ }
  }
  function onEditKeys(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      var s = inputLayer.selectionStart, en = inputLayer.selectionEnd;
      inputLayer.value = inputLayer.value.slice(0, s) + "  " + inputLayer.value.slice(en);
      inputLayer.selectionStart = inputLayer.selectionEnd = s + 2;
      onEditInput();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveActive();
    }
  }
  function syncInputScroll() {
    var scroll = $("#codeScroll");
    scroll.scrollTop = inputLayer.scrollTop;
    scroll.scrollLeft = inputLayer.scrollLeft;
    inputLayer.scrollTop = inputLayer.scrollTop;
    updateMinimapViewport();
  }
  function updateCursorReadout() {
    var before = inputLayer.value.slice(0, inputLayer.selectionStart).split("\n");
    state.cursor = { line: before.length, col: before[before.length - 1].length + 1 };
    $("#sbCursor").textContent = "Ln " + state.cursor.line + ", Col " + state.cursor.col;
    $$(".cl", $("#codeLines")).forEach(function (row) {
      row.classList.toggle("cl--active", Number(row.getAttribute("data-ln")) === state.cursor.line);
    });
    var symBtn = $(".crumb--sym", $("#breadcrumbs"));
    var tab = activeTab();
    if (symBtn && tab) {
      var sym = symbolFor(tab.path, state.cursor.line);
      symBtn.hidden = !sym;
      if (symBtn.previousElementSibling) symBtn.previousElementSibling.hidden = !sym;
      if (sym) symBtn.textContent = sym;
    }
  }

  function renderCode(path) {
    var content = WS.content(path) || "";
    var lang = extKey(path);
    var html = HL.render(content, lang);
    var rows = [];
    for (var i = 0; i < html.length; i++) {
      rows.push(
        '<div class="cl' + (i + 1 === state.cursor.line ? " cl--active" : "") + '" data-ln="' + (i + 1) + '">' +
        '<span class="cl__no">' + (i + 1) + "</span>" +
        '<span class="cl__txt">' + (html[i] || "&nbsp;") + "</span></div>"
      );
    }
    $("#codeLines").innerHTML = rows.join("");
    $("#codeScroll").scrollTop = 0;
    renderMinimap();
    renderBreadcrumbs(path);
    renderOutline(path);
  }

  function renderDiff(path) {
    var oldText = WS.head(path);
    var newText = WS.content(path);
    var lines = HL.diffLines(oldText || "", newText || "");
    var adds = 0, dels = 0, out = [];
    lines.forEach(function (row) {
      if (row.type === "add") adds++;
      if (row.type === "del") dels++;
    });
    $("#diffHead").innerHTML =
      '<span class="diff-label">' + HL.esc(baseName(path)) + "</span>" +
      '<span class="diff-stat diff-stat--add">+' + adds + "</span>" +
      '<span class="diff-stat diff-stat--del">−' + dels + "</span>" +
      '<span class="diff-hint">HEAD ⟶ working tree</span>';
    var body = [];
    lines.forEach(function (row) {
      var cls = row.type === "add" ? "drow--add" : row.type === "del" ? "drow--del" : "";
      body.push(
        '<div class="drow ' + cls + '">' +
        '<span class="drow__g">' + (row.type === "add" ? "+" : row.type === "del" ? "−" : "") + "</span>" +
        '<span class="drow__no">' + (row.a || "") + "</span>" +
        '<span class="drow__no drow__no--b">' + (row.b || "") + "</span>" +
        '<span class="drow__txt">' + (HL.renderLine(row.text, extKey(path)) || "&nbsp;") + "</span></div>"
      );
    });
    $("#diffBody").innerHTML = '<div class="diff-lines">' + body.join("") + "</div>";
  }

  /* ------------------------------ minimap ------------------------------ */
  var mmRaf = null;
  function renderMinimap() {
    var tab = activeTab();
    var mm = $("#minimap");
    if (!tab || tab.kind !== "file" || !settings.minimap) { mm.classList.add("is-hidden"); return; }
    mm.classList.remove("is-hidden");
    if (mmRaf) cancelAnimationFrame(mmRaf);
    mmRaf = requestAnimationFrame(function () { drawMinimap(tab.path); });
  }
  function drawMinimap(path) {
    var canvas = $("#minimapCanvas");
    var lines = HL.tokenizeLines(WS.content(path) || "", extKey(path));
    var scale = 1.15;
    var w = 66;
    var h = Math.max(60, Math.min(lines.length * 2.2, $("#codeWrap").clientHeight || 400));
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.height = h + "px";
    var ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, w, h);
    var palette = getComputedStyle(document.documentElement);
    var colors = {
      kw: palette.getPropertyValue("--tok-kw"), str: palette.getPropertyValue("--tok-str"),
      num: palette.getPropertyValue("--tok-num"), num2: palette.getPropertyValue("--tok-num"),
      fn: palette.getPropertyValue("--tok-fn"), type: palette.getPropertyValue("--tok-type"),
      com: palette.getPropertyValue("--tok-com"), tag: palette.getPropertyValue("--tok-tag"),
      attr: palette.getPropertyValue("--tok-attr"), prop: palette.getPropertyValue("--tok-prop"),
      var: palette.getPropertyValue("--tok-var"), plain: palette.getPropertyValue("--tok-plain")
    };
    for (var i = 0; i < lines.length; i++) {
      var x = 4;
      var y = i * 2.2;
      if (y > h) break;
      var toks = lines[i];
      for (var t = 0; t < toks.length && x < w - 4; t++) {
        var tok = toks[t];
        if (/^\s+$/.test(tok.text)) { x += tok.text.replace(/\t/g, "  ").length * 0.75; continue; }
        if (tok.type === "plain" && /[{}()[\];,.]/.test(tok.text)) continue;
        ctx.fillStyle = colors[tok.type] || colors.plain;
        var segW = Math.min(tok.text.length * 0.75, w - 4 - x);
        if (segW > 0.4) ctx.fillRect(x, y + 0.4, segW, 1.2);
        x += tok.text.replace(/\t/g, "  ").length * 0.75;
      }
    }
    updateMinimapViewport();
  }
  function updateMinimapViewport() {
    var wrap = $("#codeWrap");
    var scroll = $("#codeScroll");
    var vp = $("#minimapVp");
    if (!settings.minimap || wrap.clientHeight === 0) return;
    var ratio = scroll.scrollHeight ? scroll.clientHeight / scroll.scrollHeight : 1;
    var mapH = $("#minimap").clientHeight;
    vp.style.height = Math.max(20, mapH * ratio) + "px";
    var top = scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight);
    vp.style.top = top * (mapH - vp.offsetHeight) + "px";
  }
  function initMinimapDrag() {
    var vp = $("#minimapVp");
    var dragging = false;
    vp.addEventListener("mousedown", function (e) { dragging = true; vp.classList.add("is-drag"); e.preventDefault(); });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var mm = $("#minimap");
      var scroll = $("#codeScroll");
      var frac = (e.clientY - mm.getBoundingClientRect().top) / mm.clientHeight;
      scroll.scrollTop = Math.max(0, Math.min(1, frac)) * (scroll.scrollHeight - scroll.clientHeight);
      if (inputLayer) { inputLayer.scrollTop = scroll.scrollTop; }
      updateMinimapViewport();
    });
    document.addEventListener("mouseup", function () { dragging = false; vp.classList.remove("is-drag"); });
    $("#codeScroll").addEventListener("scroll", function () {
      if (inputLayer) { inputLayer.scrollTop = $("#codeScroll").scrollTop; inputLayer.scrollLeft = $("#codeScroll").scrollLeft; }
      updateMinimapViewport();
    });
  }

  /* ----------------------------- breadcrumbs --------------------------- */
  function renderBreadcrumbs(path) {
    var parts = path.split("/");
    var html = "";
    parts.forEach(function (part, i) {
      var last = i === parts.length - 1;
      if (i > 0) html += '<span class="crumb__sep">' + Icons.ui("chevron", 12) + "</span>";
      html += '<button class="crumb' + (last ? " crumb--last" : "") + '">' +
        (last ? '<span class="crumb__icon">' + Icons.file(path) + "</span>" : "") + HL.esc(part) + "</button>";
    });
    var sym = symbolFor(path, state.cursor.line);
    if (sym) {
      html += '<span class="crumb__sep">' + Icons.ui("chevron", 12) + "</span>" +
        '<button class="crumb crumb--sym">' + HL.esc(sym) + "</button>";
    }
    $("#breadcrumbs").innerHTML = html;
  }
  function symbolFor(path, line) {
    var lines = (WS.content(path) || "").split("\n");
    var found = null;
    for (var i = 0; i < Math.min(lines.length, line || lines.length); i++) {
      var m = lines[i].match(/(?:export\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/);
      if (m) found = m[1] + (/\bfunction\b|\bconst .*=>/.test(lines[i]) ? " (function)" : lines[i].indexOf("class") >= 0 ? " (class)" : " (const)");
    }
    return found;
  }

  /* ------------------------------- outline ----------------------------- */
  function renderOutline(path) {
    var host = $("#outlineTree");
    if (!path) { host.innerHTML = '<div class="trow trow--muted" style="cursor:default">No symbols</div>'; return; }
    var lines = (WS.content(path) || "").split("\n");
    var syms = [];
    lines.forEach(function (ln, i) {
      var m = ln.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/);
      if (m) syms.push({ name: m[1], line: i + 1, kind: ln.trim().split(/\s+/).pop() });
    });
    if (!syms.length) { host.innerHTML = '<div class="trow trow--muted" style="cursor:default">No symbols</div>'; return; }
    host.innerHTML = syms.slice(0, 12).map(function (s) {
      return '<div class="trow" data-jump="' + s.line + '" style="padding-left:' + (10 + 16) + 'px">' +
        '<span class="trow__icon">' + Icons.ui("dot", 14) + "</span>" +
        '<span class="trow__name">' + HL.esc(s.name) + "</span>" +
        '<span class="trow__badge">' + s.line + "</span></div>";
    }).join("");
    $$("[data-jump]", host).forEach(function (row) {
      row.addEventListener("click", function () { jumpToLine(Number(row.getAttribute("data-jump"))); });
    });
  }
  function jumpToLine(line) {
    var row = $('.cl[data-ln="' + line + '"]');
    if (!row || !inputLayer) return;
    var lines = (WS.content(activeTab().path) || "").split("\n");
    var pos = 0;
    for (var i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    inputLayer.focus();
    inputLayer.selectionStart = pos;
    inputLayer.selectionEnd = pos + (lines[line - 1] || "").length;
    var top = row.offsetTop - 60;
    $("#codeScroll").scrollTop = Math.max(0, top);
    inputLayer.scrollTop = $("#codeScroll").scrollTop;
    state.cursor.line = line;
    updateCursorReadout();
  }

  function renderTimeline() {
    var items = [
      { t: "feat: dashboard grid + stats cards", s: "2h ago", icon: "gitCommit" },
      { t: "fix: clamp humidity reading range", s: "yesterday", icon: "gitCommit" },
      { t: "chore: scaffold Vite + TypeScript", s: "3d ago", icon: "gitCommit" }
    ];
    $("#timelineTree").innerHTML = items.map(function (it) {
      return '<div class="trow trow--muted" style="padding-left:26px">' +
        '<span class="trow__icon">' + Icons.ui(it.icon, 14) + "</span>" +
        '<span class="trow__name">' + HL.esc(it.t) + "</span>" +
        '<span class="trow__badge">' + it.s + "</span></div>";
    }).join("");
  }

  /* =============================== TABS ================================= */
  function activeTab() {
    return state.tabs.filter(function (t) { return t.path === state.active; })[0] || null;
  }
  function findTab(path) {
    return state.tabs.filter(function (t) { return t.path === path; })[0] || null;
  }

  function openFile(path, opts) {
    opts = opts || {};
    if (!WS.files[path]) { toast({ title: "File not found", msg: path, type: "error" }); return; }
    var tab = findTab(path);
    if (!tab) {
      tab = { path: path, kind: opts.kind || "file", dirty: false };
      state.tabs.push(tab);
    } else if (opts.kind) {
      tab.kind = opts.kind;
    }
    state.active = path;
    if (opts.kind === "diff") renderDiff(path); else renderCode(path);
    showLayer(opts.kind === "diff" ? "diff" : "code");
    renderTabs();
    renderTree();
    var content = WS.content(path) || "";
    if (inputLayer) {
      inputLayer.value = content;
      if (opts.line) {
        var idx = content.split("\n").slice(0, opts.line - 1).join("\n").length + (opts.line > 1 ? 1 : 0);
        inputLayer.selectionStart = inputLayer.selectionEnd = idx;
        state.cursor = { line: opts.line, col: 1 };
        var rowEl = $('.cl[data-ln="' + opts.line + '"]');
        if (rowEl) {
          $("#codeScroll").scrollTop = Math.max(0, rowEl.offsetTop - 80);
          inputLayer.scrollTop = $("#codeScroll").scrollTop;
        }
      }
      updateCursorReadout();
    }
    $("#sbLang").textContent = LANG_LABEL[extKey(path)] || "Plain Text";
    renderOutline(path);
    renderMinimap();
    if (opts.focus) inputLayer && inputLayer.focus();
    closeDrawers();
  }

  function openDiff(path) { openFile(path, { kind: "diff" }); }

  function closeTab(path) {
    var idx = state.tabs.findIndex(function (t) { return t.path === path; });
    if (idx < 0) return;
    var tab = state.tabs[idx];
    if (tab.dirty) {
      toast({ title: "Discard unsaved changes?", msg: baseName(path) + " — closed without saving", type: "warn" });
    }
    state.tabs.splice(idx, 1);
    if (state.active === path) {
      var next = state.tabs[Math.min(idx, state.tabs.length - 1)];
      state.active = next ? next.path : null;
      if (next) {
        if (next.kind === "diff") { renderDiff(next.path); showLayer("diff"); }
        else { renderCode(next.path); showLayer("code"); if (inputLayer) inputLayer.value = WS.content(next.path); }
        $("#sbLang").textContent = LANG_LABEL[extKey(next.path)] || "Plain Text";
      } else {
        showLayer("welcome");
        $("#sbLang").textContent = "Plain Text";
        $("#breadcrumbs").innerHTML = "";
        renderOutline(null);
      }
    }
    renderTabs();
    renderTree();
    renderMinimap();
  }

  function saveActive() {
    var tab = activeTab();
    if (!tab || tab.kind !== "file") { toast({ title: "Nothing to save", type: "info" }); return; }
    tab.dirty = false;
    renderTabs();
    renderScm();
    toast({ title: "Saved", msg: baseName(tab.path) + " · formatted with Prettier", type: "success" });
    logOutput("hugmoss", "saved " + tab.path, "out-info");
  }

  function showLayer(which) {
    $("#codeWrap").classList.toggle("is-code", which === "code");
    $("#codeWrap").classList.toggle("is-diff", which === "diff");
    $("#codeScroll").hidden = which !== "code";
    $("#diffView").hidden = which !== "diff";
    $("#welcomeView").hidden = which !== "welcome";
    $("#minimap").hidden = which !== "code";
    if (inputLayer) inputLayer.hidden = which !== "code";
  }

  function renderTabs() {
    var host = $("#tabstrip");
    var scroll = $("#tabstrip .tabstrip__scroll");
    var list = state.tabs.map(function (tab) {
      var isDiff = tab.kind === "diff";
      return '<div class="tab' + (tab.path === state.active ? " tab--active" : "") + (tab.dirty ? " tab--dirty" : "") +
        '" role="tab" aria-selected="' + (tab.path === state.active) + '" data-path="' + HL.esc(tab.path) + '">' +
        '<span class="tab__icon' + (isDiff ? " tab__icon--diff" : "") + '">' + Icons.file(tab.path) + "</span>" +
        '<span class="tab__name">' + HL.esc(baseName(tab.path)) + (isDiff ? " ⟍ Working Tree" : "") + "</span>" +
        '<span class="tab__dot"></span>' +
        '<span class="tab__close" role="button" aria-label="Close ' + HL.esc(baseName(tab.path)) + '">' + Icons.ui("close", 13) + "</span>" +
        "</div>";
    }).join("");
    host.innerHTML = '<div class="tabstrip__scroll">' + list + "</div>" +
      '<div class="tabstrip__actions">' +
      '<button class="sbtn" data-act="split" aria-label="Split editor" data-tip="Split Editor">' + Icons.ui("split", 15) + "</button>" +
      '<button class="sbtn" data-act="closeAll" aria-label="Close all editors" data-tip="Close All">' + Icons.ui("close", 15) + "</button>" +
      "</div>";
    $$(".tab", host).forEach(function (el) {
      var p = el.getAttribute("data-path");
      el.addEventListener("click", function (e) {
        if (e.target.closest(".tab__close")) { closeTab(p); return; }
        var tab = findTab(p);
        state.active = p;
        if (tab && tab.kind === "diff") { renderDiff(p); showLayer("diff"); }
        else { renderCode(p); showLayer("code"); if (inputLayer) { inputLayer.value = WS.content(p); updateCursorReadout(); } }
        $("#sbLang").textContent = LANG_LABEL[extKey(p)] || "Plain Text";
        renderTabs(); renderTree(); renderMinimap();
      });
    });
    $$('[data-act="closeAll"]', host).forEach(function (b) {
      b.addEventListener("click", function () { state.tabs = []; state.active = null; renderTabs(); renderTree(); showLayer("welcome"); renderMinimap(); });
    });
    $$('[data-act="split"]', host).forEach(function (b) {
      b.addEventListener("click", function () { toast({ title: "Split editor", msg: "Grouped layout is not available in this preview", type: "info" }); });
    });
  }

  /* ============================== EXPLORER ============================== */
  function renderTree() {
    var host = $("#fileTree");
    var root = WS.buildTree();
    var rows = [];
    (function walk(node, depth) {
      node.dirs.forEach(function (dir) {
        var open = !!state.expanded[dir.path];
        rows.push('<div class="trow trow--dir" data-dir="' + HL.esc(dir.path) + '" style="padding-left:' + (6 + depth * 12) + 'px">' +
          '<span class="trow__chev"><span class="chev' + (open ? " chev--open" : "") + '">' + Icons.ui("chevron", 11) + "</span></span>" +
          '<span class="trow__icon">' + Icons.ui(open ? "folderOpen" : "folder", 15) + "</span>" +
          '<span class="trow__name">' + HL.esc(dir.name) + "</span></div>");
        if (open) walk(dir, depth + 1);
      });
      node.files.forEach(function (f) {
        var changed = state.scm.some(function (c) { return c.path === f.path; });
        rows.push('<div class="trow' + (f.path === state.active ? " trow--active" : "") + '" data-file="' + HL.esc(f.path) + '" style="padding-left:' + (6 + depth * 12 + 14) + 'px">' +
          '<span class="trow__icon">' + Icons.file(f.path) + "</span>" +
          '<span class="trow__name">' + HL.esc(f.name) + "</span>" +
          (changed ? '<span class="trow__badge" style="color:var(--warning)">●</span>' : "") + "</div>");
      });
    })(root, 0);
    host.innerHTML = rows.join("");
    $$("[data-dir]", host).forEach(function (el) {
      el.addEventListener("click", function () {
        var p = el.getAttribute("data-dir");
        state.expanded[p] = !state.expanded[p];
        renderTree();
      });
    });
    $$("[data-file]", host).forEach(function (el) {
      el.addEventListener("click", function () { openFile(el.getAttribute("data-file")); });
    });
  }

  function toggleSection(btnId, targetSel) {
    var btn = $(btnId);
    btn.addEventListener("click", function () {
      var chev = $(".chev", btn);
      var open = chev.classList.toggle("chev--open");
      $(targetSel).style.display = open ? "" : "none";
    });
  }

  /* =============================== SEARCH =============================== */
  function buildMatcher(query, opts) {
    if (!query) return null;
    var flags = "g";
    var pattern;
    if (opts.regex) {
      try { pattern = new RegExp(query, opts.caseSensitive ? flags : flags + "i"); }
      catch (e) { return { error: e.message }; }
    } else {
      var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (opts.wholeWord) escaped = "\\b" + escaped + "\\b";
      pattern = new RegExp(escaped, opts.caseSensitive ? flags : flags + "i");
    }
    return { re: pattern };
  }

  function runSearch(rawQuery) {
    var host = $("#searchResults");
    var footer = $("#searchFooter");
    var query = rawQuery.trim();
    if (!query) { host.innerHTML = ""; footer.textContent = ""; return; }
    var matcher = buildMatcher(query, {
      caseSensitive: $("#searchCase").classList.contains("is-on"),
      wholeWord: $("#searchWord").classList.contains("is-on"),
      regex: $("#searchRegex").classList.contains("is-on")
    });
    if (matcher && matcher.error) {
      host.innerHTML = '<div class="prob-empty" style="color:var(--danger)">Invalid regular expression: ' + HL.esc(matcher.error) + "</div>";
      footer.textContent = "";
      return;
    }
    var total = 0, files = 0, html = [];
    WS.visiblePaths().forEach(function (path) {
      var lines = (WS.content(path) || "").split("\n");
      var hits = [];
      lines.forEach(function (ln, i) {
        matcher.re.lastIndex = 0;
        var count = 0, m;
        while ((m = matcher.re.exec(ln)) && count < 20) { count++; if (m.index === matcher.re.lastIndex) matcher.re.lastIndex++; }
        if (count) hits.push({ line: i + 1, text: ln.trim().slice(0, 140), n: count });
      });
      if (!hits.length) return;
      files++;
      total += hits.length;
      html.push('<div class="sres-file"><div class="sres-file__head" data-open="' + HL.esc(path) + '">' +
        "<span>" + Icons.file(path) + "</span>" + HL.esc(baseName(path)) +
        '<span class="sres-file__path">' + HL.esc(dirName(path) || ".") + " · " + hits.length + "</span></div>" +
        hits.slice(0, 12).map(function (h) {
          var shown = h.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
          var re = new RegExp(matcher.re.source, matcher.re.flags);
          shown = shown.replace(re, function (m) { return '<mark class="tok-mark">' + m + "</mark>"; });
          return '<div class="sres-match" data-open="' + HL.esc(path) + '" data-line="' + h.line + '">' +
            '<span class="sres-match__ln">' + h.line + "</span>" +
            '<span class="sres-match__code">' + shown + "</span></div>";
        }).join("") + "</div>");
    });
    host.innerHTML = html.join("") || '<div class="prob-empty">No results found. Try a different term.</div>';
    footer.textContent = total ? total + " results in " + files + " files" : "0 results";
    $$("[data-open]", host).forEach(function (el) {
      el.addEventListener("click", function () {
        openFile(el.getAttribute("data-open"), { line: Number(el.getAttribute("data-line") || 1) });
        $$(".sres-match", host).forEach(function (r) { r.classList.remove("is-sel"); });
        el.classList.add("is-sel");
      });
    });
  }

  /* =========================== SOURCE CONTROL =========================== */
  function renderScm() {
    var list = state.scm.map(function (c) {
      var badge = c.kind === "U" || c.kind === "A" ? "u" : c.kind === "D" ? "d" : "m";
      return '<div class="scm__item" data-diff="' + HL.esc(c.path) + '">' +
        '<span class="scm__badge scm__badge--' + badge + '">' + c.kind + "</span>" +
        "<span>" + Icons.file(c.path) + "</span>" +
        '<span class="scm__file">' + HL.esc(baseName(c.path)) + "</span>" +
        '<span class="scm__dir">' + HL.esc(dirName(c.path) || ".") + "</span></div>";
    }).join("");
    $("#scmList").innerHTML = list || '<div class="scm__empty">No changes detected in the working tree.</div>';
    $("#scmCount").textContent = String(state.scm.length);
    var badge = $("#scmBadge");
    badge.textContent = String(state.scm.length);
    badge.classList.toggle("is-hidden-note", !state.scm.length);
    badge.style.display = state.scm.length ? "" : "none";
    badge.classList.add("abtn__badge--pulse");
    setTimeout(function () { badge.classList.remove("abtn__badge--pulse"); }, 400);
    $$("[data-diff]", $("#scmList")).forEach(function (el) {
      el.addEventListener("click", function () { openDiff(el.getAttribute("data-diff")); activateView("scm"); });
    });
  }

  function scmAdd(path, kind) {
    var existing = state.scm.filter(function (c) { return c.path === path; })[0];
    if (existing) { existing.kind = kind; } else { state.scm.push({ path: path, kind: kind }); }
    renderScm();
    renderTree();
  }

  function commit() {
    var input = $("#scmCommitInput");
    var msg = input.value.trim();
    if (!msg) return;
    var n = state.scm.length;
    state.scm = [];
    input.value = "";
    $("#scmCommitBtn").disabled = true;
    renderScm();
    toast({ title: "Committed to main", msg: '"' + msg + '" · ' + n + " file" + (n === 1 ? "" : "s") + " staged", type: "success" });
    logOutput("git", "main: " + msg, "out-ok");
  }

  /* ============================ BOTTOM PANEL =========================== */
  function setPanelTab(name) {
    settings.panelTab = name;
    $$(".ptab").forEach(function (t) { t.classList.toggle("ptab--active", t.getAttribute("data-panel") === name); });
    ["problems", "output", "debug", "terminal", "ports"].forEach(function (p) {
      $("#pview-" + p).hidden = p !== name;
    });
    persist();
    if (name === "terminal" && window.Terminal) Terminal.focus();
  }
  function setPanelOpen(open) {
    settings.panelOpen = open;
    $("#bottomPanel").classList.toggle("is-hidden", !open);
    $("#panelResize").classList.toggle("is-hidden", !open);
    $("#togglePanelBtn").classList.toggle("is-on", open);
    persist();
    updateMinimapViewport();
  }
  function renderProblems() {
    var host = $("#pview-problems");
    var errs = state.problems.filter(function (p) { return p.sev === "error"; }).length;
    var warns = state.problems.length - errs;
    $("#sbErrCount").textContent = String(errs);
    $("#sbWarnCount").textContent = String(warns);
    var badge = $("#problemsBadge");
    badge.textContent = String(state.problems.length);
    badge.classList.toggle("ptab__badge--warn", state.problems.length > 0);
    host.innerHTML = state.problems.length ? state.problems.map(function (p, i) {
      return '<div class="prob-item" data-prob="' + i + '">' +
        '<span class="prob-icon prob-icon--' + (p.sev === "error" ? "err" : "warn") + '">' +
        Icons.ui(p.sev === "error" ? "errorCircle" : "warning", 14) + "</span>" +
        '<span class="prob-msg"><span class="prob-msg__text">' + HL.esc(p.msg) + "</span>" +
        '<span class="prob-msg__src">' + HL.esc(p.path) + ":" + p.line + ":" + p.col + " " + HL.esc(p.src || "") + "</span></span></div>";
    }).join("") : '<div class="prob-empty">No problems have been detected in the workspace.</div>';
    $$("[data-prob]", host).forEach(function (el) {
      el.addEventListener("click", function () {
        var p = state.problems[Number(el.getAttribute("data-prob"))];
        openFile(p.path, { line: p.line });
      });
    });
  }

  function seedPanelViews() {
    $("#pview-output").innerHTML =
      '<div class="out-line"><span class="out-time">12:41</span><span class="out-info">hugmoss · workspace index ready (26 files)</span></div>' +
      '<div class="out-line"><span class="out-time">12:44</span><span class="out-agent">agent · session "loading skeletons" completed</span></div>' +
      '<div class="out-line"><span class="out-time">12:44</span><span class="out-ok">vite · 3 modules invalidated, hmr update</span></div>' +
      '<div class="out-line"><span class="out-time">12:47</span><span class="out-info">git · main ← working tree: 3 changes</span></div>';
    $("#pview-debug").innerHTML = '<div class="prob-empty">Debug console is empty. Start a session with <span class="c-accent">Run ▸ Start Debugging</span>.</div>';
    $("#pview-ports").innerHTML =
      '<table class="ports-table"><thead><tr><th>Local Address</th><th>Forwarded Port</th><th>Source</th><th>Visibility</th></tr></thead><tbody>' +
      '<tr><td class="port-src">localhost:5173</td><td>5173</td><td>npm: run dev</td><td>Other</td></tr>' +
      '<tr><td class="port-src">localhost:24678</td><td>24678</td><td>vite: hmr</td><td>Brownie</td></tr></tbody></table>';
    renderProblems();
  }

  /* ============================ VIEW SWITCH ============================ */
  function activateView(name) {
    settings.sidebarOpen = true;
    setSidebarOpen(true);
    state.view = name;
    $$(".abtn[data-view]").forEach(function (b) { b.classList.toggle("abtn--active", b.getAttribute("data-view") === name); });
    $$(".sidebar__view").forEach(function (v) { v.classList.toggle("sidebar__view--active", v.id === "view-" + name); });
    var titles = { explorer: "Explorer", search: "Search", scm: "Source Control", debug: "Run and Debug", extensions: "Extensions" };
    $("#sidebarTitle").textContent = titles[name] || "Explorer";
    if (name === "search") $("#searchInput").focus();
    closeDrawers();
  }
  function setSidebarOpen(open) {
    settings.sidebarOpen = open;
    $("#sidebar").classList.toggle("is-hidden", !open);
    $("#sidebarResize").classList.toggle("is-hidden", !open);
    $("#toggleSidebarBtn").classList.toggle("is-on", open);
    persist();
    if (!open && isDrawer("sidebar")) $("#sidebar").classList.remove("is-open");
  }
  function setAgentOpen(open) {
    settings.agentOpen = open;
    var panel = $("#agentPanel");
    panel.classList.toggle("is-hidden", !open);
    $("#agentResize").classList.toggle("is-hidden", !open);
    $("#toggleChatBtn").classList.toggle("is-on", open);
    $("#abtnAgent").classList.toggle("abtn--active", open);
    $("#abtnAgent").classList.toggle("abtn--accent", open);
    persist();
    if (open) { if (isDrawer("agent")) panel.classList.add("is-open"); setTimeout(function () { if (window.Agent) Agent.focusInput(); }, 60); }
    else if (isDrawer("agent")) panel.classList.remove("is-open");
    updateMinimapViewport();
  }

  /* ============================== DRAWERS ============================== */
  function isDrawer(which) {
    if (which === "agent") return window.matchMedia("(max-width: 1180px)").matches;
    return window.matchMedia("(max-width: 860px)").matches;
  }
  function syncDrawerChrome() {
    var drawerAgent = isDrawer("agent") && settings.agentOpen;
    var drawerSide = isDrawer("sidebar") && settings.sidebarOpen;
    if (drawerAgent || drawerSide) $("#scrim").hidden = false;
    else $("#scrim").hidden = true;
    $("#sidebar").classList.toggle("is-open", drawerSide);
    $("#agentPanel").classList.toggle("is-open", drawerAgent);
    $("#app").classList.toggle("has-drawer", drawerAgent || drawerSide);
  }
  function closeDrawers() {
    $("#scrim").hidden = true;
    $("#sidebar").classList.remove("is-open");
    $("#agentPanel").classList.remove("is-open");
    $("#app").classList.remove("has-drawer");
  }

  /* ============================ COMMANDS =============================== */
  var commands = [
    { id: "palette.files", label: "Go to File", hint: "Ctrl+K" },
    { id: "agent.new", label: "Agent: New Session", hint: "" },
    { id: "agent.focus", label: "Agent: Focus Chat", hint: "Alt+A" },
    { id: "agent.run", label: "Agent: Run Demo Task", hint: "" },
    { id: "theme.toggle", label: "Toggle Theme", hint: "Alt+T" },
    { id: "sidebar.toggle", label: "Toggle Sidebar", hint: "Alt+B" },
    { id: "panel.toggle", label: "Toggle Panel", hint: "Alt+J" },
    { id: "chat.toggle", label: "Toggle Agent Chat", hint: "Alt+A" },
    { id: "file.new", label: "New File", hint: "" },
    { id: "file.save", label: "Save", hint: "Ctrl+S" },
    { id: "file.saveAll", label: "Save All", hint: "" },
    { id: "tab.close", label: "Close Editor", hint: "" },
    { id: "format", label: "Format Document", hint: "" },
    { id: "wrap.toggle", label: "Toggle Word Wrap", hint: "" },
    { id: "minimap.toggle", label: "Toggle Minimap", hint: "" },
    { id: "search.view", label: "Search: Find in Files", hint: "" },
    { id: "scm.view", label: "Source Control: Open View", hint: "" },
    { id: "term.dev", label: "Terminal: Run npm run dev", hint: "" },
    { id: "term.build", label: "Terminal: Run npm run build", hint: "" },
    { id: "term.new", label: "Terminal: New Terminal", hint: "" },
    { id: "settings", label: "Open Settings", hint: "" },
    { id: "welcome", label: "Show Welcome Tab", hint: "" }
  ];

  function runCommand(id) {
    switch (id) {
      case "palette.files": openPalette("files", ""); break;
      case "agent.new": if (window.Agent) { setAgentOpen(true); Agent.newSession(); } break;
      case "agent.focus": setAgentOpen(true); Agent && Agent.focusInput(); break;
      case "agent.run": setAgentOpen(true); if (window.Agent) Agent.runDemo(); break;
      case "theme.toggle": toggleTheme(); break;
      case "sidebar.toggle": setSidebarOpen(!settings.sidebarOpen); syncDrawerChrome(); break;
      case "panel.toggle": setPanelOpen(!settings.panelOpen); break;
      case "chat.toggle": setAgentOpen(!settings.agentOpen); syncDrawerChrome(); break;
      case "file.new": newFile(); break;
      case "file.save": saveActive(); break;
      case "file.saveAll": state.tabs.forEach(function (t) { t.dirty = false; }); renderTabs(); renderScm(); toast({ title: "Saved", msg: "All editors saved", type: "success" }); break;
      case "tab.close": if (state.active) closeTab(state.active); break;
      case "format": toast({ title: "Formatted", msg: baseName(state.active || "") + " · Prettier", type: "success" }); break;
      case "wrap.toggle": setWrap(!settings.wrap); break;
      case "minimap.toggle": setMinimap(!settings.minimap); break;
      case "search.view": activateView("search"); break;
      case "scm.view": activateView("scm"); break;
      case "term.dev": setPanelOpen(true); setPanelTab("terminal"); Terminal.run("npm run dev"); break;
      case "term.build": setPanelOpen(true); setPanelTab("terminal"); Terminal.run("npm run build"); break;
      case "term.new": setPanelOpen(true); setPanelTab("terminal"); Terminal.newSession(); break;
      case "settings": openSettings(); break;
      case "welcome": state.tabs = []; state.active = null; renderTabs(); renderTree(); showLayer("welcome"); break;
    }
  }

  function newFile() {
    var i = 1, name;
    do { name = "untitled-" + i + ".ts"; i++; } while (WS.files["src/" + name]);
    WS.files["src/" + name] = {
      language: "ts",
      content: 'export const untitled' + (i - 1) + ' = {\n  created: "' + new Date().toISOString().slice(0, 10) + '",\n};\n'
    };
    state.expanded["src"] = true;
    scmAdd("src/" + name, "U");
    renderTree();
    openFile("src/" + name);
    toast({ title: "New file", msg: "src/" + name, type: "info" });
  }

  /* =========================== COMMAND PALETTE ========================= */
  var paletteState = { mode: "commands", rows: [], sel: 0 };

  function fuzzy(query, text) {
    if (!query) return { score: 1, hits: [] };
    var hay = text.toLowerCase(), needle = query.toLowerCase();
    var hi = 0, score = 0, hits = [], streak = 0;
    for (var i = 0; i < needle.length; i++) {
      var at = hay.indexOf(needle[i], hi);
      if (at < 0) return null;
      if (at === hi) streak++; else streak = 0;
      score += 4 + streak * 3 + (at === 0 || /[\s\-/.:_]/.test(hay[at - 1]) ? 5 : 0);
      hits.push(at);
      hi = at + 1;
    }
    return { score: score - hi * 0.15, hits: hits };
  }
  function markHits(text, hits) {
    if (!hits || !hits.length) return HL.esc(text);
    var out = "", prev = 0;
    var groups = [];
    var start = hits[0], last = hits[0];
    for (var i = 1; i < hits.length; i++) {
      if (hits[i] === last + 1) { last = hits[i]; continue; }
      groups.push([start, last]); start = hits[i]; last = hits[i];
    }
    groups.push([start, last]);
    groups.forEach(function (g) {
      out += HL.esc(text.slice(prev, g[0])) + '<span class="hit">' + HL.esc(text.slice(g[0], g[1] + 1)) + "</span>";
      prev = g[1] + 1;
    });
    return out + HL.esc(text.slice(prev));
  }

  function buildPaletteRows(mode, query) {
    var rows = [];
    if (mode === "files") {
      WS.visiblePaths().forEach(function (path) {
        var m = fuzzy(query, path);
        if (m) rows.push({ score: m.score, hits: m.hits, label: baseName(path), path: path, icon: "file", kind: "file", target: path });
      });
    } else {
      commands.forEach(function (c) {
        var m = fuzzy(query, c.label);
        if (m) rows.push({ score: m.score, hits: m.hits, label: c.label, hint: c.hint, icon: "chevron", kind: "cmd", target: c.id });
      });
    }
    rows.sort(function (a, b) { return b.score - a.score; });
    return rows.slice(0, 40);
  }

  function openPalette(mode, seed) {
    paletteState.mode = mode || "commands";
    $("#paletteOverlay").hidden = false;
    var input = $("#paletteInput");
    input.value = seed != null ? seed : (mode === "files" ? "" : ">");
    input.placeholder = mode === "files" ? "Search files by name…" : "Type a command…";
    renderPalette();
    setTimeout(function () { input.focus(); input.select(); }, 10);
  }
  function closePalette() { $("#paletteOverlay").hidden = true; }

  function renderPalette() {
    var input = $("#paletteInput");
    var raw = input.value;
    var mode = raw.charAt(0) === ">" ? "commands" : "files";
    var query = mode === "commands" ? raw.slice(1).trim() : raw.trim();
    if (mode !== paletteState.mode) { paletteState.mode = mode; input.placeholder = mode === "files" ? "Search files by name…" : "Type a command…"; }
    var rows = buildPaletteRows(mode, query);
    paletteState.rows = rows;
    paletteState.sel = Math.min(paletteState.sel, Math.max(0, rows.length - 1));
    $("#paletteList").innerHTML = rows.length ? rows.map(function (r, i) {
      var icon = r.kind === "file" ? Icons.file(r.target) : Icons.ui("chevron", 14);
      return '<div class="palette-row' + (i === paletteState.sel ? " palette-row--sel" : "") + '" data-i="' + i + '">' +
        '<span class="palette-row__icon">' + icon + "</span>" +
        '<span class="palette-row__label">' + markHits(r.label, r.hits) +
        (r.kind === "file" && r.path ? '<span class="palette-row__path">' + HL.esc(dirName(r.path) || ".") + "</span>" : "") + "</span>" +
        (r.hint ? '<kbd class="palette-row__hint">' + r.hint + "</kbd>" : "") + "</div>";
    }).join("") : '<div class="palette__empty">No matching ' + (mode === "files" ? "files" : "commands") + "</div>";
    $$(".palette-row", $("#paletteList")).forEach(function (row) {
      row.addEventListener("click", function () { paletteState.sel = Number(row.getAttribute("data-i")); acceptPalette(); });
      row.addEventListener("mousemove", function () {
        var i = Number(row.getAttribute("data-i"));
        if (i !== paletteState.sel) { paletteState.sel = i; $$(".palette-row", $("#paletteList")).forEach(function (r, j) { r.classList.toggle("palette-row--sel", j === i); }); }
      });
    });
  }
  function scrollPaletteSel() {
    var sel = $(".palette-row--sel");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }
  function acceptPalette() {
    var row = paletteState.rows[paletteState.sel];
    if (!row) return;
    closePalette();
    if (row.kind === "file") openFile(row.path, { focus: true });
    else runCommand(row.target);
  }

  /* ============================== SETTINGS ============================= */
  function setWrap(on) {
    settings.wrap = on;
    $("#codeWrap").classList.toggle("is-wrap", on);
    if (inputLayer) inputLayer.classList.toggle("is-wrap", on);
    $("#wrapToggle").classList.toggle("switch--on", on);
    $("#wrapToggle").setAttribute("aria-checked", String(on));
    persist();
  }
  function setMinimap(on) {
    settings.minimap = on;
    $("#minimapToggle").classList.toggle("switch--on", on);
    $("#minimapToggle").setAttribute("aria-checked", String(on));
    persist();
    renderMinimap();
  }
  function setFontSize(px) {
    settings.fontSize = px;
    document.documentElement.style.setProperty("--fs-code", px + "px");
    $("#fontSizeValue").textContent = px + "px";
    $("#fontSizeRange").value = String(px);
    persist();
    renderMinimap();
  }
  function openSettings() {
    $("#settingsOverlay").hidden = false;
    setTimeout(function () { $("#settingsClose").focus(); }, 10);
  }
  function closeSettings() { $("#settingsOverlay").hidden = true; }

  /* ============================== MENUS =============================== */
  var menuSpecs = {
    file: [
      { label: "New File", kbd: "", cmd: "file.new" },
      { label: "Go to File…", kbd: "Ctrl+K", cmd: "palette.files" },
      { type: "sep" },
      { label: "Save", kbd: "Ctrl+S", cmd: "file.save" },
      { label: "Save All", cmd: "file.saveAll" },
      { type: "sep" },
      { label: "Close Editor", cmd: "tab.close" }
    ],
    edit: [{ label: "Undo", kbd: "Ctrl+Z", disabled: true }, { label: "Redo", kbd: "Ctrl+Y", disabled: true }, { type: "sep" }, { label: "Find in Files…", cmd: "search.view" }],
    selection: [{ label: "Select All", disabled: true }, { label: "Shrink Selection", disabled: true }],
    view: [
      { label: "Toggle Sidebar", kbd: "Alt+B", cmd: "sidebar.toggle" },
      { label: "Toggle Panel", kbd: "Alt+J", cmd: "panel.toggle" },
      { label: "Toggle Agent Chat", kbd: "Alt+A", cmd: "chat.toggle" },
      { type: "sep" },
      { label: "Toggle Word Wrap", cmd: "wrap.toggle" },
      { label: "Toggle Minimap", cmd: "minimap.toggle" },
      { type: "sep" },
      { label: "Appearance: Toggle Theme", kbd: "Alt+T", cmd: "theme.toggle" },
      { label: "Editor: Show Welcome", cmd: "welcome" }
    ],
    go: [{ label: "Go to File…", kbd: "Ctrl+K", cmd: "palette.files" }, { label: "Go to Symbol…", cmd: "search.view" }],
    run: [{ label: "Run npm run dev", cmd: "term.dev" }, { label: "Run npm run build", cmd: "term.build" }, { type: "sep" }, { label: "Start Debugging", disabled: true }],
    terminal: [
      { label: "New Terminal", kbd: "Ctrl+`", cmd: "term.new" },
      { label: "Run: npm run dev", cmd: "term.dev" },
      { label: "Run: npm test", cmd: "term.test" },
      { type: "sep" },
      { label: "Toggle Panel", kbd: "Alt+J", cmd: "panel.toggle" }
    ],
    help: [
      { label: "Agent: Run Demo Task", cmd: "agent.run" },
      { label: "Open Settings", cmd: "settings" },
      { type: "sep" },
      { label: "About HugMoss Code", cmd: "about" }
    ]
  };

  var openMenu = null;
  function showMenu(name, anchor) {
    hideMenu();
    var spec = menuSpecs[name];
    if (!spec) return;
    var pop = document.createElement("div");
    pop.className = "menu-pop";
    pop.innerHTML = spec.map(function (it) {
      if (it.type === "sep") return '<div class="menu-pop__sep"></div>';
      return '<button class="menu-pop__item' + (it.disabled ? " menu-pop__item--disabled" : "") + '"' + (it.cmd ? ' data-cmd="' + it.cmd + '"' : "") + ">" +
        HL.esc(it.label) + (it.kbd ? "<kbd>" + HL.esc(it.kbd) + "</kbd>" : "") + "</button>";
    }).join("");
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + "px";
    pop.style.top = r.bottom + 2 + "px";
    anchor.classList.add("is-open");
    openMenu = { pop: pop, anchor: anchor };
    $$("[data-cmd]", pop).forEach(function (btn) {
      btn.addEventListener("click", function () {
        hideMenu();
        var cmd = btn.getAttribute("data-cmd");
        if (cmd === "about") { toast({ title: "HugMoss Code", msg: "Browser-based agentic IDE · no backend, no network", type: "agent" }); return; }
        if (cmd === "term.test") { setPanelOpen(true); setPanelTab("terminal"); Terminal.run("npm test"); return; }
        runCommand(cmd);
      });
    });
  }
  function hideMenu() {
    if (!openMenu) return;
    openMenu.pop.remove();
    openMenu.anchor.classList.remove("is-open");
    openMenu = null;
  }

  /* =========================== RESIZE HANDLES ========================== */
  function initResize(handleSel, getVal, setVal, axis, cssVar, min, max, storeKey) {
    var handle = $(handleSel);
    handle.addEventListener("mousedown", function (e) {
      if (isDrawer(axis === "x" ? "sidebar" : "agent")) return;
      e.preventDefault();
      handle.classList.add("is-drag");
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      var start = axis === "x" ? e.clientX : e.clientY;
      var startVal = getVal();
      function move(ev) {
        var d = (axis === "x" ? ev.clientX : ev.clientY) - start;
        var next = clamp(axis === "x" ? startVal + d : startVal - d, min, max);
        setVal(next);
        document.documentElement.style.setProperty(cssVar, next + "px");
        updateMinimapViewport();
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        handle.classList.remove("is-drag");
        document.body.style.cursor = "";
        storeKey && (settings[storeKey] = getVal(), persist());
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ============================ NOTIFICATIONS ========================== */
  function toggleNotif() {
    var pop = $("#notifPopover");
    if (!pop.hidden) { pop.hidden = true; return; }
    pop.innerHTML =
      '<div class="notif-head">Notifications <button class="sbtn" data-clear aria-label="Clear all">' + Icons.ui("trash", 13) + "</button></div>" +
      notifItem("sparkle", "Agent session completed", 'Add loading skeletons to the stats cards · 3 files changed · 12:44', "3 min ago") +
      notifItem("gitCommit", "Working tree has 3 changes", "StatsCard.tsx, useFarmData.ts, Skeleton.tsx are uncommitted", "12 min ago");
    pop.hidden = false;
    $$("[data-clear]", pop).forEach(function (b) {
      b.addEventListener("click", function () { pop.hidden = true; toast({ title: "Notifications cleared", type: "info" }); });
    });
  }
  function notifItem(icon, title, body, time) {
    return '<div class="notif"><div class="notif__title">' + Icons.ui(icon, 13) + HL.esc(title) + "</div>" +
      '<div class="notif__body">' + HL.esc(body) + '</div><div class="notif__time">' + HL.esc(time) + "</div></div>";
  }

  /* ============================== WIRING =============================== */
  function wire() {
    $("#titleSearchIcon").innerHTML = Icons.ui("search", 13);
    $("#toggleSidebarBtn").innerHTML = Icons.ui("panelLeft", 16);
    $("#togglePanelBtn").innerHTML = Icons.ui("panelBottom", 16);
    $("#toggleChatBtn").innerHTML = Icons.ui("panelRight", 16);
    $("#titleSearch").addEventListener("click", function () { openPalette("files", ""); });

    $$(".abtn[data-view]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-view");
        if (v === state.view && settings.sidebarOpen) setSidebarOpen(false);
        else activateView(v);
        syncDrawerChrome();
      });
    });
    $("#abtnAgent").addEventListener("click", function () { setAgentOpen(!settings.agentOpen); syncDrawerChrome(); });
    $("#abtnSettings").addEventListener("click", openSettings);
    $("#abtnAccount").addEventListener("click", function () {
      toast({ title: "Vincent Iraguha", msg: "Signed in · HugMoss Max plan", type: "agent" });
    });

    $$(".menubar__item").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var name = b.getAttribute("data-menu");
        if (openMenu && openMenu.anchor === b) hideMenu();
        else showMenu(name, b);
      });
      b.addEventListener("mouseenter", function () { if (openMenu && openMenu.anchor !== b) showMenu(b.getAttribute("data-menu"), b); });
    });
    document.addEventListener("click", hideMenu);

    $("#toggleSidebarBtn").addEventListener("click", function () { setSidebarOpen(!settings.sidebarOpen); syncDrawerChrome(); });
    $("#togglePanelBtn").addEventListener("click", function () { setPanelOpen(!settings.panelOpen); });
    $("#toggleChatBtn").addEventListener("click", function () { setAgentOpen(!settings.agentOpen); syncDrawerChrome(); });
    $("#themeToggle").addEventListener("click", toggleTheme);
    $$(".win-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.classList.contains("win-btn--close")) toast({ title: "Close", msg: "Window controls are decorative in this preview", type: "info" });
      });
    });

    /* explorer */
    $("#projectToggle").addEventListener("click", function () {
      var chev = $(".chev", this);
      var open = chev.classList.toggle("chev--open");
      $("#fileTree").style.display = open ? "" : "none";
    });
    toggleSection("#outlineToggle", "#outlineTree");
    toggleSection("#timelineToggle", "#timelineTree");
    $("#newFileBtn").addEventListener("click", newFile);
    $("#newFolderBtn").addEventListener("click", function () { toast({ title: "New folder", msg: "Folders are created when a file inside them is saved", type: "info" }); });
    $("#refreshBtn").addEventListener("click", function () { renderTree(); toast({ title: "Explorer refreshed", type: "info", timeout: 1800 }); });
    $("#collapseBtn").addEventListener("click", function () { state.expanded = { "": true }; renderTree(); });
    renderTimeline();

    /* search */
    var searchTimer = null;
    $("#searchInput").addEventListener("input", function (e) {
      clearTimeout(searchTimer);
      var v = e.target.value;
      searchTimer = setTimeout(function () { runSearch(v); }, 120);
    });
    [["#searchCase", 0], ["#searchWord", 0], ["#searchRegex", 0]].forEach(function (pair) {
      $(pair[0]).addEventListener("click", function () {
        $(pair[0]).classList.toggle("is-on");
        runSearch($("#searchInput").value);
      });
    });
    $("#debugLaunchLink").addEventListener("click", function () {
      toast({ title: "launch.json", msg: "Run configuration is not wired in this preview", type: "info" });
    });

    /* scm */
    $("#scmCommitInput").addEventListener("input", function (e) {
      $("#scmCommitBtn").disabled = !e.target.value.trim() || !state.scm.length;
    });
    $("#scmCommitInput").addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); commit(); }
    });
    $("#scmCommitBtn").addEventListener("click", commit);
    $("#scmSyncBtn").addEventListener("click", function () {
      toast({ title: "Synchronizing main…", msg: state.scm.length + " local change" + (state.scm.length === 1 ? "" : "s") + " · origin up to date", type: "info" });
      logOutput("git", "fetch origin main", "out-info");
    });

    /* welcome */
    $$(".wshort").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-action");
        if (a === "file") openPalette("files", "");
        else if (a === "search") { activateView("search"); }
        else if (a === "terminal") { setPanelOpen(true); setPanelTab("terminal"); Terminal.focus(); }
      });
    });
    $("#welcomeAgentCard").addEventListener("click", function () { setAgentOpen(true); syncDrawerChrome(); if (window.Agent) Agent.focusInput(); });

    /* panel */
    $$(".ptab").forEach(function (t) {
      t.addEventListener("click", function () {
        var name = t.getAttribute("data-panel");
        if (!settings.panelOpen) setPanelOpen(true);
        setPanelTab(name);
      });
    });
    $("#panelCollapseBtn").addEventListener("click", function () { setPanelOpen(false); });
    $("#panelSplitBtn").addEventListener("click", function () { toast({ title: "Split terminal", msg: "Secondary shells are not wired in this preview", type: "info" }); });
    $("#panelKillBtn").addEventListener("click", function () { Terminal.kill(); });

    /* status bar */
    $("#sbBranch").addEventListener("click", function () { activateView("scm"); toast({ title: "main", msg: "origin/main is up to date · " + state.scm.length + " local changes", type: "info" }); });
    $("#sbProblems").addEventListener("click", function () { setPanelOpen(true); setPanelTab("problems"); });
    $("#sbIndent").addEventListener("click", function () { toast({ title: "Indentation", msg: "Spaces: 2", type: "info" }); });
    $("#sbEncoding").addEventListener("click", function () { toast({ title: "Encoding", msg: "UTF-8 (reopen from disk)", type: "info" }); });
    $("#sbEol").addEventListener("click", function () { toast({ title: "Line ending", msg: "LF", type: "info" }); });
    $("#sbLang").addEventListener("click", function () { toast({ title: "Language mode", msg: LANG_LABEL[extKey(state.active || "") ] || "Plain Text", type: "info" }); });
    $("#sbPrettier").addEventListener("click", function () { runCommand("format"); });
    $("#sbBell").addEventListener("click", function (e) { e.stopPropagation(); toggleNotif(); });
    document.addEventListener("click", function (e) {
      var pop = $("#notifPopover");
      if (!pop.hidden && !pop.contains(e.target) && e.target.id !== "sbBell") pop.hidden = true;
    });

    /* palette */
    $("#paletteInput").addEventListener("input", function () { paletteState.sel = 0; renderPalette(); });
    $("#paletteInput").addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); paletteState.sel = Math.min(paletteState.sel + 1, paletteState.rows.length - 1); renderPalette(); scrollPaletteSel(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); paletteState.sel = Math.max(paletteState.sel - 1, 0); renderPalette(); scrollPaletteSel(); }
      else if (e.key === "Enter") { e.preventDefault(); acceptPalette(); }
      else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    });
    $("#paletteOverlay").addEventListener("click", function (e) { if (e.target === this) closePalette(); });

    /* settings */
    $$(".theme-card").forEach(function (c) {
      c.addEventListener("click", function () { settings.theme = c.getAttribute("data-theme-choice"); persist(); applyTheme(); });
    });
    $("#fontSizeRange").addEventListener("input", function (e) { setFontSize(Number(e.target.value)); });
    $("#wrapToggle").addEventListener("click", function () { setWrap(!settings.wrap); });
    $("#minimapToggle").addEventListener("click", function () { setMinimap(!settings.minimap); });
    $("#agentModeSelect").addEventListener("change", function (e) {
      settings.agentMode = e.target.value;
      persist();
      if (window.Agent) Agent.setMode(e.target.value);
    });
    $("#settingsClose").addEventListener("click", closeSettings);
    $("#settingsDone").addEventListener("click", closeSettings);
    $("#settingsOverlay").addEventListener("click", function (e) { if (e.target === this) closeSettings(); });

    $("#scrim").addEventListener("click", closeDrawers);
    $("#agentCloseBtn").addEventListener("click", function () { setAgentOpen(false); });

    /* scrolling + resize */
    window.addEventListener("resize", function () { syncDrawerChrome(); updateMinimapViewport(); if (activeTab() && activeTab().kind === "file") renderMinimap(); });
    initResize("#sidebarResize", function () { return settings.sbW; }, function (v) { settings.sbW = v; }, "x", "--sb-w", 200, 460, "sbW");
    initResize("#agentResize", function () { return settings.agW; }, function (v) { settings.agW = v; }, "x", "--ag-w", 320, 560, "agW");
    initResize("#panelResize", function () { return settings.panelH; }, function (v) { settings.panelH = v; }, "y", "--panel-h", 120, 420, "panelH");

    document.addEventListener("keydown", onGlobalKeys);
  }

  function onGlobalKeys(e) {
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key.toLowerCase();
    if (e.key === "Escape") {
      if (!$("#paletteOverlay").hidden) { closePalette(); return; }
      if (!$("#settingsOverlay").hidden) { closeSettings(); return; }
      if (!$("#notifPopover").hidden) { $("#notifPopover").hidden = true; return; }
      if (openMenu) { hideMenu(); return; }
      if ($("#app").classList.contains("has-drawer")) closeDrawers();
      return;
    }
    if (mod && e.shiftKey && key === "p") { e.preventDefault(); openPalette("commands", ">"); return; }
    if (mod && key === "k") { e.preventDefault(); openPalette("files", ""); return; }
    if (mod && key === "s") { e.preventDefault(); saveActive(); return; }
    if (mod && !e.shiftKey && e.key === "`") {
      e.preventDefault();
      if (!settings.panelOpen) setPanelOpen(true);
      setPanelTab("terminal");
      Terminal.focus();
      return;
    }
    if (e.altKey && !mod) {
      if (key === "b") { e.preventDefault(); setSidebarOpen(!settings.sidebarOpen); syncDrawerChrome(); return; }
      if (key === "a") { e.preventDefault(); setAgentOpen(!settings.agentOpen); syncDrawerChrome(); return; }
      if (key === "j") { e.preventDefault(); setPanelOpen(!settings.panelOpen); return; }
      if (key === "t") { e.preventDefault(); toggleTheme(); return; }
      if (key === "e") { e.preventDefault(); runCommand("file.saveAll"); return; }
      if (key === "p") { e.preventDefault(); openPalette("files", ""); return; }
    }
  }

  /* ================================ BOOT =============================== */
  function boot() {
    Icons.mount(document);
    document.documentElement.style.setProperty("--fs-code", settings.fontSize + "px");
    applyTheme();
    ensureInputLayer();
    $("#codeWrap").classList.toggle("is-wrap", settings.wrap);
    inputLayer.classList.toggle("is-wrap", settings.wrap);
    $("#minimapToggle").classList.toggle("switch--on", settings.minimap);
    $("#wrapToggle").classList.toggle("switch--on", settings.wrap);
    $("#fontSizeValue").textContent = settings.fontSize + "px";
    $("#fontSizeRange").value = String(settings.fontSize);
    $("#agentModeSelect").value = settings.agentMode;
    $("#scmTitle").textContent = WS.projectName;
    document.documentElement.style.setProperty("--sb-w", settings.sbW + "px");
    document.documentElement.style.setProperty("--ag-w", settings.agW + "px");
    document.documentElement.style.setProperty("--panel-h", settings.panelH + "px");
    $("#agentSessionName").textContent = "Session " + clock();

    seedPanelViews();
    renderScm();
    renderTree();
    wire();

    setSidebarOpen(settings.sidebarOpen);
    setAgentOpen(settings.agentOpen);
    setPanelOpen(settings.panelOpen);
    setPanelTab(settings.panelTab || "terminal");

    ["src/components/Dashboard.tsx", "src/components/StatsCard.tsx", "src/api/client.ts"].forEach(function (p) {
      state.tabs.push({ path: p, kind: "file", dirty: false });
    });
    state.tabs[1].dirty = true;
    state.active = "src/components/Dashboard.tsx";
    renderTabs();
    renderCode(state.active);
    inputLayer.value = WS.content(state.active);
    state.cursor = { line: 24, col: 8 };
    $("#sbCursor").textContent = "Ln 24, Col 8";
    $$(".cl", $("#codeLines")).forEach(function (row) {
      row.classList.toggle("cl--active", Number(row.getAttribute("data-ln")) === 24);
    });
    showLayer("code");
    initMinimapDrag();
    syncDrawerChrome();

    if (window.Terminal) Terminal.init();
    if (window.Agent) Agent.init();

    logOutput("hugmoss", "workspace restored · " + WS.visiblePaths().length + " files · 3 uncommitted changes", "out-info");
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { renderMinimap(); });
    }
    setTimeout(function () {
      toast({ title: "Agent ready", msg: "Ctrl+K → Agent: Run Demo Task, or send a message in the Agent panel", type: "agent", timeout: 6000 });
    }, 900);
  }

  window.App = {
    toast: toast,
    logOutput: logOutput,
    openFile: openFile,
    openDiff: openDiff,
    openPalette: openPalette,
    runCommand: runCommand,
    activateView: activateView,
    setPanelOpen: setPanelOpen,
    setPanelTab: setPanelTab,
    setAgentOpen: setAgentOpen,
    saveActive: saveActive,
    scmAdd: scmAdd,
    treeRefresh: function () { renderTree(); renderScm(); },
    filesChanged: function (path) {
      if (state.active === path && activeTab() && activeTab().kind === "file") { renderCode(path); inputLayer.value = WS.content(path); }
      renderTree();
      renderMinimap();
    },
    problemsAdd: function (p) { state.problems.push(p); renderProblems(); },
    problemsClear: function () { state.problems = []; renderProblems(); },
    settings: settings,
    state: state,
    baseName: baseName,
    dirName: dirName,
    clock: clock
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
