/* browser.js — preview pane: address bar, history, mobile view, actions. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var frame = $("#qFrame");
  if (!frame) return;

  var shell = $("#qshell");
  var pane = $("#qBrowser");
  var urlInput = $("#qUrl");
  var startLayer = $("#qStart");
  var pageTab = $("#qPageTab");
  var pageTitle = $("#qPageTitle");
  var view = $("#qBrowserView");
  var menu = $("#qMenu");
  var backBtn = $("#qBBack");
  var forwardBtn = $("#qBForward");
  var reloadBtn = $("#qBReload");
  var copyBtn = $("#qBCopy");
  var openBtn = $("#qBOpen");
  var deviceBtn = $("#qBDevice");
  var expandBtn = $("#qBExpand");
  var splitBtn = $("#qBSplit");
  var moreBtn = $("#qBMore");

  var home = /^https?:$/.test(location.protocol) ? location.origin + "/" : "";
  var history = [];
  var cursor = -1;
  var current = "";

  var appCard = $("#qStartAppHost");
  if (appCard) appCard.textContent = home ? location.host : "Serve the app over http to preview it";

  function toast(title, msg, type) {
    if (window.App) App.toast({ title: title, msg: msg, type: type || "info" });
  }

  function normalize(raw) {
    var v = String(raw || "").trim();
    if (!v) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(v)) return "http://" + v;
    if (/^[\w-]+(\.[\w-]+)+(\/|:\d+|$)/.test(v)) return "https://" + v;
    return "";
  }

  function labelFor(url) {
    if (!url) return "New tab";
    if (home && url === home) return "HugMoss Code";
    try {
      var u = new URL(url);
      var path = u.pathname && u.pathname !== "/" ? u.pathname : "";
      return (u.hostname + path).slice(0, 64);
    } catch (e) { return url; }
  }

  function sync() {
    backBtn.disabled = cursor <= 0;
    forwardBtn.disabled = cursor < 0 || cursor >= history.length - 1;
    reloadBtn.disabled = !current;
    copyBtn.disabled = !current;
    openBtn.disabled = !current;
  }

  function reflect() {
    if (!window.history || !window.history.replaceState) return;
    var next = current ? "#/browser?url=" + encodeURIComponent(current) : "#/browser";
    if (location.hash !== next) window.history.replaceState(null, "", next);
  }

  function load(raw, opts) {
    opts = opts || {};
    var url = normalize(raw);
    if (!url) {
      toast("Enter a full address", "For example https://example.com or http://127.0.0.1:3022/", "info");
      urlInput.focus();
      return;
    }
    current = url;
    startLayer.hidden = true;
    frame.style.visibility = "";
    pageTab.hidden = false;
    pageTitle.textContent = labelFor(url);
    urlInput.value = url;
    frame.src = url;
    if (opts.push !== false) {
      history = history.slice(0, cursor + 1);
      if (history[history.length - 1] !== url) history.push(url);
      cursor = history.length - 1;
    }
    sync();
    reflect();
  }

  function showStart(focusInput) {
    current = "";
    history = [];
    cursor = -1;
    frame.src = "about:blank";
    frame.style.visibility = "hidden";
    urlInput.value = "";
    pageTab.hidden = true;
    startLayer.hidden = false;
    view.classList.remove("is-device");
    deviceBtn.setAttribute("aria-pressed", "false");
    sync();
    reflect();
    if (focusInput) urlInput.focus();
  }

  function reload() {
    if (!current) return;
    try { frame.contentWindow.location.reload(); }
    catch (e) { var url = current; frame.src = "about:blank"; setTimeout(function () { frame.src = url; }, 40); }
  }

  function copyAddress() {
    if (!current) return;
    var done = function () { toast("Address copied", current, "success"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(current).then(done, fallback);
    } else fallback();
    function fallback() {
      var area = document.createElement("textarea");
      area.value = current;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); done(); }
      catch (e) { toast("Could not copy the address", current, "error"); }
      area.remove();
    }
  }

  function openExternal() {
    if (!current) return;
    window.open(current, "_blank", "noopener,noreferrer");
  }

  function toggleDevice() {
    var on = view.classList.toggle("is-device");
    deviceBtn.setAttribute("aria-pressed", String(on));
    toast(on ? "Mobile preview" : "Full width preview", null, "info");
  }

  function toggleExpanded() {
    var on = pane.classList.toggle("is-expanded");
    expandBtn.setAttribute("aria-pressed", String(on));
  }

  function toggleWide() {
    if (window.matchMedia("(max-width: 1180px)").matches) {
      if (window.Shell) Shell.setBrowserOpen(true);
      return;
    }
    var on = shell.classList.toggle("qshell--browser-wide");
    splitBtn.setAttribute("aria-pressed", String(on));
  }

  function startPage() { showStart(true); }

  var menuItems = [
    { icon: "external", label: "Open in a new tab", act: openExternal, needsUrl: true },
    { icon: "link", label: "Copy address", act: copyAddress, needsUrl: true },
    { icon: "refresh", label: "Reload", act: reload, needsUrl: true },
    { icon: "globe", label: "Start page", act: startPage }
  ];

  function closeMenu() { menu.hidden = true; moreBtn.setAttribute("aria-expanded", "false"); }

  function openMenu() {
    menu.innerHTML = menuItems.map(function (item) {
      return '<button class="qmenu__item"' + (item.needsUrl && !current ? " disabled" : "") + ">" +
        Icons.ui(item.icon, 14) + "<span>" + item.label + "</span></button>";
    }).join("");
    menu.hidden = false;
    moreBtn.setAttribute("aria-expanded", "true");
    var r = moreBtn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top = (r.bottom + 6) + "px";
    Array.prototype.forEach.call(menu.querySelectorAll(".qmenu__item"), function (btn, i) {
      btn.addEventListener("click", function () {
        closeMenu();
        menuItems[i].act();
      });
    });
  }

  function init() {
    $("#qUrlForm").addEventListener("submit", function (e) {
      e.preventDefault();
      load(urlInput.value);
    });
    $("#qStartForm").addEventListener("submit", function (e) {
      e.preventDefault();
      load($("#qStartUrl").value);
    });
    $("#qStartApp").addEventListener("click", function () {
      if (!home) { toast("No http address", "Open HugMoss from its server (npm start) to preview it here.", "info"); return; }
      load(home);
    });
    $("#qStartRepo").addEventListener("click", function () {
      window.open("https://github.com/senid-221/HugMoss-Code", "_blank", "noopener,noreferrer");
    });

    backBtn.addEventListener("click", function () {
      if (cursor <= 0) return;
      cursor--;
      load(history[cursor], { push: false });
    });
    forwardBtn.addEventListener("click", function () {
      if (cursor >= history.length - 1) return;
      cursor++;
      load(history[cursor], { push: false });
    });
    reloadBtn.addEventListener("click", reload);
    copyBtn.addEventListener("click", copyAddress);
    openBtn.addEventListener("click", openExternal);
    deviceBtn.addEventListener("click", toggleDevice);
    expandBtn.addEventListener("click", toggleExpanded);
    splitBtn.addEventListener("click", toggleWide);
    $("#qBPanel").addEventListener("click", function () {
      if (window.Shell) Shell.setBrowserOpen(false);
      else pane.classList.remove("is-open");
    });
    $("#qBNewTab").addEventListener("click", function () { showStart(true); });
    moreBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) openMenu(); else closeMenu();
    });
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !e.target.closest("#qMenu") && !e.target.closest("#qBMore")) closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!menu.hidden) { closeMenu(); return; }
        if (pane.classList.contains("is-expanded")) { toggleExpanded(); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l" && document.activeElement !== urlInput) {
        e.preventDefault();
        urlInput.focus();
        urlInput.select();
      }
    });
  }

  window.BrowserPane = {
    goto: load,
    home: showStart,
    focus: function () { urlInput.focus(); urlInput.select(); },
    current: function () { return current; },
    syncRoute: reflect
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
