/* icons.js — inline SVG icon set (no external icon CDN). */
(function () {
  "use strict";

  function svg(size, inner, vb) {
    vb = vb || "0 0 24 24";
    return '<svg width="' + size + '" height="' + size + '" viewBox="' + vb + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
  }
  function svgBold(size, inner) {
    return svg(size, inner).replace('stroke-width="1.7"', 'stroke-width="2.1"');
  }
  function p(d, extra) { return '<path d="' + d + '"' + (extra || "") + "/>"; }

  var strokeIcons = {
    files: function (s) { return svg(s, p("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z") + p("M14 3v5h5") + p("M9 13h6M9 17h4")); },
    search: function (s) { return svg(s, '<circle cx="11" cy="11" r="6.5"/>' + p("M16 16l4.5 4.5")); },
    git: function (s) { return svg(s, '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/>' + p("M6 8.2v7.6") + p("M18 10.2c0 4-4.5 3.3-8 5.3")); },
    debug: function (s) { return svg(s, '<rect x="8" y="7" width="8" height="10" rx="4"/>' + p("M12 7V5M9 5.5 8 4M15 5.5 16 4") + p("M8 11H5M8 14H4.5M16 11h3M16 14h3.5") + p("M10 17l-1.5 2.5M14 17l1.5 2.5") + '<circle cx="10.5" cy="11.5" r=".4" fill="currentColor"/><circle cx="13.5" cy="11.5" r=".4" fill="currentColor"/>'); },
    extensions: function (s) { return svg(s, '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 13.5v7M13.5 17h7"/>'); },
    skills: function (s) { return svg(s, p("M2.8 9.4L12 4.6l9.2 4.8L12 14.2z") + p("M6.6 11.4v4.3c0 1.4 2.4 2.5 5.4 2.5s5.4-1.1 5.4-2.5v-4.3") + p("M21.2 9.4v5.2")); },
    copy: function (s) { return svg(s, '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/>' + p("M15.5 8.5v-3a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5v8.5a1.5 1.5 0 0 0 1.5 1.5h3")); },
    external: function (s) { return svg(s, p("M14 4.5h5.5V10") + p("M19.5 4.5l-7.8 7.8") + p("M18 13.5v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h4")); },
    sparkle: function (s) { return svg(s, p("M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z") + p("M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z")); },
    gear: function (s) { return svg(s, '<circle cx="12" cy="12" r="3"/>' + p("M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.09a1.6 1.6 0 0 0-1-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.09a1.6 1.6 0 0 0 1.47-1 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32h.01a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.09a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77v.01a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.09a1.6 1.6 0 0 0-1.47 1z")); },
    chevron: function (s) { return svg(s, p("M9.5 6l6 6-6 6")); },
    chevronDown: function (s) { return svg(s, p("M6 9.5l6 6 6-6")); },
    chevronLeft: function (s) { return svg(s, p("M14.5 6l-6 6 6 6")); },
    newfile: function (s) { return svg(s, p("M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z") + p("M13.5 3v5.5H19") + p("M12 12v5M9.5 14.5h5")); },
    newfolder: function (s) { return svg(s, p("M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z") + p("M11.5 13.5h4M13.5 11.5v4")); },
    refresh: function (s) { return svg(s, p("M20 12a8 8 0 1 1-2.34-5.66") + p("M20 4v4.5h-4.5")); },
    sync: function (s) { return svg(s, p("M4 12a8 8 0 0 1 13.6-5.7M20 12a8 8 0 0 1-13.6 5.7") + p("M17.5 3v3.5H14") + p("M6.5 21v-3.5H10")); },
    collapse: function (s) { return svg(s, '<rect x="4" y="4" width="16" height="16" rx="2"/>' + p("M9 12h6")); },
    close: function (s) { return svg(s, p("M6.5 6.5l11 11M17.5 6.5l-11 11")); },
    split: function (s) { return svg(s, '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>' + p("M12 4.5v15")); },
    trash: function (s) { return svg(s, p("M4 7h16") + p("M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2") + p("M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7") + p("M10 11v6M14 11v6")); },
    plus: function (s) { return svg(s, p("M12 5v14M5 12h14")); },
    play: function (s) { return svg(s, p("M8 5.5v13l10.5-6.5z")); },
    check: function (s) { return svg(s, p("M5 12.5l4.5 4.5L19 7.5")); },
    stop: function (s) { return svg(s, '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>'); },
    send: function (s) { return svgBold(s, p("M12 19V6") + p("M6.5 11.5L12 6l5.5 5.5")); },
    arrowDown: function (s) { return svg(s, p("M12 5v14M6.5 13.5L12 19l5.5-5.5")); },
    download: function (s) { return svg(s, p("M12 3.5v11") + p("M7.5 10.5L12 15l4.5-4.5") + p("M4.5 19.5h15")); },
    history: function (s) { return svg(s, p("M4 12a8 8 0 1 0 2.6-5.9") + p("M4 4v4.5h4.5") + p("M12 8v4.2l3 1.8")); },
    sun: function (s) { return svg(s, '<circle cx="12" cy="12" r="4"/>' + p("M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8")); },
    moon: function (s) { return svg(s, p("M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5z")); },
    bell: function (s) { return svg(s, p("M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10z") + p("M10 19a2 2 0 0 0 4 0")); },
    errorCircle: function (s) { return svg(s, '<circle cx="12" cy="12" r="8.5"/>' + p("M9.5 9.5l5 5M14.5 9.5l-5 5")); },
    warning: function (s) { return svg(s, p("M12 4.5L21 19.5H3z") + p("M12 10v4") + '<circle cx="12" cy="16.8" r=".5" fill="currentColor"/>'); },
    infoCircle: function (s) { return svg(s, '<circle cx="12" cy="12" r="8.5"/>' + p("M12 11v5") + '<circle cx="12" cy="8" r=".6" fill="currentColor"/>'); },
    branch: function (s) { return svg(s, '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="7.5" r="2"/>' + p("M6 7.5v9") + p("M18 9.5c0 4.5-6 3.5-9.5 6")); },
    pencil: function (s) { return svg(s, p("M15 5.5l3.5 3.5L8 19.5l-4.5 1 1-4.5z") + p("M13 7.5l3.5 3.5")); },
    paperclip: function (s) { return svg(s, p("M20 11.5l-7.8 7.8a4.8 4.8 0 0 1-6.8-6.8l8-8a3.2 3.2 0 0 1 4.5 4.5l-8 8a1.6 1.6 0 0 1-2.3-2.3l7.3-7.3")); },
    monitor: function (s) { return svg(s, '<rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/>' + p("M9 20h6M12 16v4")); },
    target: function (s) { return svg(s, '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2"/>'); },
    mic: function (s) { return svg(s, '<rect x="9" y="3" width="6" height="10.5" rx="3"/>' + p("M5.5 11.5a6.5 6.5 0 0 0 13 0") + p("M12 18v3")); },
    more: function (s) { return svg(s, '<circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>'); },
    zap: function (s) { return svg(s, p("M13.4 2.8L5 13.4h5.6L10.6 21.2 19 10.6h-5.6z")); },
    listTodo: function (s) { return svg(s, p("M9.5 6.5h10M9.5 12h10M9.5 17.5h10") + p("M4 4.9l1.4 1.4L8 3.6") + p("M4 10.4l1.4 1.4L8 9.1") + p("M4 15.9l1.4 1.4L8 14.6")); },
    bookOpen: function (s) { return svg(s, p("M12 6.5C10.5 5 8.5 4.5 5 4.5v13c3.5 0 5.5.5 7 2 1.5-1.5 3.5-2 7-2v-13c-3.5 0-5.5.5-7 2z") + p("M12 6.5v13")); },
    code: function (s) { return svg(s, p("M9 7.5L4.5 12L9 16.5") + p("M15 7.5L19.5 12L15 16.5")); },
    newTask: function (s) { return svg(s, '<circle cx="12" cy="12" r="8.2"/>' + p("M12 8.4v7.2M8.4 12h7.2")); },
    menu: function (s) { return svg(s, p("M4 7h16M4 12h16M4 17h16")); },
    arrowLeft: function (s) { return svg(s, p("M19 12H5") + p("M10.5 6.5L5 12l5.5 5.5")); },
    arrowRight: function (s) { return svg(s, p("M5 12h14") + p("M13.5 6.5L19 12l-5.5 5.5")); },
    window: function (s) { return svg(s, '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>' + p("M3.5 9h17") + '<circle cx="6.3" cy="6.8" r=".55" fill="currentColor" stroke="none"/>'); },
    globe: function (s) { return svg(s, '<circle cx="12" cy="12" r="8.5"/>' + p("M3.5 12h17") + p("M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5z")); },
    camera: function (s) { return svg(s, p("M4 8.5h3l1.5-2h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17v-7A1.5 1.5 0 0 1 4 8.5z") + '<circle cx="12" cy="13" r="3.2"/>'); },
    link: function (s) { return svg(s, p("M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1.3 1.3") + p("M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.3-1.3")); },
    scan: function (s) { return svg(s, p("M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5") + p("M4 12h16")); },
    expand: function (s) { return svg(s, p("M9 4H4v5") + p("M15 20h5v-5") + p("M20 9V4h-5") + p("M4 15v5h5")); },
    helpCircle: function (s) { return svg(s, '<circle cx="12" cy="12" r="8.5"/>' + p("M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .9-1 1.7v.3") + '<circle cx="12" cy="16.6" r=".6" fill="currentColor"/>'); },
    clock: function (s) { return svg(s, '<circle cx="12" cy="12" r="8.5"/>' + p("M12 7.5V12l3 2")); },
    terminal: function (s) { return svg(s, p("M5 8l4 4-4 4") + p("M12 16.5h7")); },
    folder: function (s) { return svg(s, p("M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z")); },
    folderOpen: function (s) { return svg(s, p("M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v1") + p("M3.5 8.5h17.5l-2.2 8.2a2 2 0 0 1-1.9 1.8H6.1a2 2 0 0 1-1.9-1.6z")); },
    panelLeft: function (s) { return svg(s, '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>' + p("M9.5 4.5v15")); },
    panelBottom: function (s) { return svg(s, '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>' + p("M3.5 14.5h17")); },
    panelRight: function (s) { return svg(s, '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>' + p("M14.5 4.5v15")); },
    dot: function (s) { return svg(s, '<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'); },
    arrowRight: function (s) { return svg(s, p("M5 12h13M13 7l5 5-5 5")); },
    gitCommit: function (s) { return svg(s, '<circle cx="12" cy="12" r="3"/>' + p("M3.5 12h5.5M15 12h5.5")); },
    lock: function (s) { return svg(s, '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/>' + p("M8 10.5V8a4 4 0 0 1 8 0v2.5") + '<circle cx="12" cy="15.2" r=".7" fill="currentColor"/>'); },
    shield: function (s) { return svg(s, p("M12 3.5l7 2.6v5.3c0 4.2-2.9 7.3-7 8.9-4.1-1.6-7-4.7-7-8.9V6.1z")); },
    eye: function (s) { return svg(s, p("M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z") + '<circle cx="12" cy="12" r="2.8"/>'); },
    file: function (s) { return svg(s, p("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z") + p("M14 3v5h5")); }
  };

  /* ---- colored file-type icons (16px, seti-style monograms) ---- */
  function fileIcon(bg, glyph, textColor) {
    return function () {
      return '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' +
        '<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="' + bg + '" opacity="0.18"/>' +
        '<text x="8" y="11.2" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="7.5" font-weight="600" fill="' + (textColor || bg) + '">' + glyph + "</text></svg>";
    };
  }
  function atomIcon(color) {
    return function () {
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="1.3" fill="' + color + '"/>' +
        '<ellipse cx="8" cy="8" rx="6" ry="2.6" stroke="' + color + '" stroke-width="1.1"/>' +
        '<ellipse cx="8" cy="8" rx="6" ry="2.6" stroke="' + color + '" stroke-width="1.1" transform="rotate(60 8 8)"/>' +
        '<ellipse cx="8" cy="8" rx="6" ry="2.6" stroke="' + color + '" stroke-width="1.1" transform="rotate(120 8 8)"/></svg>';
    };
  }

  var C = { ts: "#519aba", css: "#519aba", html: "#e37933", json: "#cbcb41", md: "#519aba", svg: "#a1c181", env: "#d7ba43", git: "#6d6d80" };

  var fileIcons = {
    ts: fileIcon(C.ts, "TS"),
    tsx: atomIcon(C.ts),
    js: fileIcon(C.ts, "JS"),
    css: fileIcon(C.css, "#"),
    html: fileIcon(C.html, "&lt;&gt;"),
    json: fileIcon(C.json, "{ }"),
    md: fileIcon(C.md, "M"),
    svg: (function (color) { return function () {
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="' + color + '" opacity="0.18"/><path d="M4 11.5l2.6-3.2 1.9 2 2-2.6L12 11.5z" fill="' + color + '"/><circle cx="5.6" cy="5.6" r="1.1" fill="' + color + '"/></svg>';
    }; })(C.svg),
    env: (function (color) { return function () {
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="' + color + '" opacity="0.18"/><path d="M8 4.6l.7 1.4 1.5.2-1.1 1 .3 1.5L8 7.9l-1.4.8.3-1.5-1.1-1 1.5-.2z" fill="' + color + '"/><path d="M5 10.2h6" stroke="' + color + '" stroke-width="1.2" stroke-linecap="round"/></svg>';
    }; })(C.env),
    gitignore: (function (color) { return function () {
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="' + color + '" opacity="0.18"/><circle cx="5.5" cy="4.8" r="1.2" stroke="' + color + '" stroke-width="1.1"/><circle cx="5.5" cy="11.2" r="1.2" stroke="' + color + '" stroke-width="1.1"/><circle cx="10.8" cy="6.2" r="1.2" stroke="' + color + '" stroke-width="1.1"/><path d="M5.5 6v4M10.8 7.4c0 2.6-3.3 2.2-4.8 3.4" stroke="' + color + '" stroke-width="1.1" stroke-linecap="round"/></svg>';
    }; })(C.git),
    txt: fileIcon("#8a8a9a", "T"),
    generic: (function () { return function () {
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 5 13.5h6a1.5 1.5 0 0 0 1.5-1.5V4.5z" stroke="#8a8a9a" stroke-width="1.2"/><path d="M10.5 2.5V5H13" stroke="#8a8a9a" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    }; })()
  };

  function extOf(path) {
    var name = path.split("/").pop();
    if (name === ".gitignore") return "gitignore";
    if (name === ".env.example") return "env";
    if (name.indexOf(".") === 0) return "txt";
    var m = name.match(/\.([a-z]+)$/i);
    return m ? m[1].toLowerCase() : "generic";
  }

  var Icons = {
    ui: function (name, size) { return (strokeIcons[name] || strokeIcons.file)(size || 16); },
    file: function (path) {
      var e = extOf(path);
      return (fileIcons[e] || fileIcons.generic)();
    },
    mount: function (root) {
      (root || document).querySelectorAll("[data-icon]").forEach(function (el) {
        var name = el.getAttribute("data-icon");
        if (strokeIcons[name]) el.innerHTML = strokeIcons[name](16);
      });
    }
  };

  window.Icons = Icons;
})();
