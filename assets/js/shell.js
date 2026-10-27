/* shell.js — task navigation, session history, drawers and shell dialogs. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var shell = $("#qshell");
  if (!shell) return;

  var nav = $("#qNav");
  var browser = $("#qBrowser");
  var scrim = $("#qScrim");
  var drawer = $("#qDrawer");
  var drawerBody = $("#qDrawerBody");
  var infoOverlay = $("#qInfoOverlay");
  var tasksEl = $("#qTasks");
  var workspacesEl = $("#qWorkspaces");
  var searchWrap = $("#qNavSearchWrap");
  var searchInput = $("#qNavSearch");
  var backBtn = $("#qHistoryBack");
  var forwardBtn = $("#qHistoryForward");
  var editorOverlay = $("#qEditor");
  var editorHost = $("#qEditorHost");
  var editorTitle = $("#qEditorTitle");
  var editorCol = $("#editorCol");
  var editorHome = editorCol ? editorCol.parentNode : null;
  var editorNext = editorCol ? editorCol.nextSibling : null;

  var mqNav = window.matchMedia("(max-width: 900px)");
  var mqBrowser = window.matchMedia("(max-width: 1180px)");
  var activeId = null;
  var seq = [];
  var pos = -1;
  var currentView = "";
  var currentEditorPath = "";
  var pendingEditor = "";
  var skipHash = null;
  var routerReady = false;

  var VIEWS = {
    explorer: { name: "explorer", title: "Explorer" },
    search: { name: "search", title: "Search" },
    changes: { name: "scm", title: "Changes", nav: "changes" },
    knowledge: { name: "skills", title: "Knowledge Center" },
    extensions: { name: "extensions", title: "Extensions" },
    debug: { name: "debug", title: "Run and Debug" }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function sessions() {
    return (window.Agent && Agent.recentSessions) ? Agent.recentSessions() : [];
  }

  /* -------------------------------- router ------------------------------- */
  function parseHash() {
    var raw = String(location.hash || "").replace(/^#\/?/, "");
    var qi = raw.indexOf("?");
    var path = qi < 0 ? raw : raw.slice(0, qi);
    var query = {};
    if (qi >= 0) raw.slice(qi + 1).split("&").forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf("=");
      var key = eq < 0 ? pair : pair.slice(0, eq);
      var val = eq < 0 ? "" : pair.slice(eq + 1);
      try { query[decodeURIComponent(key)] = decodeURIComponent(val.replace(/\+/g, " ")); } catch (e) {}
    });
    return { path: path.replace(/\/+$/, "") || "task", query: query };
  }

  function hashFor(path) {
    return "#/" + String(path || "task").replace(/^#?\/?/, "");
  }

  function viewRoute(name) {
    for (var key in VIEWS) if (VIEWS[key].name === name) return key;
    return name;
  }

  function route(path, opts) {
    var next = hashFor(path);
    if (location.hash === next) return next;
    opts = opts || {};
    if (opts.replace && window.history && history.replaceState) {
      history.replaceState(null, "", next);
      return next;
    }
    skipHash = next;
    location.hash = next;
    return next;
  }

  function baseRoute() {
    if (editorOpen()) return "editor" + (currentEditorPath ? "?path=" + encodeURIComponent(currentEditorPath) : "");
    if (!drawer.hidden && currentView) return viewRoute(currentView);
    var id = window.Agent && Agent.currentId ? Agent.currentId() : null;
    return id ? "task/" + id : "task";
  }

  function closeSettingsUI() {
    if (window.App && App.closeSettingsUI) App.closeSettingsUI();
  }

  function applyRoute() {
    var r = parseHash();
    var path = r.path;

    if (path === "task" || path.indexOf("task/") === 0) {
      closeEditorUI();
      closeViewUI();
      closeInfoUI();
      closeSettingsUI();
      nav.classList.remove("is-open");
      browser.classList.remove("is-open");
      updateScrim();
      if (path.indexOf("task/") === 0) {
        var id = path.slice(5);
        var match = sessions().filter(function (s) { return s.id === id; })[0];
        if (match) {
          activeId = match.id;
          if (window.Agent) Agent.openSession(match);
          pushHistory(match.id);
        } else {
          if (window.App) App.toast({ title: "Task not found", msg: "That session is not saved in this browser.", type: "info" });
          route("task", { replace: true });
        }
      }
      renderTasks();
      return;
    }

    if (path === "editor") {
      closeViewUI();
      closeInfoUI();
      closeSettingsUI();
      nav.classList.remove("is-open");
      browser.classList.remove("is-open");
      updateScrim();
      var file = r.query.path || "";
      if (file) {
        if (window.WS && WS.loaded && window.App) {
          App.openFile(file, { focus: true });
          if (!editorOpen()) showEditorUI(file);
        } else {
          pendingEditor = file;
          showEditorUI(file);
        }
      } else {
        showEditorUI(null);
      }
      return;
    }

    if (path === "terminal") {
      closeViewUI();
      closeInfoUI();
      closeSettingsUI();
      if (window.App && App.showPanel) App.showPanel("terminal");
      else showEditorUI(null);
      return;
    }

    if (path === "browser") {
      closeViewUI();
      closeInfoUI();
      closeSettingsUI();
      setBrowserOpen(true);
      if (r.query.url && window.BrowserPane) BrowserPane.goto(r.query.url);
      return;
    }

    if (VIEWS[path]) {
      closeInfoUI();
      closeSettingsUI();
      openViewUI(VIEWS[path].name, VIEWS[path].title);
      return;
    }

    if (path === "settings") {
      closeViewUI();
      closeInfoUI();
      if (window.App) App.openSettings(null);
      return;
    }

    if (path === "help") { helpInfo(); return; }
    if (path === "about") { aboutInfo(); return; }
    if (path === "automations") { automationsInfo(); return; }

    route("task", { replace: true });
  }

  function onHashChange() {
    var h = location.hash;
    if (skipHash === h) { skipHash = null; return; }
    skipHash = null;
    if (routerReady) applyRoute();
  }

  /* ------------------------------- sessions ------------------------------ */
  function renderTasks() {
    var label = $("#agentSessionName") ? $("#agentSessionName").textContent.trim() : "";
    var list = sessions();
    if (label && label !== "New session") {
      for (var i = 0; i < list.length; i++) {
        if (list[i].title === label) { activeId = list[i].id; break; }
      }
    }
    var query = (searchInput.value || "").trim().toLowerCase();
    var shown = query ? list.filter(function (s) {
      return String(s.title || "").toLowerCase().indexOf(query) >= 0;
    }) : list;
    tasksEl.innerHTML = "";
    if (!shown.length) {
      tasksEl.innerHTML = '<div class="qnav__empty">' + (query
        ? "No task matches that filter."
        : "Finished tasks are saved in this browser.") + "</div>";
      return;
    }
    shown.forEach(function (s) {
      var b = document.createElement("button");
      b.className = "qnav__task" + (s.id === activeId ? " is-active" : "");
      b.textContent = s.title || "Untitled task";
      b.title = s.title || "";
      b.addEventListener("click", function () {
        if (!window.Agent) return;
        activeId = s.id;
        Agent.openSession(s);
        pushHistory(s.id);
        renderTasks();
        closeMobileNav();
        route("task/" + s.id);
      });
      tasksEl.appendChild(b);
    });
  }

  function pushHistory(id) {
    if (seq[pos] === id) return;
    seq = seq.slice(0, pos + 1);
    seq.push(id);
    pos = seq.length - 1;
    syncHistory();
  }

  function syncHistory() {
    backBtn.disabled = pos <= 0;
    forwardBtn.disabled = pos < 0 || pos >= seq.length - 1;
  }

  function stepHistory(delta) {
    var next = pos + delta;
    if (next < 0 || next >= seq.length) return;
    var id = seq[next];
    var match = sessions().filter(function (s) { return s.id === id; })[0];
    if (!match) { pos = next; syncHistory(); return; }
    pos = next;
    activeId = id;
    if (window.Agent) Agent.openSession(match);
    renderTasks();
    syncHistory();
    route("task/" + id);
  }

  function newTask() {
    closeEditorUI();
    closeViewUI();
    closeInfoUI();
    closeSettingsUI();
    if (window.Agent) {
      Agent.newSession();
      Agent.focusInput();
    }
    activeId = null;
    seq = [];
    pos = -1;
    syncHistory();
    renderTasks();
    closeMobileNav();
    route("task");
  }

  function renderWorkspaces() {
    var w = (window.WS && WS.summary) ? WS.summary() : { loaded: false };
    workspacesEl.innerHTML = "";
    var b = document.createElement("button");
    b.className = "qnav__row qnav__ws";
    b.innerHTML = Icons.ui("folder", 16) + "<span>" + esc(w.loaded ? w.name : "Open a folder") + "</span>";
    b.title = w.loaded ? (w.readonly ? "Read-only folder" : w.count + " files") : "Give the agent files to read and write";
    b.addEventListener("click", function () { App.openFolder(); });
    workspacesEl.appendChild(b);
  }

  /* ------------------------------- layout -------------------------------- */
  function navOpen() { return mqNav.matches ? nav.classList.contains("is-open") : !shell.classList.contains("qshell--nav-hidden"); }

  function toggleNav() {
    if (editorOpen()) closeEditor();
    if (mqNav.matches) {
      var open = !nav.classList.contains("is-open");
      nav.classList.toggle("is-open", open);
      if (open && mqBrowser.matches) browser.classList.remove("is-open");
    } else {
      shell.classList.toggle("qshell--nav-hidden");
    }
    updateScrim();
  }

  function closeMobileNav() {
    if (!nav.classList.contains("is-open")) return;
    nav.classList.remove("is-open");
    updateScrim();
  }

  function browserOpen() {
    return mqBrowser.matches
      ? browser.classList.contains("is-open")
      : !shell.classList.contains("qshell--no-browser");
  }

  function setBrowserOpen(open) {
    if (open) {
      if (editorOpen()) closeEditorUI();
      shell.classList.remove("qshell--no-browser");
      if (mqBrowser.matches) {
        browser.classList.add("is-open");
        nav.classList.remove("is-open");
      }
    } else {
      browser.classList.remove("is-open");
      browser.classList.remove("is-expanded");
      $("#qBExpand").setAttribute("aria-pressed", "false");
      if (!mqBrowser.matches) shell.classList.add("qshell--no-browser");
      else shell.classList.remove("qshell--no-browser");
      if (parseHash().path === "browser") route(baseRoute(), { replace: true });
    }
    updateScrim();
  }

  function toggleBrowser() {
    setBrowserOpen(!browserOpen());
    if (browserOpen()) {
      route("browser");
      if (window.BrowserPane && !mqBrowser.matches) BrowserPane.focus();
    }
  }

  function updateScrim() {
    var open = nav.classList.contains("is-open") ||
      browser.classList.contains("is-open") ||
      !drawer.hidden;
    scrim.hidden = !open;
  }

  /* -------------------------------- editor ------------------------------- */
  function editorOpen() { return editorOverlay && !editorOverlay.hidden; }

  function syncEditorTitle() {
    var tab = document.querySelector("#tabstrip .tab--active .tab__name");
    if (tab) editorTitle.textContent = tab.textContent.replace(/\s*·\s*changes$/, "");
  }

  function showEditorUI(path) {
    if (!editorCol || !editorOverlay) return;
    currentEditorPath = String(path || "");
    if (editorOverlay.hidden) editorHost.appendChild(editorCol);
    editorTitle.textContent = String(path || "").split("/").pop() || "Editor";
    editorOverlay.hidden = false;
    closeViewUI();
    nav.classList.remove("is-open");
    updateScrim();
    setTimeout(syncEditorTitle, 0);
  }

  function showEditor(path, opts) {
    showEditorUI(path);
    if (!(opts && opts.silent)) route("editor" + (path ? "?path=" + encodeURIComponent(path) : ""));
  }

  function closeEditorUI() {
    if (!editorOpen()) return;
    pendingEditor = "";
    editorOverlay.hidden = true;
    if (editorHome) editorHome.insertBefore(editorCol, editorNext);
  }

  function closeEditor(opts) {
    if (!editorOpen()) return;
    closeEditorUI();
    if (!(opts && opts.silent)) route(baseRoute(), { replace: true });
  }

  /* -------------------------------- drawer ------------------------------- */
  function openViewUI(name, title) {
    closeEditorUI();
    drawerBody.appendChild($("#sidebar"));
    $("#qDrawerTitle").textContent = title || "Panel";
    drawer.hidden = false;
    nav.classList.remove("is-open");
    browser.classList.remove("is-open");
    currentView = name;
    if (window.App) App.activateView(name);
    updateScrim();
  }

  function openView(name, title) {
    openViewUI(name, title);
    route(viewRoute(name));
  }

  function closeViewUI() {
    if (drawer.hidden) return;
    $("#legacySidebarHost").appendChild($("#sidebar"));
    drawer.hidden = true;
    currentView = "";
    updateScrim();
  }

  function closeView() {
    if (drawer.hidden) return;
    closeViewUI();
    route(baseRoute(), { replace: true });
  }

  /* -------------------------------- info --------------------------------- */
  function showInfo(title, html) {
    $("#qInfoTitle").textContent = title;
    $("#qInfoBody").innerHTML = html;
    infoOverlay.hidden = false;
    $("#qInfoOk").focus();
  }

  function closeInfoUI() { infoOverlay.hidden = true; }

  function closeInfo() {
    if (infoOverlay.hidden) return;
    closeInfoUI();
    route(baseRoute(), { replace: true });
  }

  function helpInfo() {
    showInfo("Keyboard shortcuts", [
      "<p>HugMoss Code runs entirely in this tab. These are the shortcuts that matter here.</p>",
      "<dl>",
      "<dt><kbd>Ctrl K</kbd></dt><dd>Go to file</dd>",
      "<dt><kbd>Ctrl Shift P</kbd></dt><dd>Command palette</dd>",
      "<dt><kbd>Ctrl Shift F</kbd></dt><dd>Find in files</dd>",
      "<dt><kbd>Ctrl B</kbd></dt><dd>Toggle task navigation</dd>",
      "<dt><kbd>Ctrl Shift B</kbd></dt><dd>Toggle the browser pane</dd>",
      "<dt><kbd>Ctrl L</kbd></dt><dd>Focus the browser address</dd>",
      "<dt><kbd>Alt T</kbd></dt><dd>Toggle the theme</dd>",
      "<dt><kbd>Enter</kbd></dt><dd>Send a message to the agent</dd>",
      "<dt><kbd>Esc</kbd></dt><dd>Dismiss the topmost panel</dd>",
      "</dl>"
    ].join(""));
    route("help");
  }

  function aboutInfo() {
    showInfo("HugMoss Code", [
      "<p>An agentic coding workspace that runs in your browser, built by IRAGUHA Vincent.</p>",
      "<p>Files come from a folder you open. Model requests go straight from this tab to the provider you choose, and keys stay in this browser.</p>",
      "<p>Tasks, session history and the browser preview live in this tab. Nothing is uploaded anywhere by the app itself.</p>"
    ].join(""));
    route("about");
  }

  function automationsInfo() {
    showInfo("Automations", [
      "<p>Scheduled automations belong to the Qoder desktop app, where a process can run while the window is closed.</p>",
      "<p>This browser build has no scheduler: the agent works while this tab is open, and finished tasks stay under <b>Recent tasks</b> in this browser.</p>"
    ].join(""));
    route("automations");
  }

  /* -------------------------------- export ------------------------------- */
  function exportSession() {
    var text = (window.Agent && Agent.exportMarkdown) ? Agent.exportMarkdown() : "";
    if (!text) {
      App.toast({ title: "Nothing to export yet", msg: "Send a message to the agent, then export the session.", type: "info" });
      return;
    }
    var title = $("#agentSessionName").textContent.trim() || "hugmoss-session";
    var name = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "hugmoss-session";
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name + ".md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    App.toast({ title: "Session exported", msg: name + ".md", type: "success" });
  }

  /* ------------------------------ window chrome -------------------------- */
  function toggleFocusMode() {
    if (editorOpen()) closeEditorUI();
    var on = shell.classList.toggle("qshell--focus");
    if (window.App) App.toast({
      title: on ? "Focus mode on" : "Focus mode off",
      msg: on ? "Navigation and the browser are hidden. Press Esc to restore them." : "Navigation and the browser are back.",
      type: "info"
    });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
      return;
    }
    var root = document.documentElement;
    if (!root.requestFullscreen) {
      if (window.App) App.toast({ title: "Fullscreen unavailable", msg: "This browser does not expose the fullscreen API.", type: "info" });
      return;
    }
    root.requestFullscreen().catch(function () {
      if (window.App) App.toast({ title: "Fullscreen blocked", msg: "Allow fullscreen for this site, then try again.", type: "info" });
    });
  }

  function closeWindowInfo() {
    showInfo("Close this window", [
      "<p>HugMoss runs inside a browser tab, so a page cannot close itself.</p>",
      "<p>Press <kbd>Ctrl</kbd> <kbd>W</kbd> (<kbd>Cmd</kbd> <kbd>W</kbd> on macOS) to close the tab. Your tasks stay saved in this browser.</p>"
    ].join(""));
  }

  /* -------------------------------- wiring ------------------------------- */
  function wire() {
    $("#qNavToggle").addEventListener("click", toggleNav);
    backBtn.addEventListener("click", function () { stepHistory(-1); });
    forwardBtn.addEventListener("click", function () { stepHistory(1); });
    $("#qNavCoding").addEventListener("click", function () {
      closeEditorUI();
      closeViewUI();
      closeInfoUI();
      closeSettingsUI();
      route(baseRoute());
      if (window.Agent) Agent.focusInput();
      closeMobileNav();
    });
    $("#qNavSpec").addEventListener("click", newTask);
    $("#qNewTask").addEventListener("click", newTask);
    $("#qNewWorkspace").addEventListener("click", function () { App.openFolder(); });

    $("#qSearch").addEventListener("click", function () {
      var show = searchWrap.hidden;
      searchWrap.hidden = !show;
      if (show) { searchInput.focus(); searchInput.select(); }
      else { searchInput.value = ""; renderTasks(); }
    });
    searchInput.addEventListener("input", renderTasks);
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        searchInput.value = "";
        searchWrap.hidden = true;
        renderTasks();
      }
    });
    $("#qNavSearchClose").addEventListener("click", function () {
      searchInput.value = "";
      searchWrap.hidden = true;
      renderTasks();
    });

    $("#qKnowledge").addEventListener("click", function () { openView("skills", "Knowledge Center"); });
    $("#qExtensions").addEventListener("click", function () { openView("extensions", "Extensions"); });
    $("#qSites").addEventListener("click", function () {
      setBrowserOpen(true);
      if (window.BrowserPane) {
        BrowserPane.focus();
        if (BrowserPane.syncRoute) BrowserPane.syncRoute();
        else route("browser");
      } else route("browser");
      closeMobileNav();
    });
    $("#qAutomations").addEventListener("click", automationsInfo);
    $("#qUser").addEventListener("click", aboutInfo);
    $("#qHelp").addEventListener("click", helpInfo);
    $("#qExport").addEventListener("click", exportSession);
    $("#qSettings").addEventListener("click", function () { App.openSettings(null); });

    $("#qDrawerClose").addEventListener("click", closeView);
    $("#qInfoClose").addEventListener("click", closeInfo);
    $("#qInfoOk").addEventListener("click", closeInfo);
    infoOverlay.addEventListener("click", function (e) { if (e.target === infoOverlay) closeInfo(); });

    scrim.addEventListener("click", function () {
      nav.classList.remove("is-open");
      browser.classList.remove("is-open");
      closeView();
      updateScrim();
    });

    $("#qEditorBack").addEventListener("click", closeEditor);
    $("#qEditorClose").addEventListener("click", closeEditor);
    $("#tabstrip").addEventListener("click", function () { setTimeout(syncEditorTitle, 0); });
    $("#qWinMin").addEventListener("click", toggleFocusMode);
    $("#qWinMax").addEventListener("click", toggleFullscreen);
    $("#qWinClose").addEventListener("click", closeWindowInfo);
    $("#qBrowserTab").addEventListener("click", function () {
      if (window.BrowserPane) BrowserPane.focus();
    });

    var mo = new MutationObserver(function () { renderTasks(); });
    var nameEl = $("#agentSessionName");
    if (nameEl) mo.observe(nameEl, { childList: true, characterData: true, subtree: true });

    var wsm = new MutationObserver(function () {
      renderWorkspaces();
      if (pendingEditor && window.WS && WS.loaded && window.App) {
        var path = pendingEditor;
        pendingEditor = "";
        App.openFile(path);
        if (!editorOpen()) showEditorUI(path);
      }
    });
    var wsEl = $("#sbWorkspaceName");
    if (wsEl) wsm.observe(wsEl, { childList: true, characterData: true, subtree: true });

    window.addEventListener("resize", function () {
      if (!mqNav.matches) nav.classList.remove("is-open");
      else shell.classList.remove("qshell--nav-hidden");
      if (!mqBrowser.matches) browser.classList.remove("is-open");
      updateScrim();
    });
  }

  function init() {
    renderTasks();
    renderWorkspaces();
    syncHistory();
    wire();
    window.addEventListener("hashchange", onHashChange);
    if (!location.hash || location.hash === "#" || location.hash === "#/") {
      if (window.history && history.replaceState) history.replaceState(null, "", "#/task");
    }
    routerReady = true;
    applyRoute();
  }

  window.Shell = {
    toggleNav: toggleNav,
    toggleBrowser: toggleBrowser,
    browserOpen: browserOpen,
    setBrowserOpen: setBrowserOpen,
    openView: openView,
    closeView: closeView,
    showEditor: showEditor,
    closeEditor: closeEditor,
    editorOpen: editorOpen,
    info: showInfo,
    about: aboutInfo,
    route: route,
    baseRoute: baseRoute,
    modalClosed: function () { route(baseRoute(), { replace: true }); },
    sessionChanged: function (id) {
      if (!id) return;
      var r = parseHash();
      if (r.path === "task" || r.path.indexOf("task/") === 0) route("task/" + id, { replace: true });
    },
    escape: function () {
      if (!infoOverlay.hidden) { closeInfo(); return true; }
      if (!drawer.hidden) { closeView(); return true; }
      if (editorOpen()) {
        if (document.querySelector(".pop.head-pop, .pop")) return false;
        closeEditor();
        return true;
      }
      if (browser.classList.contains("is-expanded")) {
        browser.classList.remove("is-expanded");
        $("#qBExpand").setAttribute("aria-pressed", "false");
        return true;
      }
      if (mqBrowser.matches && browser.classList.contains("is-open")) { setBrowserOpen(false); return true; }
      if (nav.classList.contains("is-open")) { nav.classList.remove("is-open"); updateScrim(); return true; }
      if (searchWrap && !searchWrap.hidden) {
        searchInput.value = "";
        searchWrap.hidden = true;
        renderTasks();
        return true;
      }
      if (shell.classList.contains("qshell--focus")) {
        shell.classList.remove("qshell--focus");
        return true;
      }
      return false;
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
