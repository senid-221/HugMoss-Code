/* app.js — IDE shell: real folder workspace, editor, tabs, diffs, search, providers, palette, settings. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* -------------------------- persistent settings ------------------------ */
  var STORE_KEY = "hugmoss.ide.settings.v2";
  var LEGACY_KEY = "hugmoss.ide.settings";
  var defaults = {
    theme: "light",
    fontSize: 13,
    wrap: false,
    minimap: true,
    agentMode: "agent",
    model: null,
    sbW: 264,
    agW: 700,
    panelH: 220,
    sidebarOpen: true,
    agentOpen: true,
    panelOpen: true,
    panelTab: "terminal"
  };
  var settings = (function () {
    var base = Object.assign({}, defaults);
    [LEGACY_KEY, STORE_KEY].forEach(function (key) {
      try {
        var raw = localStorage.getItem(key);
        if (raw) base = Object.assign(base, JSON.parse(raw));
      } catch (e) { /* unreadable settings fall back to defaults */ }
    });
    base.panelTab = base.panelTab === "problems" || base.panelTab === "output" ? base.panelTab : "terminal";
    if (base.agW === 520 || base.agW === 640) base.agW = defaults.agW;
    if (!base.shell) {
      base.shell = "qoder";
      base.theme = defaults.theme;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(base)); } catch (e) { /* storage unavailable */ }
    }
    return base;
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
    tabs: [],
    activeKey: null,
    active: null,
    expanded: {},
    cursor: { line: 1, col: 1 },
    problems: [],
    notifs: [],
    unread: 0,
    searchSel: -1
  };

  var LANG_LABEL = {
    ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React",
    json: "JSON", css: "CSS", scss: "SCSS", md: "Markdown", html: "HTML", svg: "SVG", env: "Dotenv",
    gitignore: "gitignore", txt: "Plain Text", py: "Python", go: "Go", rs: "Rust", java: "Java",
    c: "C", cpp: "C++", cs: "C#", php: "PHP", rb: "Ruby", swift: "Swift", sh: "Shell", yaml: "YAML",
    toml: "TOML", sql: "SQL"
  };

  /* ------------------------------- helpers ------------------------------ */
  function baseName(p) { return String(p || "").split("/").pop(); }
  function dirName(p) { var i = String(p || "").lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function extKey(p) { return WS.language(p); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function clock() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function langLabel(p) { return LANG_LABEL[extKey(p)] || "Plain Text"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function relTime(ts) {
    if (!ts) return "";
    var d = Math.max(0, Date.now() - ts) / 1000;
    if (d < 45) return "just now";
    if (d < 3600) return Math.round(d / 60) + "m ago";
    if (d < 86400) return Math.round(d / 3600) + "h ago";
    if (d < 604800) return Math.round(d / 86400) + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  function toast(opts) {
    var host = $("#toasts");
    var node = document.createElement("div");
    node.className = "toast toast--" + (opts.type || "info");
    var icon = { success: "check", error: "errorCircle", warn: "warning", agent: "sparkle", info: "infoCircle" }[opts.type || "info"];
    node.innerHTML =
      '<span class="toast__icon">' + Icons.ui(icon, 15) + "</span>" +
      '<div class="toast__body"><div class="toast__title"></div>' +
      (opts.msg ? '<div class="toast__msg"></div>' : "") + "</div>" +
      '<button class="toast__close" aria-label="Dismiss notification">' + Icons.ui("close", 13) + "</button>";
    $(".toast__title", node).textContent = opts.title || "";
    if (opts.msg) $(".toast__msg", node).textContent = opts.msg;
    host.appendChild(node);
    while (host.children.length > 4) host.firstElementChild.remove();
    var timer = setTimeout(close, opts.timeout || 4200);
    function close() {
      clearTimeout(timer);
      if (!node.parentNode) return;
      node.classList.add("is-out");
      setTimeout(function () { if (node.parentNode) node.remove(); }, 190);
    }
    $(".toast__close", node).addEventListener("click", close);
  }

  function notify(opts) {
    state.notifs.unshift({
      icon: opts.icon || "infoCircle",
      title: opts.title || "",
      body: opts.body || "",
      time: Date.now()
    });
    state.notifs = state.notifs.slice(0, 24);
    state.unread++;
    $("#sbBell").classList.add("sb-item--dot");
    if (!$("#notifPopover").hidden) renderNotifs();
  }

  function renderNotifs() {
    var pop = $("#notifPopover");
    pop.innerHTML = '<div class="notif-head">Notifications' +
      (state.notifs.length ? '<button class="sbtn" data-clear aria-label="Clear all">' + Icons.ui("trash", 13) + "</button>" : "") + "</div>" +
      (state.notifs.length ? state.notifs.map(function (n) {
        return '<div class="notif"><div class="notif__title">' + Icons.ui(n.icon, 13) + HL.esc(n.title) + "</div>" +
          (n.body ? '<div class="notif__body">' + HL.esc(n.body) + "</div>" : "") +
          '<div class="notif__time">' + relTime(n.time) + "</div></div>";
      }).join("") : '<div class="notif-empty">Workspace and agent events appear here.</div>');
    var clear = $("[data-clear]", pop);
    if (clear) clear.addEventListener("click", function () {
      state.notifs = [];
      state.unread = 0;
      $("#sbBell").classList.remove("sb-item--dot");
      renderNotifs();
    });
  }

  function toggleNotif() {
    var pop = $("#notifPopover");
    if (!pop.hidden) { pop.hidden = true; return; }
    renderNotifs();
    pop.hidden = false;
    state.unread = 0;
    $("#sbBell").classList.remove("sb-item--dot");
  }

  function logOutput(channel, text, cls) {
    var host = $("#pview-output");
    if (!host) return;
    var line = document.createElement("div");
    line.className = "out-line";
    line.innerHTML = '<span class="out-time">' + clock() + "</span>" +
      '<span class="' + (cls || "out-info") + '">' + HL.esc((channel ? channel + " · " : "") + text) + "</span>";
    host.appendChild(line);
    while (host.children.length > 400) host.firstElementChild.remove();
    host.scrollTop = host.scrollHeight;
  }

  /* ------------------------------- dialogs ------------------------------ */
  var dialogState = null;

  function openDialog(opts) {
    opts = opts || {};
    if (dialogState) settleDialog(null);
    return new Promise(function (resolve) {
      dialogState = { resolve: resolve, validate: opts.validate || null };
      $("#dialogTitle").textContent = opts.title || "Confirm";
      $("#dialogMessage").textContent = opts.message || "";
      $("#dialogMessage").hidden = !opts.message;
      var field = $("#dialogField");
      var input = $("#dialogInput");
      field.hidden = !opts.label;
      $("#dialogLabel").textContent = opts.label || "Value";
      input.value = opts.value == null ? "" : opts.value;
      input.placeholder = opts.placeholder || "";
      $("#dialogError").hidden = true;
      $("#dialogError").textContent = "";
      $("#dialogOk").textContent = opts.ok || "OK";
      $("#dialogOk").className = "btn " + (opts.danger ? "btn--danger" : "btn--accent");
      $("#dialogCancel").textContent = opts.cancel || "Cancel";
      $("#dialogOverlay").hidden = false;
      setTimeout(function () {
        if (opts.label) { input.focus(); input.select(); }
        else $("#dialogOk").focus();
      }, 20);
    });
  }

  function settleDialog(value) {
    if (!dialogState) return;
    var resolve = dialogState.resolve;
    dialogState = null;
    $("#dialogOverlay").hidden = true;
    resolve(value);
  }

  function acceptDialog() {
    if (!dialogState) return;
    var input = $("#dialogInput");
    if (!$("#dialogField").hidden && dialogState.validate) {
      var err = dialogState.validate(input.value);
      if (err) {
        $("#dialogError").textContent = err;
        $("#dialogError").hidden = false;
        input.focus();
        return;
      }
    }
    var value = $("#dialogField").hidden ? true : input.value.trim();
    settleDialog(value);
  }

  function confirmAction(opts) {
    return openDialog(Object.assign({ title: "Confirm", ok: "Continue" }, opts || {}));
  }

  /* =============================== THEME ================================ */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", settings.theme);
    var btn = $("#themeToggle");
    if (btn) {
      btn.innerHTML = Icons.ui(settings.theme === "dark" ? "sun" : "moon", 16);
      btn.setAttribute("data-tip", settings.theme === "dark" ? "Light Theme (Alt+T)" : "Dark Theme (Alt+T)");
    }
    $$(".theme-card").forEach(function (card) {
      var on = card.getAttribute("data-theme-choice") === settings.theme;
      card.classList.toggle("theme-card--active", on);
      card.setAttribute("aria-checked", String(on));
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
  var MAX_RENDER_LINES = 20000;
  var MAX_HIGHLIGHT_LINES = 5000;
  var inputLayer = null;
  var editTimer = null;
  var chromeTimer = null;

  function ensureInputLayer() {
    if (inputLayer) return inputLayer;
    inputLayer = document.createElement("textarea");
    inputLayer.className = "editor-input";
    inputLayer.setAttribute("aria-label", "Code editor");
    inputLayer.spellcheck = false;
    inputLayer.setAttribute("autocapitalize", "off");
    inputLayer.setAttribute("autocomplete", "off");
    inputLayer.setAttribute("wrap", "off");
    $("#codeWrap").appendChild(inputLayer);

    inputLayer.addEventListener("input", onEditInput);
    inputLayer.addEventListener("keydown", onEditKeys);
    ["click", "keyup", "mouseup", "select", "input"].forEach(function (ev) {
      inputLayer.addEventListener(ev, updateCursorReadout);
    });
    inputLayer.addEventListener("scroll", syncInputScroll);
    return inputLayer;
  }

  function setEditorText(text) {
    if (!inputLayer) return;
    inputLayer.value = text;
    inputLayer.scrollTop = 0;
    inputLayer.scrollLeft = 0;
    inputLayer.classList.toggle("is-wrap", settings.wrap);
  }

  function onEditInput() {
    var tab = activeTab();
    if (!tab || tab.kind !== "file") return;
    WS.setContent(tab.path, inputLayer.value);
    updateTabDirty();
    clearTimeout(editTimer);
    editTimer = setTimeout(function () {
      if (!activeTab() || activeTab().key !== tab.key) return;
      var pos = inputLayer.selectionStart;
      renderCode(tab.path);
      try { inputLayer.selectionStart = inputLayer.selectionEnd = pos; } catch (e) { /* node replaced */ }
    }, 70);
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(function () {
      renderScm();
      renderTree();
      updateWorkspaceChrome();
    }, 280);
  }

  function onEditKeys(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      var start = inputLayer.selectionStart, end = inputLayer.selectionEnd;
      inputLayer.value = inputLayer.value.slice(0, start) + "  " + inputLayer.value.slice(end);
      inputLayer.selectionStart = inputLayer.selectionEnd = start + 2;
      onEditInput();
    }
  }

  function syncInputScroll() {
    var scroll = $("#codeScroll");
    scroll.scrollTop = inputLayer.scrollTop;
    scroll.scrollLeft = inputLayer.scrollLeft;
    updateMinimapViewport();
  }

  function updateCursorReadout() {
    if (!inputLayer || !activeTab() || activeTab().kind !== "file") return;
    var before = inputLayer.value.slice(0, inputLayer.selectionStart).split("\n");
    state.cursor = { line: before.length, col: before[before.length - 1].length + 1 };
    $("#sbCursor").textContent = "Ln " + state.cursor.line + ", Col " + state.cursor.col;
    var activeRow = $(".cl--active", $("#codeLines"));
    if (activeRow) activeRow.classList.remove("cl--active");
    var row = $('.cl[data-ln="' + state.cursor.line + '"]', $("#codeLines"));
    if (row) row.classList.add("cl--active");
    renderBreadcrumbSymbol();
  }

  function renderCode(path) {
    if (!inputLayer) ensureInputLayer();
    var content = WS.content(path) || "";
    var lang = extKey(path);
    var lines = content.split("\n");
    var scroller = $("#codeScroll");
    var top = scroller.scrollTop;
    var left = scroller.scrollLeft;
    var shown = Math.min(lines.length, MAX_RENDER_LINES);
    var html = shown <= MAX_HIGHLIGHT_LINES ? HL.render(lines.slice(0, shown).join("\n"), lang) : null;
    if (!content) {
      $("#codeLines").innerHTML = '<div class="code-empty">Empty file · start typing, or ask the agent to fill it.</div>';
      if (inputLayer && inputLayer.value !== content) inputLayer.value = content;
      $("#sbLang").textContent = langLabel(path);
      renderBreadcrumbs(path);
      renderOutline(path);
      return;
    }
    var rows = [];
    for (var i = 0; i < shown; i++) {
      var text = html ? (html[i] || "&nbsp;") : HL.esc(lines[i]) || "&nbsp;";
      rows.push(
        '<div class="cl' + (i + 1 === state.cursor.line ? " cl--active" : "") + '" data-ln="' + (i + 1) + '">' +
        '<span class="cl__no">' + (i + 1) + "</span>" +
        '<span class="cl__txt">' + text + "</span></div>"
      );
    }
    $("#codeLines").innerHTML = rows.join("") +
      (lines.length > shown
        ? '<div class="code-cut">Showing first ' + shown.toLocaleString() + " of " + lines.length.toLocaleString() + " lines. The editor stays editable; open large files in your desktop editor for full rendering.</div>"
        : "");
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
    if (inputLayer && inputLayer.value !== content) inputLayer.value = content;
    $("#sbLang").textContent = langLabel(path);
    renderMinimap();
    renderBreadcrumbs(path);
    renderOutline(path);
  }

  function renderDiff(path) {
    var rec = WS.record(path);
    var oldText = WS.head(path) || "";
    var newText = WS.content(path) || "";
    var lines = HL.diffLines(oldText, newText);
    var adds = 0, dels = 0, shown = 0;
    lines.forEach(function (row) {
      if (row.type === "add") adds++;
      if (row.type === "del") dels++;
    });
    $("#diffHead").innerHTML =
      '<div class="diff-head__text"><span class="diff-label">' + HL.esc(baseName(path)) + "</span>" +
      (rec && rec.deleted ? '<span class="diff-tag">deleted on disk</span>' : "") +
      '<span class="diff-stat diff-stat--add">+' + adds + "</span>" +
      '<span class="diff-stat diff-stat--del">−' + dels + "</span>" +
      '<span class="diff-hint">Opened ⟶ now</span></div>' +
      '<div class="diff-actions">' +
      (!rec || rec.deleted ? "" : '<button class="btn btn--ghost btn--sm" data-diff-act="open">Open file</button>') +
      '<button class="btn btn--ghost btn--sm" data-diff-act="download">Download</button>' +
      (WS.loaded && !WS.readonly && !(rec && rec.deleted) ? '<button class="btn btn--ghost btn--sm" data-diff-act="revert">Revert</button>' : "") +
      "</div>";
    var body = [];
    for (var i = 0; i < lines.length; i++) {
      var row = lines[i];
      if (shown >= 4000) {
        body.push('<div class="diff-cut">Diff truncated at 4,000 rows — ' + (lines.length - shown) + " more lines.</div>");
        break;
      }
      var cls = row.type === "add" ? "drow--add" : row.type === "del" ? "drow--del" : "";
      body.push(
        '<div class="drow ' + cls + '">' +
        '<span class="drow__g">' + (row.type === "add" ? "+" : row.type === "del" ? "−" : "") + "</span>" +
        '<span class="drow__no">' + (row.a || "") + "</span>" +
        '<span class="drow__no drow__no--b">' + (row.b || "") + "</span>" +
        '<span class="drow__txt">' + (HL.renderLine(row.text, extKey(path)) || "&nbsp;") + "</span></div>"
      );
      shown++;
    }
    $("#diffBody").innerHTML = '<div class="diff-lines">' + body.join("") + "</div>";
    $$("[data-diff-act]", $("#diffHead")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-diff-act");
        if (act === "open") openFile(path, { focus: true });
        else if (act === "download") downloadPath(path);
        else if (act === "revert") revertPath(path);
      });
    });
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
    if (!canvas || !activeTab() || activeTab().kind !== "file") return;
    var lines = HL.tokenizeLines(WS.content(path) || "", extKey(path));
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
      var y = i * 2.2;
      if (y > h) break;
      var x = 4;
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
    if (!wrap || !scroll || !vp || !settings.minimap || wrap.clientHeight === 0) return;
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
      scroll.scrollTop = clamp(frac, 0, 1) * (scroll.scrollHeight - scroll.clientHeight);
      if (inputLayer) inputLayer.scrollTop = scroll.scrollTop;
      updateMinimapViewport();
    });
    document.addEventListener("mouseup", function () { dragging = false; vp.classList.remove("is-drag"); });
    $("#codeScroll").addEventListener("scroll", function () {
      if (inputLayer) {
        inputLayer.scrollTop = $("#codeScroll").scrollTop;
        inputLayer.scrollLeft = $("#codeScroll").scrollLeft;
      }
      updateMinimapViewport();
    });
  }

  /* ----------------------------- breadcrumbs --------------------------- */
  function renderBreadcrumbs(path) {
    if (!path) { $("#breadcrumbs").innerHTML = ""; return; }
    var parts = String(path).split("/");
    var html = "";
    parts.forEach(function (part, i) {
      var last = i === parts.length - 1;
      if (i > 0) html += '<span class="crumb__sep">' + Icons.ui("chevron", 12) + "</span>";
      html += '<button class="crumb' + (last ? " crumb--last" : "") + '">' +
        (last ? '<span class="crumb__icon">' + Icons.file(path) + "</span>" : "") + HL.esc(part) + "</button>";
    });
    html += '<span class="crumb__sep crumb__sym-sep" hidden>' + Icons.ui("chevron", 12) + "</span>" +
      '<button class="crumb crumb--sym" hidden></button>';
    $("#breadcrumbs").innerHTML = html;
    renderBreadcrumbSymbol();
  }

  function renderBreadcrumbSymbol() {
    var tab = activeTab();
    var btn = $(".crumb--sym", $("#breadcrumbs"));
    if (!tab || tab.kind !== "file" || !btn) return;
    var sym = symbolFor(tab.path, state.cursor.line);
    var sep = $(".crumb__sym-sep", $("#breadcrumbs"));
    btn.hidden = !sym;
    if (sep) sep.hidden = !sym;
    if (sym) btn.textContent = sym;
  }

  var symbolCache = { path: "", size: -1, list: [] };
  function symbolsFor(path) {
    var content = WS.content(path) || "";
    if (symbolCache.path === path && symbolCache.size === content.length) return symbolCache.list;
    symbolCache = { path: path, size: content.length, list: collectSymbols(path) };
    return symbolCache.list;
  }

  function symbolFor(path, line) {
    var symbols = symbolsFor(path);
    var found = null;
    for (var i = 0; i < symbols.length; i++) {
      if (symbols[i].line <= (line || Number.MAX_SAFE_INTEGER)) found = symbols[i];
    }
    return found ? found.name : "";
  }

  /* ------------------------------- outline ----------------------------- */
  var SYMBOL_PATTERNS = [
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
    { re: /^\s*(?:export\s+)?(?:type|enum)\s+([A-Za-z_$][\w$]*)/, kind: "type" },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, kind: "const" },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/, kind: "const" },
    { re: /^\s*def\s+([A-Za-z_]\w*)/, kind: "function" },
    { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
    { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: "function" },
    { re: /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, kind: "type" },
    { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: "function" },
    { re: /^\s*(?:pub\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_]\w*)/, kind: "type" },
    { re: /^\s*(?:public|private|protected|internal|static|final|abstract|override|\s)*[\w<>\[\], ?]+\s+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*\{/, kind: "method" },
    { re: /^\s*(?:public|private|protected|internal)?\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
    { re: /^\s*(?:async\s+)?(?:function\s+)?([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\(/, kind: "function" }
  ];

  function collectSymbols(path) {
    var lang = extKey(path);
    var content = WS.content(path) || "";
    if (!content || content.length > 800000) return [];
    var lines = content.split("\n");
    var out = [];
    var limit = lang === "md" ? 120 : 400;
    for (var i = 0; i < lines.length && out.length < limit; i++) {
      var ln = lines[i];
      if (!ln.trim() || ln.length > 240) continue;
      if (lang === "md") {
        var h = ln.match(/^(#{1,4})\s+(.+?)\s*$/);
        if (h) out.push({ name: h[2].replace(/[#*`]/g, "").slice(0, 60), line: i + 1, kind: "heading" });
        continue;
      }
      for (var p = 0; p < SYMBOL_PATTERNS.length; p++) {
        var m = ln.match(SYMBOL_PATTERNS[p].re);
        if (m) {
          out.push({ name: m[1], line: i + 1, kind: SYMBOL_PATTERNS[p].kind });
          break;
        }
      }
    }
    return out;
  }

  function renderOutline(path) {
    var host = $("#outlineTree");
    if (!path) { host.innerHTML = '<div class="trow trow--muted" style="cursor:default">No file open</div>'; return; }
    var syms = symbolsFor(path);
    if (!syms.length) {
      host.innerHTML = '<div class="trow trow--muted" style="cursor:default">No symbols in this file</div>';
      return;
    }
    host.innerHTML = syms.slice(0, 60).map(function (s) {
      return '<div class="trow" data-jump="' + s.line + '" style="padding-left:26px" title="' + HL.esc(s.kind + " · line " + s.line) + '">' +
        '<span class="trow__icon">' + Icons.ui("dot", 12) + "</span>" +
        '<span class="trow__name">' + HL.esc(s.name) + "</span>" +
        '<span class="trow__badge">' + s.line + "</span></div>";
    }).join("");
    $$("[data-jump]", host).forEach(function (row) {
      row.addEventListener("click", function () { jumpToLine(Number(row.getAttribute("data-jump"))); });
    });
  }

  function jumpToLine(line) {
    var tab = activeTab();
    if (!tab || tab.kind !== "file") return;
    var content = WS.content(tab.path) || "";
    var rows = content.split("\n");
    line = clamp(line, 1, Math.max(1, rows.length));
    var pos = 0;
    for (var i = 0; i < line - 1; i++) pos += rows[i].length + 1;
    inputLayer.focus();
    inputLayer.selectionStart = pos;
    inputLayer.selectionEnd = pos + (rows[line - 1] || "").length;
    var row = $('.cl[data-ln="' + line + '"]');
    if (row) {
      $("#codeScroll").scrollTop = Math.max(0, row.offsetTop - 70);
      inputLayer.scrollTop = $("#codeScroll").scrollTop;
    }
    state.cursor = { line: line, col: 1 };
    updateCursorReadout();
  }

  function renderTimeline() {
    var host = $("#timelineTree");
    if (!WS.loaded) {
      host.innerHTML = '<div class="trow trow--muted" style="cursor:default">No folder open</div>';
      return;
    }
    var items = WS.visiblePaths().map(function (p) {
      var rec = WS.record(p);
      return { path: p, mtime: rec && rec.mtime || 0 };
    }).filter(function (i) { return i.mtime; });
    items.sort(function (a, b) { return b.mtime - a.mtime; });
    if (!items.length) {
      host.innerHTML = '<div class="trow trow--muted" style="cursor:default">No modified files</div>';
      return;
    }
    host.innerHTML = items.slice(0, 12).map(function (it) {
      return '<div class="trow" data-time="' + HL.esc(it.path) + '" style="padding-left:26px" title="' + HL.esc(it.path) + '">' +
        '<span class="trow__icon">' + Icons.ui("history", 13) + "</span>" +
        '<span class="trow__name">' + HL.esc(baseName(it.path)) + "</span>" +
        '<span class="trow__badge">' + relTime(it.mtime) + "</span></div>";
    }).join("");
    $$("[data-time]", host).forEach(function (row) {
      row.addEventListener("click", function () { openFile(row.getAttribute("data-time")); });
    });
  }

  /* =============================== TABS ================================= */
  function tabKey(path, kind) { return (kind === "diff" ? "diff:" : "file:") + path; }
  function activeTab() {
    for (var i = 0; i < state.tabs.length; i++) if (state.tabs[i].key === state.activeKey) return state.tabs[i];
    return null;
  }
  function findTab(path, kind) {
    var key = tabKey(path, kind || "file");
    for (var i = 0; i < state.tabs.length; i++) if (state.tabs[i].key === key) return state.tabs[i];
    return null;
  }
  function tabByKey(key) {
    for (var i = 0; i < state.tabs.length; i++) if (state.tabs[i].key === key) return state.tabs[i];
    return null;
  }
  function tabDirty(tab) { return tab.kind === "file" && WS.isDirty(tab.path); }

  function openFile(path, opts) {
    opts = opts || {};
    if (!WS.loaded) { toast({ title: "No folder open", msg: "Open a folder first.", type: "info" }); return; }
    var rec = WS.record(path);
    if (!rec) { toast({ title: "File not found", msg: path, type: "error" }); return; }
    var kind = opts.kind === "diff" ? "diff" : "file";
    var tab = findTab(path, kind);
    if (!tab) {
      tab = { key: tabKey(path, kind), path: path, kind: kind };
      state.tabs.push(tab);
    }
    if (window.Shell && Shell.showEditor) Shell.showEditor(path);
    activateTab(tab, opts);
    expandAncestors(path);
    closeDrawers();
  }

  function activateTab(tab, opts) {
    opts = opts || {};
    state.activeKey = tab.key;
    state.active = tab.path;
    state.cursor = { line: opts.line || 1, col: 1 };
    if (tab.kind === "diff") {
      renderDiff(tab.path);
      showLayer("diff");
      $("#sbLang").textContent = langLabel(tab.path) + " Diff";
    } else {
      setEditorText(WS.content(tab.path));
      renderCode(tab.path);
      showLayer("code");
      if (opts.line) jumpToLine(opts.line);
      if (opts.focus) inputLayer.focus();
    }
    renderTabs();
    renderTree();
    renderMinimap();
    updateTabDirty();
    if (opts.focus) closeDrawers();
  }

  function openDiff(path) { openFile(path, { kind: "diff" }); }

  function updateTabDirty() {
    $$(".tab", $("#tabstrip")).forEach(function (node) {
      var tab = tabByKey(node.getAttribute("data-key"));
      node.classList.toggle("tab--dirty", !!tab && tabDirty(tab));
    });
  }

  function renderTabs() {
    var host = $("#tabstrip");
    if (!state.tabs.length) { host.innerHTML = ""; return; }
    var list = state.tabs.map(function (tab) {
      var isDiff = tab.kind === "diff";
      var active = tab.key === state.activeKey;
      return '<div class="tab' + (active ? " tab--active" : "") + (tabDirty(tab) ? " tab--dirty" : "") +
        '" role="tab" aria-selected="' + active + '" data-key="' + HL.esc(tab.key) + '" title="' + HL.esc(tab.path) + '">' +
        '<span class="tab__icon' + (isDiff ? " tab__icon--diff" : "") + '">' + Icons.file(tab.path) + "</span>" +
        '<span class="tab__name">' + HL.esc(baseName(tab.path)) + (isDiff ? " · changes" : "") + "</span>" +
        '<span class="tab__dot"></span>' +
        '<span class="tab__close" role="button" aria-label="Close ' + HL.esc(baseName(tab.path)) + '">' + Icons.ui("close", 13) + "</span>" +
        "</div>";
    }).join("");
    host.innerHTML = '<div class="tabstrip__scroll">' + list + "</div>" +
      '<div class="tabstrip__actions">' +
      '<button class="sbtn" data-act="closeAll" aria-label="Close all editors" data-tip="Close All">' + Icons.ui("close", 15) + "</button>" +
      "</div>";
    $$(".tab", host).forEach(function (node) {
      var key = node.getAttribute("data-key");
      node.addEventListener("click", function (e) {
        if (e.target.closest(".tab__close")) { closeTab(key); return; }
        var tab = tabByKey(key);
        if (tab) activateTab(tab);
      });
      node.addEventListener("auxclick", function (e) {
        if (e.button === 1) { e.preventDefault(); closeTab(key); }
      });
    });
    var closeAll = $('[data-act="closeAll"]', host);
    if (closeAll) closeAll.addEventListener("click", closeAllTabs);
  }

  async function closeTab(key) {
    var tab = tabByKey(key);
    if (!tab) return;
    var idx = state.tabs.indexOf(tab);
    if (tabDirty(tab)) {
      var ok = await confirmAction({
        title: "Close without saving?",
        message: baseName(tab.path) + " has edits that are not written to disk. The session copy stays available in Changes.",
        ok: "Close editor",
        cancel: "Keep editing",
        danger: true
      });
      if (!ok) return;
    }
    state.tabs.splice(idx, 1);
    if (state.activeKey === key) {
      var next = state.tabs[Math.min(idx, state.tabs.length - 1)] || null;
      if (next) activateTab(next);
      else showWelcomeLayer();
    }
    renderTabs();
    renderTree();
    renderMinimap();
  }

  function closeTabsFor(path, kind) {
    var before = state.tabs.length;
    state.tabs = state.tabs.filter(function (t) { return t.path !== path || (kind && t.kind !== kind); });
    if (state.tabs.length !== before) {
      if (!activeTab()) {
        if (state.tabs.length) activateTab(state.tabs[state.tabs.length - 1]);
        else showWelcomeLayer();
      }
      renderTabs();
    }
  }

  async function closeAllTabs() {
    if (!state.tabs.length) return;
    var dirty = state.tabs.filter(tabDirty).length;
    if (dirty) {
      var ok = await confirmAction({
        title: "Close all editors?",
        message: plural(dirty, "file has", "files have") + " unsaved edits. Session copies remain in Changes.",
        ok: "Close all",
        danger: true
      });
      if (!ok) return;
    }
    state.tabs = [];
    showWelcomeLayer();
  }

  function showWelcomeLayer() {
    state.activeKey = null;
    state.active = null;
    state.cursor = { line: 1, col: 1 };
    renderTabs();
    renderTree();
    renderWelcome();
    showLayer("welcome");
    $("#breadcrumbs").innerHTML = "";
    renderOutline(null);
    $("#sbCursor").textContent = "Ln 1, Col 1";
    $("#sbLang").textContent = "Plain Text";
    renderMinimap();
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

  /* ============================== EXPLORER ============================== */
  function expandAncestors(path) {
    var parts = String(path).split("/");
    for (var i = 1; i < parts.length; i++) state.expanded[parts.slice(0, i).join("/")] = true;
  }

  function treeEmptyHtml() {
    if (!WS.loaded) {
      return '<div class="tree-empty">' + Icons.ui("folderOpen", 22) +
        "<strong>No folder open</strong>" +
        "<p>Open a folder or drop one here. Files never leave your machine.</p>" +
        '<button class="btn btn--accent btn--sm" data-empty-open>Open Folder</button>' +
        '<button class="linkbtn" data-empty-files>Open files read-only</button></div>';
    }
    return '<div class="tree-empty">' + Icons.ui("folder", 22) +
      "<strong>No readable files</strong>" +
      "<p>Binary files, files over 768 KB and ignored folders are skipped.</p>" +
      '<button class="btn btn--ghost btn--sm" data-empty-open>Choose another folder</button></div>';
  }

  function bindTreeEmpty() {
    var open = $("[data-empty-open]", $("#fileTree"));
    var files = $("[data-empty-files]", $("#fileTree"));
    if (open) open.addEventListener("click", openFolderFlow);
    if (files) files.addEventListener("click", openFilesFlow);
  }

  function renderTree() {
    var host = $("#fileTree");
    if (!WS.loaded || !WS.visiblePaths().length) {
      host.innerHTML = treeEmptyHtml();
      bindTreeEmpty();
      return;
    }
    var root = WS.buildTree();
    var changeMap = {};
    WS.changes().forEach(function (c) { changeMap[c.path] = c.kind; });
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
        var kind = changeMap[f.path];
        var rec = WS.record(f.path);
        var isSecret = rec && rec.secret;
        rows.push('<div class="trow' + (f.path === state.active ? " trow--active" : "") + '" data-file="' + HL.esc(f.path) + '" style="padding-left:' + (6 + depth * 12 + 14) + 'px" title="' + HL.esc(f.path) + '">' +
          '<span class="trow__icon">' + Icons.file(f.path) + "</span>" +
          '<span class="trow__name">' + HL.esc(f.name) + "</span>" +
          (kind ? '<span class="trow__badge trow__badge--' + (kind === "D" ? "del" : kind === "U" ? "new" : "mod") + '">' + kind + "</span>" : "") +
          (isSecret ? '<span class="trow__lock" title="Agent access blocked">' + Icons.ui("lock", 11) + "</span>" : "") +
          "</div>");
      });
    })(root, 0);
    host.innerHTML = rows.join("");
    $$("[data-dir]", host).forEach(function (node) {
      node.addEventListener("click", function () {
        var p = node.getAttribute("data-dir");
        state.expanded[p] = !state.expanded[p];
        renderTree();
      });
      node.addEventListener("contextmenu", function (e) { e.preventDefault(); dirMenu(e, node.getAttribute("data-dir")); });
    });
    $$("[data-file]", host).forEach(function (node) {
      var path = node.getAttribute("data-file");
      node.addEventListener("click", function () { openFile(path); });
      node.addEventListener("contextmenu", function (e) { e.preventDefault(); fileMenu(e, path); });
    });
  }

  function toggleSection(btnId, targetSel) {
    var btn = $(btnId);
    if (!btn) return;
    btn.addEventListener("click", function () {
      var chev = $(".chev", btn);
      if (!chev) return;
      var open = chev.classList.toggle("chev--open");
      $(targetSel).style.display = open ? "" : "none";
    });
  }

  /* =============================== WELCOME ============================= */
  function renderWelcome() {
    var title = $("#welcomeTitle");
    var sub = $("#welcomeSub");
    var cta = $("#welcomeCta");
    if (!title) return;
    if (!WS.loaded) {
      title.textContent = "Code with a real folder.";
      sub.textContent = "HugMoss reads and writes files on your disk with your browser. Nothing is uploaded, and the agent calls the provider you select.";
      cta.innerHTML =
        '<button class="btn btn--accent" data-welcome="open">Open Folder</button>' +
        '<button class="btn btn--ghost" data-welcome="files">Open Files</button>' +
        (WS.pendingHandle ? '<button class="btn btn--ghost" data-welcome="reopen">Reopen ' + HL.esc(WS.pendingHandle.name) + "</button>" : "");
    } else {
      title.textContent = WS.projectName;
      var bits = [plural(WS.visiblePaths().length, "file"), WS.readonly ? "read-only" : "read and write"];
      if (WS.skipped) bits.push(WS.skipped + " skipped");
      if (WS.truncated) bits.push("file cap reached");
      sub.textContent = bits.join(" · ") + " — session edits are separate from what is on disk.";
      cta.innerHTML =
        '<button class="btn btn--accent" data-welcome="file">Open a file</button>' +
        '<button class="btn btn--ghost" data-welcome="new">New file</button>' +
        '<button class="btn btn--ghost" data-welcome="folder">Open another folder</button>';
    }
    $$("[data-welcome]", cta).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-welcome");
        if (act === "open" || act === "folder") openFolderFlow();
        else if (act === "files") openFilesFlow();
        else if (act === "reopen") reopenFlow();
        else if (act === "file") openPalette("files", "");
        else if (act === "new") newFile();
      });
    });
  }

  /* =============================== SEARCH =============================== */
  function buildMatcher(query, opts) {
    var flags = "g" + (opts.caseSensitive ? "" : "i");
    var source;
    if (opts.regex) source = query;
    else {
      source = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (opts.wholeWord) source = "\\b" + source + "\\b";
    }
    try { return { re: new RegExp(source, flags) }; }
    catch (e) { return { error: e.message }; }
  }

  function markMatches(text, re) {
    var out = "";
    var last = 0;
    var guard = 0;
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(text)) && guard < 200) {
      guard++;
      if (!m[0]) { re.lastIndex++; continue; }
      out += HL.esc(text.slice(last, m.index)) + '<mark class="tok-mark">' + HL.esc(m[0]) + "</mark>";
      last = m.index + m[0].length;
    }
    return out + HL.esc(text.slice(last));
  }

  function runSearch(rawQuery) {
    var host = $("#searchResults");
    var footer = $("#searchFooter");
    var query = rawQuery.trim();
    if (!query) {
      host.innerHTML = WS.loaded
        ? '<div class="prob-empty">Search every readable file in ' + HL.esc(WS.projectName) + ".</div>"
        : '<div class="prob-empty">Open a folder to search its files.</div>';
      footer.textContent = "";
      return;
    }
    if (!WS.loaded) {
      host.innerHTML = '<div class="prob-empty">Open a folder to search its files.</div>';
      footer.textContent = "";
      return;
    }
    var matcher = buildMatcher(query, {
      caseSensitive: $("#searchCase").classList.contains("is-on"),
      wholeWord: $("#searchWord").classList.contains("is-on"),
      regex: $("#searchRegex").classList.contains("is-on")
    });
    if (matcher.error) {
      host.innerHTML = '<div class="prob-empty" style="color:var(--danger)">Invalid regular expression: ' + HL.esc(matcher.error) + "</div>";
      footer.textContent = "";
      return;
    }
    var totalHits = 0, fileCount = 0, truncated = false, html = [];
    var paths = WS.visiblePaths();
    for (var i = 0; i < paths.length; i++) {
      if (totalHits >= 500) { truncated = true; break; }
      var path = paths[i];
      var rec = WS.record(path);
      if (!rec || rec.secret) continue;
      var lines = rec.content.split("\n");
      var hits = [];
      for (var j = 0; j < lines.length && hits.length < 40; j++) {
        matcher.re.lastIndex = 0;
        if (matcher.re.test(lines[j])) hits.push({ line: j + 1, text: lines[j] });
      }
      if (!hits.length) continue;
      fileCount++;
      totalHits += hits.length;
      html.push('<div class="sres-file"><div class="sres-file__head" data-open="' + HL.esc(path) + '">' +
        "<span>" + Icons.file(path) + "</span>" + HL.esc(baseName(path)) +
        '<span class="sres-file__path">' + HL.esc(dirName(path) || ".") + " · " + hits.length + "</span></div>" +
        hits.map(function (h) {
          return '<div class="sres-match" data-open="' + HL.esc(path) + '" data-line="' + h.line + '">' +
            '<span class="sres-match__ln">' + h.line + "</span>" +
            '<span class="sres-match__code">' + (markMatches(h.text.trim().slice(0, 220), matcher.re) || "&nbsp;") + "</span></div>";
        }).join("") + "</div>");
    }
    host.innerHTML = html.join("") || '<div class="prob-empty">No results for “' + HL.esc(query) + "”.</div>";
    footer.textContent = totalHits
      ? totalHits + (truncated ? "+" : "") + " result" + (totalHits === 1 ? "" : "s") + " in " +
        fileCount + (fileCount === 1 ? " file" : " files") + (truncated ? " · refine the query" : "")
      : "0 results";
    $$("[data-open]", host).forEach(function (node) {
      node.addEventListener("click", function () {
        openFile(node.getAttribute("data-open"), { line: Number(node.getAttribute("data-line") || 1), focus: true });
        $$(".sres-match", host).forEach(function (r) { r.classList.remove("is-sel"); });
        node.classList.add("is-sel");
      });
    });
  }

  /* =========================== SOURCE CONTROL =========================== */
  function renderScm() {
    var list = WS.loaded ? WS.changes() : [];
    var host = $("#scmList");
    host.innerHTML = list.length ? list.map(function (c) {
      var badge = c.kind === "U" ? "u" : c.kind === "D" ? "d" : "m";
      return '<div class="scm__item" data-diff="' + HL.esc(c.path) + '" title="' + HL.esc(c.path) + '">' +
        '<span class="scm__badge scm__badge--' + badge + '">' + c.kind + "</span>" +
        "<span>" + Icons.file(c.path) + "</span>" +
        '<span class="scm__file">' + HL.esc(baseName(c.path)) + "</span>" +
        '<span class="scm__dir">' + HL.esc(dirName(c.path) || ".") + "</span>" +
        (WS.readonly ? "" : '<button class="scm__revert" data-revert="' + HL.esc(c.path) + '" title="Revert this file" aria-label="Revert">' + Icons.ui("history", 12) + "</button>") +
        "</div>";
    }).join("") : '<div class="scm__empty">' +
      (WS.loaded ? "No session changes. Editing or letting the agent write a file will list it here." : "Open a folder to track session edits.") +
      "</div>";
    $("#scmCount").textContent = String(list.length);
    var badge = $("#scmBadge");
    badge.textContent = String(list.length);
    badge.hidden = !list.length;
    $("#scmRevertAllBtn").disabled = !list.length || WS.readonly;
    $$("[data-diff]", host).forEach(function (node) {
      node.addEventListener("click", function (e) {
        if (e.target.closest(".scm__revert")) return;
        openDiff(node.getAttribute("data-diff"));
      });
    });
    $$("[data-revert]", host).forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        revertPath(btn.getAttribute("data-revert"));
      });
    });
    $("#sbChangeCount").textContent = String(list.length);
    $("#sbChanges").classList.toggle("sb-item--has-changes", !!list.length);
  }

  async function revertPath(path) {
    if (!WS.loaded) return;
    if (WS.readonly) { toast({ title: "Read-only workspace", msg: "Reopen the folder with write access to revert.", type: "warn" }); return; }
    var ok = await confirmAction({
      title: "Revert " + baseName(path) + "?",
      message: "The file returns to the content it had when this folder was opened. This writes to disk.",
      ok: "Revert",
      danger: true
    });
    if (!ok) return;
    try {
      await WS.revert(path);
      closeTabsFor(path, "diff");
      toast({ title: "Reverted", msg: path, type: "success" });
      logOutput("workspace", "reverted " + path, "out-warn");
    } catch (e) {
      toast({ title: "Could not revert", msg: e.message || String(e), type: "error" });
    }
  }

  async function revertAll() {
    if (!WS.loaded || WS.readonly) return;
    var n = WS.changes().length;
    if (!n) return;
    var ok = await confirmAction({
      title: "Revert all session changes?",
      message: plural(n, "file") + " will return to the content on disk when the folder was opened. This writes to disk and cannot be undone.",
      ok: "Revert all",
      danger: true
    });
    if (!ok) return;
    try {
      await WS.revertAll();
      state.tabs = state.tabs.filter(function (t) { return t.kind !== "diff"; });
      if (!activeTab()) showWelcomeLayer();
      else activateTab(activeTab());
      toast({ title: "Reverted all changes", msg: plural(n, "file"), type: "success" });
    } catch (e) {
      toast({ title: "Revert failed", msg: e.message || String(e), type: "error" });
    }
  }

  /* ============================ BOTTOM PANEL =========================== */
  function setPanelTab(name) {
    if (["problems", "output", "terminal"].indexOf(name) < 0) name = "terminal";
    settings.panelTab = name;
    $$(".ptab").forEach(function (t) { t.classList.toggle("ptab--active", t.getAttribute("data-panel") === name); });
    ["problems", "output", "terminal"].forEach(function (p) { $("#pview-" + p).hidden = p !== name; });
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
    }).join("") : '<div class="prob-empty">No diagnostics. HugMoss has no language server in the browser; syntax errors are reported by your compiler, linter or CI, not by the editor.</div>';
    $$("[data-prob]", host).forEach(function (node) {
      node.addEventListener("click", function () {
        var p = state.problems[Number(node.getAttribute("data-prob"))];
        if (p) openFile(p.path, { line: p.line });
      });
    });
  }

  function setProblems(list) {
    state.problems = Array.isArray(list) ? list.slice() : [];
    renderProblems();
  }

  /* ============================ PROVIDERS UI =========================== */
  var providerOpen = {};

  function paint(node, color) {
    if (node && color && color !== "currentColor") node.style.color = color;
  }

  function providerState(p) {
    if (p.custom) return Providers.baseUrl(p) ? { text: "Configured", cls: "is-on" } : { text: "Set endpoint", cls: "is-off" };
    if (p.id === "ollama") return { text: "Local", cls: "is-local" };
    if (Providers.key(p.id)) return { text: "Key saved", cls: "is-on" };
    if (Providers.hosted(p.id)) return { text: "Hosted key", cls: "is-on" };
    return { text: "Key needed", cls: "is-off" };
  }

  function renderProviders() {
    var host = $("#providerList");
    if (!host) return;
    var list = Providers.list();
    host.innerHTML = list.map(function (p) {
      var st = providerState(p);
      var open = !!providerOpen[p.id];
      var keyed = !!Providers.key(p.id);
      var hosted = Providers.hosted(p.id);
      var cfg = Providers.customConfig();
      var body = '<div class="provider__body">' +
        (p.note ? '<p class="provider__note">' + HL.esc(p.note) + "</p>" : "") +
        (p.custom
          ? '<label class="provider__label" for="providerBase">Base URL</label>' +
            '<input class="provider__input" id="providerBase" data-base type="url" placeholder="http://localhost:8000/v1" autocomplete="off" spellcheck="false" value="' + HL.esc(cfg.baseUrl) + '">' +
            '<label class="provider__label" for="providerModels">Chat model IDs, one per line</label>' +
            '<textarea class="provider__input provider__input--area" id="providerModels" data-models rows="3" placeholder="my-model&#10;my-model-mini" spellcheck="false">' + HL.esc(cfg.models.join("\n")) + "</textarea>"
          : "") +
        (p.id === "ollama"
          ? '<div class="provider__endpoint"><span>Endpoint</span><code>' + HL.esc(Providers.baseUrl(p)) + "</code></div>"
          : '<label class="provider__label" for="key_' + p.id + '">API key' + (p.keyless || hosted ? " (optional)" : "") + "</label>" +
            '<div class="provider__keyrow">' +
            '<input class="provider__input" id="key_' + p.id + '" data-key type="password" autocomplete="new-password" spellcheck="false" placeholder="' + (keyed ? "Saved — paste to replace" : hosted ? "Optional — this deployment supplies a key" : (p.custom ? "Optional bearer token" : "Paste your key")) + '">' +
            '<button class="sbtn provider__reveal" data-reveal aria-label="Show key" data-tip="Show key">' + Icons.ui("eye", 14) + "</button>" +
            "</div>") +
        '<div class="provider__actions">' +
        '<button class="btn btn--accent btn--sm" data-save>Save</button>' +
        '<button class="btn btn--ghost btn--sm" data-test>Test connection</button>' +
        (keyed && p.id !== "ollama" ? '<button class="linkbtn linkbtn--danger" data-remove>Remove key</button>' : "") +
        (p.keyUrl ? '<a class="linkbtn" href="' + HL.esc(p.keyUrl) + '" target="_blank" rel="noopener noreferrer">Get a key</a>' : "") +
        (p.docs ? '<a class="linkbtn" href="' + HL.esc(p.docs) + '" target="_blank" rel="noopener noreferrer">Docs</a>' : "") +
        "</div>" +
        '<div class="provider__msg" data-msg></div>' +
        "</div>";
      return '<div class="provider' + (open ? " is-open" : "") + '" data-provider="' + p.id + '">' +
        '<button class="provider__head" data-provider-head aria-expanded="' + open + '">' +
        '<span class="provider__mark" data-color="' + HL.esc(p.color || "currentColor") + '">' + Providers.mark(p.mark, 18) + "</span>" +
        '<span class="provider__name">' + HL.esc(p.name) + '<em>' + HL.esc(p.custom ? (cfg.baseUrl || "OpenAI-compatible endpoint") : p.baseUrl.replace(/^https?:\/\//, "")) + "</em></span>" +
        (p.id === "ollama" ? '<span class="provider__badge">official api</span>' : "") +
        '<span class="provider__state ' + st.cls + '">' + st.text + "</span>" +
        '<span class="provider__chev">' + Icons.ui("chevron", 13) + "</span>" +
        "</button>" + body + "</div>";
    }).join("");
    $$(".provider", host).forEach(function (wrap) { $$(".provider__mark", wrap).forEach(function (m) { paint(m, m.getAttribute("data-color")); }); });
    $$("[data-provider-head]", host).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var wrap = btn.closest(".provider");
        var id = wrap.getAttribute("data-provider");
        providerOpen[id] = !providerOpen[id];
        wrap.classList.toggle("is-open", providerOpen[id]);
        btn.setAttribute("aria-expanded", String(providerOpen[id]));
      });
    });
    $$("[data-save]", host).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.closest(".provider").getAttribute("data-provider");
        if (Providers.get(id).custom) saveCustomProvider(id);
        else saveProviderKey(id);
      });
    });
    $$("[data-test]", host).forEach(function (btn) {
      btn.addEventListener("click", function () {
        testProvider(btn.closest(".provider").getAttribute("data-provider"), btn);
      });
    });
    $$("[data-remove]", host).forEach(function (btn) {
      btn.addEventListener("click", function () { removeProviderKey(btn.closest(".provider").getAttribute("data-provider")); });
    });
    $$("[data-reveal]", host).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = $("[data-key]", btn.closest(".provider__keyrow"));
        if (!input) return;
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.innerHTML = Icons.ui(show ? "lock" : "eye", 14);
        btn.setAttribute("data-tip", show ? "Hide key" : "Show key");
      });
    });
    $("#providerCount").textContent = Providers.configuredCount() + " configured";
  }

  function updateGatewayNote() {
    var note = $("#providerNote");
    if (!note) return;
    note.innerHTML = Providers.gatewayOn()
      ? "Keys you enter here stay in this browser&rsquo;s localStorage. Requests go through this deployment&rsquo;s gateway, which uses your key when present and otherwise uses the provider key configured on the server."
      : "HugMoss keeps your keys in this browser&rsquo;s localStorage. This page is running in direct mode, so requests go straight from this tab to the provider.";
  }

  function providerMsg(id, text, cls) {
    var wrap = $('.provider[data-provider="' + id + '"]');
    var msg = wrap && $("[data-msg]", wrap);
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "provider__msg" + (cls ? " provider__msg--" + cls : "");
  }

  function refreshAgentUI() {
    if (!window.Agent) return;
    if (Agent.refreshModel) Agent.refreshModel();
    if (Agent.refreshSuggestions) Agent.refreshSuggestions();
  }

  function saveProviderKey(id) {
    var wrap = $('.provider[data-provider="' + id + '"]');
    if (!wrap) return;
    var input = $("[data-key]", wrap);
    var value = input ? input.value.trim() : "";
    var p = Providers.get(id);
    if (!value) {
      providerMsg(id, Providers.hasKey(id) ? "No new key entered — the saved key is unchanged." : "Paste a key first.", Providers.hasKey(id) ? "" : "err");
      return;
    }
    if (value.length < 8) { providerMsg(id, "That key looks too short. Paste the full key.", "err"); return; }
    Providers.setKey(id, value);
    if (input) input.value = "";
    renderProviders();
    if (!Providers.selection()) {
      var models = Providers.cachedModels(id) || Providers.fallbackModels(p);
      var first = models[0];
      if (first) Providers.setSelection(id, first.id, first.label);
    }
    providerOpen[id] = true;
    renderProviders();
    providerMsg(id, "Key saved in this browser. Use Test connection to verify it.", "ok");
    updateWorkspaceChrome();
    refreshAgentUI();
    toast({ title: p.name + " connected", msg: "The key stays in this browser and is sent only to " + p.name + ".", type: "success" });
    logOutput("providers", p.name + " key saved", "out-ok");
    notify({ icon: "check", title: p.name + " connected", body: "Model catalogue will load from the provider." });
  }

  async function removeProviderKey(id) {
    var p = Providers.get(id);
    var ok = await confirmAction({
      title: "Remove " + p.name + " key?",
      message: "The key is deleted from this browser. The selected model may stop working.",
      ok: "Remove key",
      danger: true
    });
    if (!ok) return;
    Providers.setKey(id, "");
    if (Providers.selection() && Providers.selection().provider === id) Providers.setSelection(null);
    renderProviders();
    providerOpen[id] = true;
    renderProviders();
    providerMsg(id, "Key removed.", "ok");
    updateWorkspaceChrome();
    refreshAgentUI();
    toast({ title: "Key removed", msg: p.name, type: "info" });
  }

  function saveCustomProvider(id) {
    var wrap = $('.provider[data-provider="' + id + '"]');
    if (!wrap) return;
    var base = $("[data-base]", wrap).value.trim().replace(/\/+$/, "");
    var modelText = $("[data-models]", wrap).value;
    var models = modelText.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!base) { providerMsg(id, "Enter the base URL, including https:// or http://.", "err"); return; }
    try {
      var u = new URL(base);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    } catch (e) { providerMsg(id, "That is not a valid http(s) URL.", "err"); return; }
    if (!models.length) { providerMsg(id, "Add at least one model ID.", "err"); return; }
    Providers.setCustomConfig({ baseUrl: base, models: models });
    var keyInput = $("[data-key]", wrap);
    if (keyInput && keyInput.value.trim()) Providers.setKey(id, keyInput.value.trim());
    renderProviders();
    providerOpen[id] = true;
    renderProviders();
    providerMsg(id, "Endpoint saved · " + plural(models.length, "model"), "ok");
    updateWorkspaceChrome();
    refreshAgentUI();
    toast({ title: "Custom endpoint saved", msg: base + " · " + plural(models.length, "model"), type: "success" });
  }

  async function testProvider(id, btn) {
    var p = Providers.get(id);
    var input = $("[data-key]", btn.closest(".provider"));
    var typedKey = input ? input.value.trim() : "";
    var unsaved = !!typedKey && typedKey !== Providers.key(id);
    btn.disabled = true;
    providerMsg(id, "Contacting " + p.name + "…");
    try {
      var result = p.id === "ollama"
        ? { models: await Providers.ollamaTags(), ms: 0 }
        : await Providers.fetchModels(p, { force: true, apiKey: typedKey || undefined });
      var detail = result.models.length
        ? plural(result.models.length, "model") + " available"
        : (p.id === "ollama" ? "no models installed yet · download one from the model picker" : "no models installed yet");
      providerMsg(id, "Reachable · " + detail + (p.id === "ollama" ? "" : " · " + (result.ms || 0) + " ms") + (unsaved ? " · press Save to keep this key" : ""), "ok");
      renderProviders();
      providerOpen[id] = true;
      renderProviders();
      if (!Providers.selection() && !unsaved && result.models.length) {
        Providers.setSelection(id, result.models[0].id, result.models[0].label);
        refreshAgentUI();
      }
      updateWorkspaceChrome();
      toast({
        title: p.id === "ollama" ? "Ollama is running" : p.name + " is reachable",
        msg: result.models.length ? plural(result.models.length, "chat model") + " returned." + (unsaved ? " Save the key to use them." : "") : "No models installed yet. Download one from the model picker.",
        type: "success"
      });
    } catch (e) {
      var message = e.message || String(e);
      var network = /Failed to fetch|Load failed|NetworkError|No response from localhost/i.test(message);
      var hint = "";
      if (network) {
        hint = Providers.gatewayOn()
          ? " The gateway could not reach " + (p.id === "ollama" ? "Ollama on its host." : p.name + ". Check the gateway logs and its network access.")
          : " The browser could not reach " + (p.id === "ollama" ? "Ollama. Start it with OLLAMA_ORIGINS=*." : p.name + ". Check CORS, the key, or serve this page over http://localhost.");
      } else if (Providers.gatewayOn() && p.id === "ollama" && /not reachable/i.test(message)) {
        hint = " Set OLLAMA_URL if Ollama runs on another machine.";
      }
      providerMsg(id, message + hint, "err");
      renderProviders();
      providerOpen[id] = true;
      renderProviders();
      providerMsg(id, (e.message || String(e)) + hint, "err");
    } finally {
      var newBtn = $('.provider[data-provider="' + id + '"] [data-test]');
      if (newBtn) newBtn.disabled = false;
    }
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
    var out = "", prev = 0, groups = [];
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

  var commands = [
    { id: "folder.open", label: "Folder: Open Folder…", hint: "Ctrl+O" },
    { id: "folder.files", label: "Folder: Open Files (read-only)…", hint: "" },
    { id: "folder.rescan", label: "Folder: Rescan from Disk", hint: "" },
    { id: "folder.close", label: "Folder: Close Folder", hint: "" },
    { id: "file.new", label: "File: New File…", hint: "" },
    { id: "file.folder", label: "File: New Folder…", hint: "" },
    { id: "file.save", label: "File: Save", hint: "Ctrl+S" },
    { id: "file.saveAll", label: "File: Save All", hint: "Ctrl+Shift+S" },
    { id: "file.download", label: "File: Download a Copy", hint: "" },
    { id: "file.close", label: "File: Close Editor", hint: "" },
    { id: "file.closeAll", label: "File: Close All Editors", hint: "" },
    { id: "palette.files", label: "Go to File…", hint: "Ctrl+K" },
    { id: "explorer.view", label: "View: Explorer", hint: "" },
    { id: "search.view", label: "Search: Find in Files", hint: "Ctrl+Shift+F" },
    { id: "scm.view", label: "Changes: Open Session Changes", hint: "" },
    { id: "skills.view", label: "Skills: Open NVIDIA Skills", hint: "" },
    { id: "agent.new", label: "Agent: New Session", hint: "" },
    { id: "agent.focus", label: "Agent: Focus Chat", hint: "Alt+A" },
    { id: "agent.model", label: "Agent: Choose Model", hint: "" },
    { id: "agent.providers", label: "Agent: Manage AI Providers", hint: "" },
    { id: "term.new", label: "Terminal: New Shell", hint: "" },
    { id: "term.clear", label: "Terminal: Clear", hint: "" },
    { id: "theme.toggle", label: "View: Toggle Theme", hint: "Alt+T" },
    { id: "sidebar.toggle", label: "View: Toggle Task Rail", hint: "Ctrl+B" },
    { id: "panel.toggle", label: "View: Toggle Editor Panel", hint: "Alt+J" },
    { id: "wrap.toggle", label: "View: Toggle Word Wrap", hint: "" },
    { id: "minimap.toggle", label: "View: Toggle Minimap", hint: "" },
    { id: "welcome", label: "View: Show Welcome", hint: "" },
    { id: "settings", label: "Preferences: Open Settings", hint: "" }
  ];

  function buildPaletteRows(mode, query) {
    var rows = [];
    if (mode === "files") {
      WS.visiblePaths().forEach(function (path) {
        var m = fuzzy(query, path);
        if (m) rows.push({ score: m.score, hits: m.hits, label: baseName(path), path: path, kind: "file", target: path });
      });
    } else {
      commands.forEach(function (c) {
        var m = fuzzy(query, c.label);
        if (m) rows.push({ score: m.score, hits: m.hits, label: c.label, hint: c.hint, kind: "cmd", target: c.id });
      });
      Providers.available().forEach(function (p) {
        var label = "Provider: " + p.name + (Providers.hasKey(p.id) ? " — connected" : " — connect");
        var m = fuzzy(query, label);
        if (m) rows.push({ score: m.score - 4, hits: m.hits, label: label, hint: Providers.hasKey(p.id) ? "manage" : "add key", kind: "provider", target: p.id, mark: p.mark });
      });
    }
    rows.sort(function (a, b) { return b.score - a.score; });
    return rows.slice(0, 40);
  }

  function openPalette(mode, seed) {
    paletteState.mode = mode || "commands";
    paletteState.sel = 0;
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
      var icon = r.kind === "file" ? Icons.file(r.target) : r.kind === "provider" ? Providers.mark(r.mark, 14) : Icons.ui("chevron", 14);
      return '<div class="palette-row' + (i === paletteState.sel ? " palette-row--sel" : "") + '" data-i="' + i + '">' +
        '<span class="palette-row__icon">' + icon + "</span>" +
        '<span class="palette-row__label">' + markHits(r.label, r.hits) +
        (r.kind === "file" && r.path ? '<span class="palette-row__path">' + HL.esc(dirName(r.path) || ".") + "</span>" : "") + "</span>" +
        (r.hint ? '<kbd class="palette-row__hint">' + HL.esc(r.hint) + "</kbd>" : "") + "</div>";
    }).join("") : '<div class="palette__empty">' + (mode === "files" && !WS.loaded ? "Open a folder to search its files. Type > for commands." : "No matching " + (mode === "files" ? "files" : "commands")) + "</div>";
    $$(".palette-row", $("#paletteList")).forEach(function (row) {
      row.addEventListener("click", function () { paletteState.sel = Number(row.getAttribute("data-i")); acceptPalette(); });
      row.addEventListener("mousemove", function () {
        var i = Number(row.getAttribute("data-i"));
        if (i !== paletteState.sel) {
          paletteState.sel = i;
          $$(".palette-row", $("#paletteList")).forEach(function (r, j) { r.classList.toggle("palette-row--sel", j === i); });
        }
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
    else if (row.kind === "provider") { activateView("extensions"); openSettings(row.target); }
    else runCommand(row.target);
  }

  function showPanelInEditor(tab) {
    if (window.Shell && !Shell.editorOpen()) Shell.showEditor(null, { silent: true });
    if (!settings.panelOpen) setPanelOpen(true);
    setPanelTab(tab || "terminal");
    if (window.Shell && Shell.route) Shell.route("terminal");
  }

  function runCommand(id) {
    switch (id) {
      case "folder.open": openFolderFlow(); break;
      case "folder.files": openFilesFlow(); break;
      case "folder.rescan": rescanFlow(); break;
      case "folder.close": closeWorkspace(); break;
      case "file.new": newFile(); break;
      case "file.folder": newFolder(); break;
      case "file.save": saveActive(); break;
      case "file.saveAll": saveAll(); break;
      case "file.download": if (state.active) downloadPath(state.active); break;
      case "file.close": if (state.activeKey) closeTab(state.activeKey); break;
      case "file.closeAll": closeAllTabs(); break;
      case "palette.files": openPalette("files", ""); break;
      case "palette.commands": openPalette("commands", ">"); break;
      case "search.drawer": if (window.Shell) Shell.openView("search", "Search"); break;
      case "nav.toggle": if (window.Shell) Shell.toggleNav(); break;
      case "browser.toggle": if (window.Shell) Shell.toggleBrowser(); break;
      case "explorer.view": if (window.Shell) Shell.openView("explorer", "Explorer"); else activateView("explorer"); break;
      case "search.view": if (window.Shell) Shell.openView("search", "Search"); else activateView("search"); break;
      case "scm.view": if (window.Shell) Shell.openView("scm", "Changes"); else activateView("scm"); break;
      case "skills.view": if (window.Shell) Shell.openView("skills", "Knowledge Center"); else activateView("skills"); break;
      case "agent.new": setAgentOpen(true); if (window.Agent) Agent.newSession(); break;
      case "agent.focus": setAgentOpen(true); syncDrawerChrome(); if (window.Agent) Agent.focusInput(); break;
      case "agent.model": setAgentOpen(true); syncDrawerChrome(); if (window.Agent) Agent.openModelPicker(); break;
      case "agent.providers": openSettings(null); break;
      case "term.new": showPanelInEditor("terminal"); if (window.Terminal) Terminal.newSession(); break;
      case "term.clear": showPanelInEditor("terminal"); if (window.Terminal) Terminal.clear(); break;
      case "theme.toggle": toggleTheme(); break;
      case "sidebar.toggle": if (window.Shell) Shell.toggleNav(); else { setSidebarOpen(!settings.sidebarOpen); syncDrawerChrome(); } break;
      case "panel.toggle":
        if (window.Shell && !Shell.editorOpen()) showPanelInEditor(settings.panelTab || "terminal");
        else setPanelOpen(!settings.panelOpen);
        break;
      case "wrap.toggle": setWrap(!settings.wrap); break;
      case "minimap.toggle": setMinimap(!settings.minimap); break;
      case "welcome": if (window.Shell) Shell.showEditor(null); else showWelcomeLayer(); break;
      case "settings": openSettings(null); break;
    }
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
    settings.fontSize = clamp(Number(px) || 13, 12, 16);
    document.documentElement.style.setProperty("--fs-code", settings.fontSize + "px");
    $("#fontSizeValue").textContent = settings.fontSize + "px";
    $("#fontSizeRange").value = String(settings.fontSize);
    persist();
    renderMinimap();
  }

  function syncSettingsControls() {
    applyTheme();
    $$(".theme-card").forEach(function (c) {
      c.classList.toggle("theme-card--active", c.getAttribute("data-theme-choice") === settings.theme);
    });
    $("#fontSizeValue").textContent = settings.fontSize + "px";
    $("#fontSizeRange").value = String(settings.fontSize);
    $("#wrapToggle").classList.toggle("switch--on", settings.wrap);
    $("#wrapToggle").setAttribute("aria-checked", String(settings.wrap));
    $("#minimapToggle").classList.toggle("switch--on", settings.minimap);
    $("#minimapToggle").setAttribute("aria-checked", String(settings.minimap));
    $("#agentModeSelect").value = settings.agentMode;
    $("#settingsOpenFolder").disabled = false;
    $("#settingsCloseFolder").disabled = !WS.loaded;
    $("#settingsWorkspaceName").textContent = WS.loaded ? WS.projectName : "None";
    $("#settingsWorkspaceSource").textContent = !WS.loaded ? "—"
      : WS.source === "files" ? "File picker (read-only)"
      : WS.hasHandle ? "Folder picker · handle saved in this browser"
      : "Drag and drop (read-only)";
    $("#settingsWorkspaceMode").textContent = !WS.loaded ? "—" : WS.readonly ? "Read-only" : "Read and write";
    $("#agentAccessValue").textContent = !WS.loaded ? "No folder open" : WS.readonly ? "Read-only — writing disabled" : "Read and write · every write waits for approval";
    renderProviderSummary();
  }

  function openSettings(providerId) {
    var id = providerId && typeof providerId === "object" ? providerId.id : providerId;
    if (id) providerOpen[id] = true;
    $("#settingsOverlay").hidden = false;
    renderProviders();
    syncSettingsControls();
    if (window.Shell && Shell.route) Shell.route("settings");
    if (id) {
      setTimeout(function () {
        var node = $('.provider[data-provider="' + id + '"]');
        if (node) node.scrollIntoView({ block: "center" });
      }, 30);
    }
    setTimeout(function () { $("#settingsClose").focus(); }, 10);
  }
  function closeSettingsUI() { $("#settingsOverlay").hidden = true; }
  function closeSettings() {
    closeSettingsUI();
    if (window.Shell && Shell.modalClosed) Shell.modalClosed();
  }

  /* ============================== MENUS =============================== */
  var menuSpecs = {
    file: [
      { label: "Open Folder…", kbd: "Ctrl+O", cmd: "folder.open" },
      { label: "Open Files (read-only)…", cmd: "folder.files" },
      { type: "sep" },
      { label: "New File…", cmd: "file.new" },
      { label: "New Folder…", cmd: "file.folder" },
      { type: "sep" },
      { label: "Close Folder", cmd: "folder.close" }
    ],
    edit: [
      { label: "Find in Files…", kbd: "Ctrl+Shift+F", cmd: "search.drawer" },
      { label: "Go to File…", kbd: "Ctrl+K", cmd: "palette.files" },
      { label: "Command Palette…", kbd: "Ctrl+Shift+P", cmd: "palette.commands" }
    ],
    selection: [
      { label: "Select All", kbd: "Ctrl+A", disabled: true },
      { label: "Expand Selection", disabled: true }
    ],
    view: [
      { label: "Toggle Navigation", kbd: "Ctrl+B", cmd: "nav.toggle" },
      { label: "Toggle Browser", kbd: "Ctrl+Shift+B", cmd: "browser.toggle" },
      { type: "sep" },
      { label: "Toggle Theme", kbd: "Alt+T", cmd: "theme.toggle" },
      { label: "Command Palette…", kbd: "Ctrl+Shift+P", cmd: "palette.commands" }
    ],
    go: [
      { label: "Go to File…", kbd: "Ctrl+K", cmd: "palette.files" },
      { label: "Find in Files…", kbd: "Ctrl+Shift+F", cmd: "search.view" }
    ],
    run: [
      { label: "Open Terminal", cmd: "term.new" },
      { label: "Start Debugging", disabled: true },
      { type: "sep" },
      { label: "No process host in a browser tab", disabled: true }
    ],
    terminal: [
      { label: "New Shell", cmd: "term.new" },
      { label: "Clear Terminal", cmd: "term.clear" },
      { type: "sep" },
      { label: "Toggle Panel", kbd: "Alt+J", cmd: "panel.toggle" }
    ],
    help: [
      { label: "Manage AI Providers", cmd: "agent.providers" },
      { label: "Open Settings", cmd: "settings" },
      { label: "Project Repository", cmd: "repo" },
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
        var cmd = btn.getAttribute("data-cmd");
        hideMenu();
        if (cmd === "about") {
          if (window.Shell && Shell.about) Shell.about();
          else toast({ title: "HugMoss Code", msg: "Browser IDE · real folder, bring your own AI key · built by IRAGUHA Vincent", type: "agent", timeout: 5200 });
          return;
        }
        if (cmd === "repo") {
          window.open("https://github.com/senid-221/HugMoss-Code", "_blank", "noopener,noreferrer");
          return;
        }
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

  /* =========================== CONTEXT MENUS =========================== */
  function showCtxMenu(x, y, items) {
    var host = $("#ctxMenu");
    host.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<div class="ctx-menu__sep"></div>';
      return '<button class="ctx-menu__item' + (it.danger ? " is-danger" : "") + (it.disabled ? " is-disabled" : "") + '" data-ci="' + i + '"' + (it.disabled ? " disabled" : "") + ">" +
        (it.icon ? '<span class="ctx-menu__icon">' + Icons.ui(it.icon, 14) + "</span>" : '<span class="ctx-menu__icon"></span>') +
        "<span>" + HL.esc(it.label) + "</span>" + (it.kbd ? "<kbd>" + HL.esc(it.kbd) + "</kbd>" : "") + "</button>";
    }).join("");
    host.hidden = false;
    host.style.left = "0px";
    host.style.top = "0px";
    var w = host.offsetWidth, h = host.offsetHeight;
    host.style.left = Math.min(x, window.innerWidth - w - 8) + "px";
    host.style.top = Math.min(y, window.innerHeight - h - 8) + "px";
    items.forEach(function (it, i) {
      if (it.sep) return;
      var btn = $('[data-ci="' + i + '"]', host);
      if (!btn) return;
      btn.addEventListener("click", function () {
        host.hidden = true;
        if (!it.disabled && it.action) it.action();
      });
    });
  }
  function hideCtxMenu() { $("#ctxMenu").hidden = true; }

  function fileMenu(e, path) {
    var rec = WS.record(path);
    var changed = WS.changes().some(function (c) { return c.path === path; });
    showCtxMenu(e.clientX, e.clientY, [
      { label: "Open", icon: "file", action: function () { openFile(path, { focus: true }); } },
      { label: "Open Changes", icon: "git", disabled: !changed, action: function () { openDiff(path); } },
      { sep: true },
      { label: "Save", icon: "check", kbd: "Ctrl+S", disabled: WS.readonly || !WS.isDirty(path), action: function () { savePath(path); } },
      { label: "Download a Copy", icon: "arrowDown", action: function () { downloadPath(path); } },
      { label: "Copy Relative Path", action: function () { copyText(path); } },
      { sep: true },
      { label: "New File Here…", icon: "newfile", action: function () { newFile(dirName(path)); } },
      { label: "Delete File", icon: "trash", danger: true, disabled: WS.readonly, action: function () { deletePath(path); } }
    ]);
    if (rec && rec.secret) logOutput("workspace", "secret-bearing file selected: " + path, "out-warn");
  }

  function dirMenu(e, path) {
    showCtxMenu(e.clientX, e.clientY, [
      { label: "New File Here…", icon: "newfile", action: function () { newFile(path); } },
      { label: "New Folder Here…", icon: "newfolder", disabled: WS.readonly, action: function () { newFolder(path); } },
      { sep: true },
      { label: "Copy Relative Path", action: function () { copyText(path); } },
      { label: "Collapse Folder", icon: "collapse", action: function () { state.expanded[path] = false; renderTree(); } }
    ]);
  }

  function copyText(text) {
    var done = function () { toast({ title: "Copied", msg: text.length > 70 ? text.slice(0, 70) + "…" : text, type: "info", timeout: 2000 }); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* clipboard denied */ }
    ta.remove();
  }

  /* =========================== WORKSPACE FLOWS ========================= */
  function discardPrompt(action) {
    var n = WS.loaded ? WS.changes().length : 0;
    if (!n) return Promise.resolve(true);
    return confirmAction({
      title: "Replace this session?",
      message: plural(n, "file has", "files have") + " session edits that are not on disk. Opening another workspace discards those edits.",
      ok: action || "Continue",
      danger: true
    });
  }

  async function openFolderFlow() {
    if (window.Agent && Agent.isRunning()) { toast({ title: "Agent is working", msg: "Stop the agent before switching folders.", type: "warn" }); return; }
    if (!(await discardPrompt("Open folder"))) return;
    try {
      var result = await WS.openFolder();
      if (!result || result.cancelled || result.fallback) return;
      if (!result.loaded) return;
      toast({ title: "Folder opened", msg: result.name + " · " + plural(result.visible, "readable file") + (result.readonly ? " · read-only" : " · read and write"), type: "success" });
      notify({ icon: "folderOpen", title: "Folder opened", body: result.name + " · " + plural(result.visible, "file") });
    } catch (e) {
      toast({ title: "Could not open folder", msg: e.message || String(e), type: "error" });
    }
  }

  function openFilesFlow() {
    var input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", async function () {
      var files = Array.from(input.files || []);
      input.remove();
      if (!files.length) return;
      if (!(await discardPrompt("Open files"))) return;
      try {
        var result = await WS.openFiles(files);
        if (result) {
          toast({ title: "Files opened read-only", msg: plural(result.visible, "file") + " · use Download a Copy to export edits", type: "info", timeout: 6000 });
          notify({ icon: "folderOpen", title: "Read-only workspace", body: plural(result.visible, "file") + " loaded from the file picker." });
        }
      } catch (e) {
        toast({ title: "Could not read files", msg: e.message || String(e), type: "error" });
      }
    });
    document.body.appendChild(input);
    input.click();
  }

  async function reopenFlow() {
    try {
      var result = await WS.reopen();
      if (result && result.loaded) toast({ title: "Folder reopened", msg: result.name + (result.readonly ? " · read-only" : ""), type: "success" });
    } catch (e) {
      toast({ title: "Could not reopen folder", msg: e.message || String(e), type: "error" });
    }
  }

  async function rescanFlow() {
    if (!WS.loaded) return;
    if (WS.hasHandle) {
      if (WS.changes().length) {
        var ok = await confirmAction({
          title: "Rescan from disk?",
          message: "Unwritten session edits are discarded and every file is re-read from the folder.",
          ok: "Rescan",
          danger: true
        });
        if (!ok) return;
      }
      try {
        await WS.rescan();
        toast({ title: "Folder rescanned", msg: WS.projectName + " · " + plural(WS.visiblePaths().length, "file"), type: "success" });
      } catch (e) {
        toast({ title: "Rescan failed", msg: e.message || String(e), type: "error" });
      }
    } else {
      state.tabs.forEach(function (tab) {
        if (tab.kind === "file") renderTabs();
      });
      renderTree();
      renderTimeline();
      toast({ title: "Refreshed", msg: "Read-only workspaces keep the content they were opened with.", type: "info" });
    }
  }

  async function closeWorkspace() {
    if (!WS.loaded) return;
    if (window.Agent && Agent.isRunning()) { toast({ title: "Agent is working", msg: "Stop the agent before closing the folder.", type: "warn" }); return; }
    if (!(await discardPrompt("Close folder"))) return;
    WS.close();
    toast({ title: "Folder closed", type: "info" });
  }

  function hydrateWorkspace(summary) {
    state.tabs = [];
    state.activeKey = null;
    state.active = null;
    state.expanded = {};
    state.cursor = { line: 1, col: 1 };
    state.problems = [];
    renderProblems();
    renderTabs();
    renderTree();
    renderScm();
    renderTimeline();
    renderWelcome();
    showWelcomeLayer();
    updateWorkspaceChrome();
    if (window.Terminal && Terminal.workspaceChanged) Terminal.workspaceChanged();
    if (window.Agent && Agent.refreshSuggestions) Agent.refreshSuggestions();
    if (summary && summary.loaded) {
      logOutput("workspace", "opened " + summary.name + " · " + plural(summary.visible, "file") + (summary.readonly ? " · read-only" : "") + (summary.skipped ? " · " + summary.skipped + " skipped" : ""), "out-ok");
    }
  }

  function updateWorkspaceChrome() {
    var loaded = WS.loaded;
    var changes = loaded ? WS.changes().length : 0;
    $("#titleSearchText").textContent = loaded ? "Search " + WS.projectName : "Search HugMoss";
    $("#projectLabel").textContent = loaded ? WS.projectName.toUpperCase() : "NO FOLDER OPEN";
    $("#projectLabel").title = loaded ? WS.projectName : "No folder open";
    $("#sbWorkspaceName").textContent = loaded ? WS.projectName : "No folder";
    $("#sbWorkspace").title = loaded ? (WS.readonly ? "Read-only workspace" : "Read and write workspace") : "Open a folder (Ctrl+O)";
    $("#sbChangeCount").textContent = String(changes);
    $("#sbChanges").classList.toggle("sb-item--has-changes", changes > 0);
    $("#sbReadonly").hidden = !(loaded && WS.readonly);
    $("#sbChanges").title = loaded ? plural(changes, "session change") : "No folder open";
    $("#scmTitle").textContent = "Session Changes";
    $("#scmCount").textContent = String(changes);
    document.title = (loaded ? WS.projectName + " — " : "") + "HugMoss Code";
    if (!$("#settingsOverlay").hidden) syncSettingsControls();
    renderProviderSummary();
  }

  function renderProviderSummary() {
    var host = $("#providerSummary");
    if (!host) return;
    var count = Providers.configuredCount();
    var hosted = 0;
    Providers.list().forEach(function (p) { if (Providers.hosted(p.id)) hosted += 1; });
    host.textContent = count
      ? plural(count, "provider") + " ready · " + (hosted
        ? "this deployment supplies " + plural(hosted, "hosted key") + "."
        : "requests use the key saved in this browser.")
      : "No provider configured. Add a key in Settings to use the agent.";
    var pill = $("#providerCount");
    if (pill) pill.textContent = count + " configured";
  }

  /* ============================= FILE OPS ============================== */
  function validatePath(p) {
    var value = String(p || "").trim();
    if (!value) return "Enter a path.";
    if (/[<>:"|?*\u0000-\u001f]/.test(value)) return "That path contains characters the file system does not allow.";
    if (/(^|\/)\.\.(\/|$)/.test(value)) return "Paths cannot contain “..”.";
    if (/^[a-zA-Z]:[\\/]/.test(value)) return "Use a path relative to the open folder.";
    if (/\/$/.test(value)) return "Enter a file name, not a folder.";
    if (WS.isSecret(WS.normalize(value)) && !/\.(example|sample|template)$/i.test(value)) return "HugMoss blocks secret-bearing file names such as .env, .npmrc and private keys.";
    return "";
  }

  function newFile(dir) {
    if (!WS.loaded) { toast({ title: "Open a folder first", msg: "Files are created relative to the open folder.", type: "info" }); openFolderFlow(); return; }
    var seed = dir ? dir.replace(/\/+$/, "") + "/" : "";
    openDialog({
      title: "New File",
      message: "The file is created in the open folder" + (WS.readonly ? " in memory; this workspace is read-only, so use Download a Copy to export it." : "."),
      label: "Relative path",
      value: seed,
      placeholder: "src/component.ts",
      ok: "Create file",
      validate: validatePath
    }).then(async function (path) {
      if (!path) return;
      var clean = WS.normalize(path);
      if (WS.record(clean) && !WS.record(clean).deleted) {
        openFile(clean, { focus: true });
        toast({ title: "File already exists", msg: clean, type: "info" });
        return;
      }
      try {
        await WS.createFile(clean, "");
        expandAncestors(clean);
        openFile(clean, { focus: true });
        toast({ title: "File created", msg: clean, type: "success" });
        logOutput("workspace", "created " + clean + (WS.readonly ? " (memory only)" : ""), "out-ok");
      } catch (e) {
        toast({ title: "Could not create file", msg: e.message || String(e), type: "error" });
      }
    });
  }

  function newFolder(dir) {
    if (!WS.loaded) { toast({ title: "Open a folder first", type: "info" }); return; }
    if (WS.readonly) { toast({ title: "Read-only workspace", msg: "Reopen the folder with write access to create folders.", type: "warn" }); return; }
    var seed = dir ? dir.replace(/\/+$/, "") + "/" : "";
    openDialog({
      title: "New Folder",
      label: "Relative path",
      value: seed,
      placeholder: "src/features",
      ok: "Create folder",
      validate: function (v) {
        var value = String(v || "").trim();
        if (!value) return "Enter a folder path.";
        if (/(^|\/)\.\.(\/|$)/.test(value)) return "Paths cannot contain “..”.";
        if (/[<>:"|?*\u0000-\u001f]/.test(value)) return "That path contains characters the file system does not allow.";
        return "";
      }
    }).then(async function (path) {
      if (!path) return;
      try {
        var clean = await WS.createFolder(path);
        state.expanded[clean] = true;
        expandAncestors(clean);
        renderTree();
        toast({ title: "Folder created", msg: clean, type: "success" });
      } catch (e) {
        toast({ title: "Could not create folder", msg: e.message || String(e), type: "error" });
      }
    });
  }

  async function deletePath(path) {
    if (!WS.loaded) return;
    if (WS.readonly) { toast({ title: "Read-only workspace", type: "warn" }); return; }
    var ok = await confirmAction({
      title: "Delete " + baseName(path) + "?",
      message: "The file is removed from disk. Revert in Session Changes restores it while this session stays open.",
      ok: "Delete file",
      danger: true
    });
    if (!ok) return;
    try {
      await WS.deleteFile(path);
      closeTabsFor(path);
      renderTree();
      renderScm();
      renderTimeline();
      toast({ title: "File deleted", msg: path, type: "success" });
      logOutput("workspace", "deleted " + path, "out-warn");
    } catch (e) {
      toast({ title: "Could not delete file", msg: e.message || String(e), type: "error" });
    }
  }

  function downloadPath(path) {
    if (!WS.loaded) return;
    var rec = WS.record(path);
    if (!rec) { toast({ title: "File not available", type: "error" }); return; }
    var blob = new Blob([rec.content || ""], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = baseName(path);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast({ title: "Copy downloaded", msg: baseName(path), type: "info" });
  }

  function savePath(path, opts) {
    opts = opts || {};
    if (!WS.loaded) return Promise.resolve(false);
    if (WS.readonly) {
      downloadPath(path);
      return Promise.resolve(false);
    }
    return WS.save(path).then(function () {
      if (!opts.batch) toast({ title: "Saved", msg: path, type: "success" });
      updateTabDirty();
      renderScm();
      updateWorkspaceChrome();
      logOutput("workspace", "saved " + path, "out-ok");
      return true;
    }).catch(function (e) {
      toast({ title: "Could not save", msg: e.message || String(e), type: "error" });
      logOutput("workspace", "save failed: " + path + " · " + (e.message || e), "out-err");
      return false;
    });
  }

  async function saveActive() {
    var tab = activeTab();
    if (!tab || tab.kind !== "file") { toast({ title: "Nothing to save", type: "info" }); return; }
    await savePath(tab.path);
  }

  async function saveAll() {
    var dirty = WS.loaded ? WS.dirtyPaths() : [];
    if (!dirty.length) { toast({ title: "Nothing to save", msg: "All editors match the disk.", type: "info" }); return; }
    if (WS.readonly) {
      for (var d = 0; d < dirty.length; d++) downloadPath(dirty[d]);
      return;
    }
    var saved = 0;
    for (var i = 0; i < dirty.length; i++) {
      if (await savePath(dirty[i], { batch: true })) saved++;
    }
    toast({ title: "Saved " + plural(saved, "file"), msg: saved === dirty.length ? "All edits written to disk." : "Some files failed — see Output.", type: saved ? "success" : "error" });
    updateTabDirty();
    renderScm();
  }

  /* ============================ VIEW SWITCH ============================ */
  function activateView(name) {
    settings.sidebarOpen = true;
    setSidebarOpen(true);
    state.view = name;
    $$(".abtn[data-view]").forEach(function (b) { b.classList.toggle("abtn--active", b.getAttribute("data-view") === name); });
    $$(".sidebar__view").forEach(function (v) { v.classList.toggle("sidebar__view--active", v.id === "view-" + name); });
    var titles = { explorer: "Explorer", search: "Search", scm: "Session Changes", debug: "Run and Debug", extensions: "AI Providers", skills: "NVIDIA Skills" };
    $("#sidebarTitle").textContent = titles[name] || "Explorer";
    if (name === "search") setTimeout(function () { $("#searchInput").focus(); }, 30);
    if (name === "scm") renderScm();
    if (name === "extensions") renderProviderSummary();
    if (name === "skills" && window.Skills) {
      Skills.render();
      setTimeout(function () { Skills.focusSearch(); }, 30);
    }
    if (isDrawer("sidebar") && settings.agentOpen) setAgentOpen(false);
    syncDrawerChrome();
  }

  function setSidebarOpen(open) {
    settings.sidebarOpen = open;
    if (open && isDrawer("sidebar") && settings.agentOpen) setAgentOpen(false);
    $("#sidebar").classList.toggle("is-hidden", !open);
    $("#sidebarResize").classList.toggle("is-hidden", !open);
    $("#toggleSidebarBtn").classList.toggle("is-on", open);
    persist();
    if (!open && isDrawer("sidebar")) $("#sidebar").classList.remove("is-open");
  }

  function setAgentOpen(open) {
    if (document.querySelector(".qshell")) open = true;
    settings.agentOpen = open;
    if (open && isDrawer("sidebar") && settings.sidebarOpen) setSidebarOpen(false);
    var panel = $("#agentPanel");
    panel.classList.toggle("is-hidden", !open);
    $("#agentResize").classList.toggle("is-hidden", !open);
    $("#toggleChatBtn").classList.toggle("is-on", open);
    $("#abtnAgent").classList.toggle("abtn--active", open);
    $("#abtnAgent").classList.toggle("abtn--accent", open);
    persist();
    if (open) {
      if (isDrawer("agent")) panel.classList.add("is-open");
      setTimeout(function () { if (window.Agent) Agent.focusInput(); }, 60);
    } else if (isDrawer("agent")) panel.classList.remove("is-open");
    updateMinimapViewport();
  }

  /* ============================== DRAWERS ============================== */
  function isDrawer(which) {
    if (document.querySelector(".qshell")) return false;
    if (which === "agent") return window.matchMedia("(max-width: 1180px)").matches;
    return window.matchMedia("(max-width: 860px)").matches;
  }
  function syncDrawerChrome() {
    var drawerAgent = isDrawer("agent") && settings.agentOpen;
    var drawerSide = isDrawer("sidebar") && settings.sidebarOpen;
    $("#scrim").hidden = !(drawerAgent || drawerSide);
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

  /* =========================== RESIZE HANDLES ========================== */
  function initResize(handleSel, getVal, setVal, axis, cssVar, min, max, storeKey) {
    var handle = $(handleSel);
    if (!handle) return;
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
        if (storeKey) { settings[storeKey] = getVal(); persist(); }
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  /* ============================== WIRING =============================== */
  function wire() {
    $("#titleSearchIcon").innerHTML = Icons.ui("search", 13);
    $("#toggleSidebarBtn").innerHTML = Icons.ui("panelLeft", 16);
    $("#togglePanelBtn").innerHTML = Icons.ui("panelBottom", 16);
    $("#toggleChatBtn").innerHTML = Icons.ui("panelRight", 16);
    $("#titleSearch").addEventListener("click", function () { openPalette("files", ""); });
    $("#providerSummary").addEventListener("click", function () { openSettings(null); });

    $$(".abtn[data-view]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-view");
        var titles = { explorer: "Explorer", search: "Search", scm: "Changes", debug: "Run and Debug", extensions: "Extensions", skills: "Knowledge Center" };
        if (window.Shell && !$("#qDrawer").hidden) {
          Shell.openView(v, titles[v] || "Panel");
          return;
        }
        if (v === state.view && settings.sidebarOpen) setSidebarOpen(false);
        else activateView(v);
        syncDrawerChrome();
      });
    });
    $("#abtnAgent").addEventListener("click", function () {
      if (window.Shell && !$("#qDrawer").hidden) {
        Shell.closeView();
        if (window.Agent) Agent.focusInput();
        return;
      }
      setAgentOpen(!settings.agentOpen);
      syncDrawerChrome();
    });
    $("#abtnSettings").addEventListener("click", function () { openSettings(null); });
    $("#abtnAccount").addEventListener("click", function () {
      if (window.Shell && Shell.about) Shell.about();
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
      b.addEventListener("click", function () { toast({ title: "Window controls", msg: "Browser tabs cannot minimise, maximise or close the desktop app.", type: "info", timeout: 3200 }); });
    });

    /* explorer */
    $("#openFolderBtn").addEventListener("click", openFolderFlow);
    $("#projectToggle").addEventListener("click", function () {
      var chev = $(".chev", this);
      if (!chev) return;
      var open = chev.classList.toggle("chev--open");
      $("#fileTree").style.display = open ? "" : "none";
    });
    toggleSection("#outlineToggle", "#outlineTree");
    toggleSection("#timelineToggle", "#timelineTree");
    $("#newFileBtn").addEventListener("click", function () { newFile(""); });
    $("#newFolderBtn").addEventListener("click", function () { newFolder(""); });
    $("#refreshBtn").addEventListener("click", rescanFlow);
    $("#collapseBtn").addEventListener("click", function () { state.expanded = {}; renderTree(); });
    $("#fileTree").addEventListener("contextmenu", function (e) {
      if (e.target.closest("[data-file]") || e.target.closest("[data-dir]")) return;
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, [
        { label: "Open Folder…", icon: "folderOpen", action: openFolderFlow },
        { label: "Open Files (read-only)…", action: openFilesFlow },
        { sep: true },
        { label: "New File…", icon: "newfile", action: function () { newFile(""); } },
        { label: "New Folder…", icon: "newfolder", disabled: !WS.loaded || WS.readonly, action: function () { newFolder(""); } },
        { label: "Rescan from Disk", icon: "refresh", disabled: !WS.loaded || !WS.hasHandle, action: rescanFlow },
        { sep: true },
        { label: "Close Folder", disabled: !WS.loaded, action: closeWorkspace }
      ]);
    });

    /* search */
    var searchTimer = null;
    $("#searchInput").addEventListener("input", function (e) {
      clearTimeout(searchTimer);
      var v = e.target.value;
      searchTimer = setTimeout(function () { runSearch(v); }, 140);
    });
    [["#searchCase"], ["#searchWord"], ["#searchRegex"]].forEach(function (pair) {
      $(pair[0]).addEventListener("click", function () {
        $(pair[0]).classList.toggle("is-on");
        runSearch($("#searchInput").value);
      });
    });

    /* scm */
    $("#scmRevertAllBtn").addEventListener("click", revertAll);

    /* welcome */
    $$(".wshort").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-action");
        if (a === "open") openFolderFlow();
        else if (a === "file") openPalette("files", "");
        else if (a === "terminal") { setPanelOpen(true); setPanelTab("terminal"); if (window.Terminal) Terminal.focus(); }
      });
    });
    $("#welcomeAgentCard").addEventListener("click", function () {
      if (window.Shell && Shell.editorOpen()) Shell.closeEditor();
      setAgentOpen(true);
      syncDrawerChrome();
      if (window.Agent) Agent.focusInput();
    });

    /* panel */
    $$(".ptab").forEach(function (t) {
      t.addEventListener("click", function () {
        var name = t.getAttribute("data-panel");
        if (!settings.panelOpen) setPanelOpen(true);
        setPanelTab(name);
      });
    });
    $("#panelCollapseBtn").addEventListener("click", function () { setPanelOpen(false); });
    $("#panelKillBtn").addEventListener("click", function () { if (window.Terminal) Terminal.kill(); });

    /* status bar */
    $("#sbWorkspace").addEventListener("click", function () {
      if (!WS.loaded) openFolderFlow();
      else activateView("explorer");
    });
    $("#sbChanges").addEventListener("click", function () { activateView("scm"); });
    $("#sbProblems").addEventListener("click", function () { setPanelOpen(true); setPanelTab("problems"); });
    $("#sbReadonly").addEventListener("click", function () {
      toast({ title: "Read-only workspace", msg: "Reopen the folder and grant write access to save directly to disk.", type: "warn", timeout: 5200 });
    });
    $("#sbIndent").addEventListener("click", function () { toast({ title: "Indentation", msg: "Spaces: 2 · Tab inserts two spaces", type: "info" }); });
    $("#sbEncoding").addEventListener("click", function () { toast({ title: "Encoding", msg: "UTF-8 · decoded by the browser's File API", type: "info" }); });
    $("#sbEol").addEventListener("click", function () {
      var tab = activeTab();
      var text = tab && tab.kind === "file" ? WS.content(tab.path) : "";
      var eol = text.indexOf("\r\n") >= 0 ? "CRLF" : "LF";
      toast({ title: "Line ending", msg: eol + " detected", type: "info" });
    });
    $("#sbLang").addEventListener("click", function () {
      var tab = activeTab();
      toast({ title: "Language mode", msg: tab ? langLabel(tab.path) + " · " + tab.path : "No file open", type: "info" });
    });
    $("#sbBell").addEventListener("click", function (e) { e.stopPropagation(); toggleNotif(); });
    document.addEventListener("click", function (e) {
      var pop = $("#notifPopover");
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest("#sbBell")) pop.hidden = true;
      hideCtxMenu();
    });

    /* palette */
    $("#paletteInput").addEventListener("input", function () { paletteState.sel = 0; renderPalette(); });
    $("#paletteInput").addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); paletteState.sel = Math.min(paletteState.sel + 1, paletteState.rows.length - 1); renderPalette(); scrollPaletteSel(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); paletteState.sel = Math.max(paletteState.sel - 1, 0); renderPalette(); scrollPaletteSel(); }
      else if (e.key === "Enter") { e.preventDefault(); acceptPalette(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePalette(); }
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
    $("#settingsOpenFolder").addEventListener("click", function () { closeSettings(); openFolderFlow(); });
    $("#settingsCloseFolder").addEventListener("click", function () { closeSettings(); closeWorkspace(); });
    $("#providersConfigureBtn").addEventListener("click", function () { openSettings(null); });
    $("#settingsClose").addEventListener("click", closeSettings);
    $("#settingsDone").addEventListener("click", closeSettings);
    $("#settingsOverlay").addEventListener("click", function (e) { if (e.target === this) closeSettings(); });

    /* dialog */
    $("#dialogOk").addEventListener("click", acceptDialog);
    $("#dialogCancel").addEventListener("click", function () { settleDialog(null); });
    $("#dialogClose").addEventListener("click", function () { settleDialog(null); });
    $("#dialogInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); acceptDialog(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); settleDialog(null); }
    });

    $("#scrim").addEventListener("click", closeDrawers);

    /* drag and drop */
    var dragDepth = 0;
    document.addEventListener("dragenter", function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") < 0) return;
      e.preventDefault();
      dragDepth++;
      $("#dropOverlay").hidden = false;
    });
    document.addEventListener("dragover", function (e) { if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.length) e.preventDefault(); });
    document.addEventListener("dragleave", function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $("#dropOverlay").hidden = true;
    });
    document.addEventListener("drop", async function (e) {
      e.preventDefault();
      dragDepth = 0;
      $("#dropOverlay").hidden = true;
      if (WS.loaded && WS.changes().length) {
        toast({ title: "Workspace has session edits", msg: "Save or revert them before dropping another folder.", type: "warn", timeout: 6000 });
        return;
      }
      try {
        var result = await WS.openDrop(e.dataTransfer);
        if (!result || result.cancelled) return;
        if (result.loaded) toast({ title: "Workspace opened", msg: result.name + (result.readonly ? " · read-only" : ""), type: "success" });
      } catch (err) {
        toast({ title: "Could not open dropped items", msg: err.message || String(err), type: "error" });
      }
    });

    /* scrolling + resize */
    window.addEventListener("resize", function () {
      syncDrawerChrome();
      updateMinimapViewport();
      var tab = activeTab();
      if (tab && tab.kind === "file") renderMinimap();
    });
    initResize("#sidebarResize", function () { return settings.sbW; }, function (v) { settings.sbW = v; }, "x", "--sb-w", 200, 460, "sbW");
    initResize("#agentResize", function () { return settings.agW; }, function (v) { settings.agW = v; }, "x", "--ag-w", 360, 900, "agW");
    initResize("#panelResize", function () { return settings.panelH; }, function (v) { settings.panelH = v; }, "y", "--panel-h", 120, 420, "panelH");

    document.addEventListener("keydown", onGlobalKeys);

    window.addEventListener("hugmoss:ws-loaded", function (e) { hydrateWorkspace(e.detail); });
    window.addEventListener("hugmoss:ws-restored", function (e) {
      renderWelcome();
      if (e.detail && e.detail.needsPermission) {
        logOutput("workspace", "previous folder \"" + e.detail.name + "\" needs permission to reopen", "out-warn");
        notify({ icon: "folder", title: "Previous folder available", body: e.detail.name + " · use Reopen on the welcome screen." });
      }
    });
    window.addEventListener("hugmoss:ws-progress", function (e) {
      var detail = e.detail || {};
      if (detail.phase === "start") {
        $("#fileTree").innerHTML = '<div class="tree-empty tree-empty--progress">' + Icons.ui("refresh", 20) +
          "<strong>Indexing " + HL.esc(detail.name || "folder") + "</strong><p>Reading text files. Large and binary files are skipped.</p></div>";
      } else if (detail.phase === "index") {
        var p = $(".tree-empty--progress p");
        if (p) p.textContent = "Found " + detail.found.toLocaleString() + " files" + (detail.skipped ? " · " + detail.skipped + " skipped" : "");
      } else if (detail.phase === "read") {
        var q = $(".tree-empty--progress p");
        if (q) q.textContent = "Reading " + detail.done.toLocaleString() + " of " + detail.total.toLocaleString() + " files";
      }
    });
    window.addEventListener("hugmoss:ws-changed", function (e) {
      var detail = e.detail || {};
      var path = detail.path;
      if (path && detail.action === "delete") {
        closeTabsFor(path);
        if (!activeTab()) showWelcomeLayer();
      }
      renderTree();
      renderScm();
      renderTimeline();
      updateWorkspaceChrome();
      updateTabDirty();
      if (path && state.active === path) {
        var tab = activeTab();
        if (tab && tab.kind === "diff") renderDiff(path);
        else if (tab) {
          var value = WS.content(path);
          if (inputLayer && inputLayer.value !== value) {
            var pos = inputLayer.selectionStart;
            setEditorText(value);
            inputLayer.selectionStart = inputLayer.selectionEnd = Math.min(pos, value.length);
            renderCode(path);
          } else if (tab) renderCode(path);
        }
      }
    });
    window.addEventListener("hugmoss:ws-saved", function () {
      updateTabDirty();
      renderScm();
      updateWorkspaceChrome();
    });
    window.addEventListener("beforeunload", function (e) {
      if (WS.loaded && WS.dirtyPaths().length) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  function onGlobalKeys(e) {
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key.toLowerCase();
    if (e.key === "Escape") {
      if (!$("#paletteOverlay").hidden) { closePalette(); return; }
      if (!$("#settingsOverlay").hidden) { closeSettings(); return; }
      if (!$("#dialogOverlay").hidden) { settleDialog(null); return; }
      if (!$("#ctxMenu").hidden) { hideCtxMenu(); return; }
      if (!$("#notifPopover").hidden) { $("#notifPopover").hidden = true; return; }
      if (openMenu) { hideMenu(); return; }
      if (document.querySelector(".pop")) { if (window.Agent && Agent.closePops) Agent.closePops(); return; }
      if (!$("#qMenu").hidden) {
        $("#qMenu").hidden = true;
        var moreBtn = $("#qBMore");
        if (moreBtn) moreBtn.setAttribute("aria-expanded", "false");
        return;
      }
      if (window.Shell && Shell.escape()) return;
      if ($("#app").classList.contains("has-drawer")) closeDrawers();
      return;
    }
    if (mod && e.shiftKey && key === "b") { e.preventDefault(); if (window.Shell) Shell.toggleBrowser(); return; }
    if (mod && !e.shiftKey && key === "b") { e.preventDefault(); if (window.Shell) Shell.toggleNav(); return; }
    if (mod && e.shiftKey && key === "p") { e.preventDefault(); openPalette("commands", ">"); return; }
    if (mod && key === "k") { e.preventDefault(); openPalette("files", ""); return; }
    if (mod && e.shiftKey && key === "f") { e.preventDefault(); if (window.Shell) Shell.openView("search", "Search"); else activateView("search"); return; }
    if (mod && e.shiftKey && key === "s") { e.preventDefault(); saveAll(); return; }
    if (mod && key === "s") { e.preventDefault(); saveActive(); return; }
    if (mod && key === "o") { e.preventDefault(); openFolderFlow(); return; }
    if (mod && !e.shiftKey && e.key === "`") {
      e.preventDefault();
      showPanelInEditor("terminal");
      if (window.Terminal) Terminal.focus();
      return;
    }
    if (e.altKey && !mod) {
      if (key === "b") { e.preventDefault(); if (window.Shell) Shell.toggleNav(); else { setSidebarOpen(!settings.sidebarOpen); syncDrawerChrome(); } return; }
      if (key === "a") { e.preventDefault(); if (window.Shell && window.Agent) { Agent.focusInput(); return; } setAgentOpen(!settings.agentOpen); syncDrawerChrome(); return; }
      if (key === "j") { e.preventDefault(); if (window.Shell && !Shell.editorOpen()) showPanelInEditor(settings.panelTab || "terminal"); else setPanelOpen(!settings.panelOpen); return; }
      if (key === "t") { e.preventDefault(); toggleTheme(); return; }
      if (key === "e") { e.preventDefault(); saveAll(); return; }
      if (key === "p") { e.preventDefault(); openPalette("files", ""); return; }
      if (key === "z") { e.preventDefault(); if (window.Shell) Shell.openView("scm", "Changes"); else activateView("scm"); return; }
    }
  }

  /* ================================ BOOT =============================== */
  function applyLayout() {
    document.documentElement.style.setProperty("--fs-code", settings.fontSize + "px");
    document.documentElement.style.setProperty("--sb-w", settings.sbW + "px");
    document.documentElement.style.setProperty("--ag-w", settings.agW + "px");
    document.documentElement.style.setProperty("--panel-h", settings.panelH + "px");
    applyTheme();
    ensureInputLayer();
    $("#codeWrap").classList.toggle("is-wrap", settings.wrap);
    inputLayer.classList.toggle("is-wrap", settings.wrap);
    $("#agentModeSelect").value = settings.agentMode;
    syncSettingsControls();
    setSidebarOpen(settings.sidebarOpen);
    setAgentOpen(settings.agentOpen);
    setPanelOpen(settings.panelOpen);
    setPanelTab(settings.panelTab || "terminal");
    syncDrawerChrome();
  }

  function boot() {
    Icons.mount(document);
    applyLayout();
    wire();
    renderProviders();
    renderTree();
    renderScm();
    renderTimeline();
    renderProblems();
    renderWelcome();
    renderTabs();
    renderOutline(null);
    showLayer("welcome");
    updateWorkspaceChrome();
    initMinimapDrag();

    if (window.Terminal) Terminal.init();
    if (window.Agent) Agent.init();

    if (!Providers.selection() && settings.model && Providers.get(settings.model.provider)) {
      Providers.setSelection(settings.model.provider, settings.model.model, settings.model.label);
      refreshAgentUI();
    }

    WS.restore().then(function (result) {
      if (result && result.needsPermission) {
        renderWelcome();
        logOutput("workspace", "last folder available — reopen to grant access", "out-info");
      } else if (result && result.loaded) {
        logOutput("workspace", "restored " + result.name + " · " + plural(result.visible, "file"), "out-ok");
      }
      updateWorkspaceChrome();
    }).catch(function (e) {
      logOutput("workspace", "could not restore the last folder: " + (e.message || e), "out-warn");
    });

    Providers.probeGateway().then(function (on) {
      updateGatewayNote();
      var active = document.activeElement;
      var editingKey = active && active.hasAttribute && active.hasAttribute("data-key") && active.value;
      if (!editingKey) renderProviders();
      renderProviderSummary();
      refreshAgentUI();
      logOutput(
        "hugmoss",
        on ? "ready · gateway connected · provider keys can come from the browser or the server" : "ready · direct mode · keys and files stay in this browser",
        "out-info"
      );
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { renderMinimap(); });
    }
    setTimeout(function () {
      var hosted = Providers.list().some(function (p) { return Providers.hosted(p.id); });
      toast({
        title: "HugMoss Code",
        msg: "Built by IRAGUHA Vincent · " + (hosted
          ? "open a folder, then pick a model to start."
          : "open a folder, then connect a provider in Settings to start the agent."),
        type: "agent",
        timeout: 7000
      });
    }, 800);
  }

  window.App = {
    toast: toast,
    notify: notify,
    logOutput: logOutput,
    openFile: openFile,
    openDiff: openDiff,
    openPalette: openPalette,
    runCommand: runCommand,
    activateView: activateView,
    setPanelOpen: setPanelOpen,
    setPanelTab: setPanelTab,
    setAgentOpen: setAgentOpen,
    setSidebarOpen: setSidebarOpen,
    saveActive: saveActive,
    saveAll: saveAll,
    openFolder: openFolderFlow,
    openFiles: openFilesFlow,
    openSettings: openSettings,
    closeSettingsUI: closeSettingsUI,
    showPanel: showPanelInEditor,
    downloadPath: downloadPath,
    treeRefresh: function () { renderTree(); renderScm(); renderTimeline(); },
    filesChanged: function (path) {
      renderTree();
      renderScm();
      renderTimeline();
      updateWorkspaceChrome();
      updateTabDirty();
      if (path && state.active === path) {
        var tab = activeTab();
        if (tab && tab.kind === "diff") renderDiff(path);
        else if (tab) {
          var value = WS.content(path);
          setEditorText(value);
          renderCode(path);
        }
      }
      if (window.Agent && Agent.refreshSuggestions) Agent.refreshSuggestions();
    },
    fileRemoved: function (path) {
      closeTabsFor(path);
      renderTree();
      renderScm();
      renderTimeline();
      updateWorkspaceChrome();
    },
    problemsAdd: function (p) { state.problems.push(p); renderProblems(); },
    problemsClear: function () { state.problems = []; renderProblems(); },
    rememberModel: function (sel) { settings.model = sel || null; persist(); },
    routing: function () { return { provider: Providers.selection(), workspace: WS.summary() }; },
    settings: settings,
    state: state,
    baseName: baseName,
    dirName: dirName,
    clock: clock
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
