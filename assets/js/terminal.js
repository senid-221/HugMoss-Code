/* terminal.js — a file shell over the real workspace. No process host exists in a browser tab. */
(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };
  var esc = function (s) { return HL.esc(s); };

  var sessions = [];
  var current = 0;
  var buffer = "";
  var history = [];
  var histIdx = -1;

  function s() { return sessions[current]; }
  function promptPath() {
    var cwd = s().cwd;
    return "~" + (cwd ? "/" + cwd : "");
  }

  /* ----------------------------- session model ------------------------- */
  function newSession(silent) {
    sessions.push({ lines: [], label: "shell " + (sessions.length + 1), cwd: "" });
    current = sessions.length - 1;
    push(banner());
    renderTabs();
    renderPrompt();
    if (!silent) focus();
  }

  function banner() {
    return '<div class="tline tline--dim">HugMoss file shell · <span class="c-accent">no process host</span> · ' +
      (WS.loaded ? esc(WS.projectName) + " · " + WS.visiblePaths().length + " files" : "open a folder to browse files") + "</div>" +
      '<div class="tline tline--dim">Type <span class="c-cyan">help</span> for commands. Nothing here executes programs.</div>';
  }

  function push(html) {
    s().lines.push(html);
    $("#termLines").insertAdjacentHTML("beforeend", html);
    scrollDown();
  }
  function scrollDown() {
    var body = $("#termBody");
    body.scrollTop = body.scrollHeight;
  }
  function out(text, cls) {
    push('<div class="tline ' + (cls || "") + '">' + text + "</div>");
  }
  function renderTabs() {
    $("#termTablist").innerHTML = sessions.map(function (sess, i) {
      return '<button class="term__tab' + (i === current ? " term__tab--active" : "") + '" data-term="' + i + '">' +
        Icons.ui("terminal", 13) + esc(sess.label) + "</button>";
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll("[data-term]"), function (b) {
      b.addEventListener("click", function () { switchTo(Number(b.getAttribute("data-term"))); });
    });
  }
  function switchTo(i) {
    if (!sessions[i]) return;
    current = i;
    $("#termLines").innerHTML = s().lines.join("");
    renderTabs();
    renderPrompt();
    scrollDown();
    focus();
  }
  function renderPrompt() {
    var cwd = $("#termCwd");
    if (cwd) cwd.textContent = promptPath();
  }

  /* ------------------------------- paths ------------------------------- */
  function isDir(path) {
    if (!path) return WS.loaded;
    var prefix = path + "/";
    return WS.visiblePaths().some(function (p) { return p.indexOf(prefix) === 0; });
  }
  function isFile(path) { return !!WS.record(path) && !WS.record(path).deleted; }
  function resolve(raw) {
    var value = String(raw || "").replace(/\\/g, "/");
    if (!value || value === "~") return s().cwd;
    if (value.indexOf("~/") === 0) value = value.slice(2);
    else if (value.charAt(0) === "/") value = value.slice(1);
    else value = (s().cwd ? s().cwd + "/" : "") + value;
    return WS.normalize(value);
  }
  function children(dir) {
    var prefix = dir ? dir + "/" : "";
    var dirs = {}, files = [];
    WS.visiblePaths().forEach(function (p) {
      if (p.indexOf(prefix) !== 0) return;
      var rest = p.slice(prefix.length);
      if (!rest) return;
      var slash = rest.indexOf("/");
      if (slash >= 0) dirs[rest.slice(0, slash)] = 1;
      else files.push(rest);
    });
    return { dirs: Object.keys(dirs).sort(), files: files.sort() };
  }
  function requireWorkspace() {
    if (!WS.loaded) {
      out('<span class="c-red">No folder is open.</span> <span class="c-dim">Use File ▸ Open Folder, or drop a folder on the window.</span>');
      return false;
    }
    return true;
  }
  function syntaxLine(path, line) { return HL.renderLine(line, WS.language(path)) || "&nbsp;"; }

  /* ------------------------------- commands ---------------------------- */
  var cmds = {};

  cmds.help = function () {
    out('<span class="c-bold">HugMoss file shell</span> <span class="c-dim">— reads the open folder, never spawns a process</span>');
    out("");
    out('  <span class="c-cyan">ls</span> [dir]        list a directory');
    out('  <span class="c-cyan">cd</span> &lt;dir&gt;        change directory (use <span class="c-cyan">cd ~</span> for root)');
    out('  <span class="c-cyan">pwd</span>             print the current folder');
    out('  <span class="c-cyan">cat</span> &lt;file&gt;      print a file with syntax colour');
    out('  <span class="c-cyan">head</span> &lt;file&gt; [n]  first lines · <span class="c-cyan">tail</span> for the last');
    out('  <span class="c-cyan">wc</span> &lt;file&gt;       line, word and character counts');
    out('  <span class="c-cyan">find</span> &lt;text&gt;     search names and contents');
    out('  <span class="c-cyan">tree</span> [dir]      show the folder as a tree');
    out('  <span class="c-cyan">open</span> &lt;file&gt;     open the file in the editor');
    out('  <span class="c-cyan">download</span> &lt;file&gt; save a copy through the browser');
    out('  <span class="c-cyan">history</span> · <span class="c-cyan">clear</span> · <span class="c-cyan">date</span> · <span class="c-cyan">echo</span>');
    out("");
    out('<span class="c-dim">There is no git, npm, node or shell execution in this browser tab. Use Changes for session diffs and your own terminal for builds.</span>');
  };

  cmds.pwd = function () { out("/" + (s().cwd ? s().cwd : "") + (s().cwd ? "" : "")); };

  cmds.cd = function (args) {
    var target = resolve(args[0] || "~");
    if (!isDir(target)) {
      out('<span class="c-red">cd: ' + esc(args[0] || "") + ": Not a directory</span>");
      return;
    }
    s().cwd = target;
    renderPrompt();
    out('<span class="c-dim">' + esc(promptPath()) + "</span>");
  };

  cmds.ls = function (args) {
    if (!requireWorkspace()) return;
    var target = resolve(args[0] || ".");
    if (isFile(target)) { out(esc(target)); return; }
    if (!isDir(target)) { out('<span class="c-red">ls: ' + esc(args[0]) + ": No such directory</span>"); return; }
    var node = children(target);
    if (!node.dirs.length && !node.files.length) { out('<span class="c-dim">(empty)</span>'); return; }
    node.dirs.forEach(function (d) { out('<span class="c-blue">' + esc(d) + "/</span>"); });
    node.files.forEach(function (f) {
      var rec = WS.record((target ? target + "/" : "") + f);
      var suffix = rec && rec.secret ? ' <span class="c-yellow">[secret]</span>' : "";
      out("  " + esc(f) + suffix);
    });
  };

  cmds.cat = function (args) {
    if (!requireWorkspace()) return;
    if (!args[0]) { out('<span class="c-red">usage: cat &lt;file&gt;</span>'); return; }
    var path = resolve(args[0]);
    if (!isFile(path)) { out('<span class="c-red">cat: ' + esc(args[0]) + ": No such file</span>"); return; }
    var lines = (WS.content(path) || "").split("\n");
    var limit = Math.min(lines.length, 2000);
    for (var i = 0; i < limit; i++) out("  " + syntaxLine(path, lines[i]));
    if (lines.length > limit) out('<span class="c-dim">… ' + (lines.length - limit) + " more lines</span>");
  };

  cmds.head = function (args) {
    if (!requireWorkspace()) return;
    var path = resolve(args[0] || "");
    if (!args[0] || !isFile(path)) { out('<span class="c-red">usage: head &lt;file&gt; [lines]</span>'); return; }
    var count = Math.max(1, Math.min(200, parseInt(args[1], 10) || 20));
    (WS.content(path) || "").split("\n").slice(0, count).forEach(function (ln) { out("  " + syntaxLine(path, ln)); });
  };

  cmds.tail = function (args) {
    if (!requireWorkspace()) return;
    var path = resolve(args[0] || "");
    if (!args[0] || !isFile(path)) { out('<span class="c-red">usage: tail &lt;file&gt; [lines]</span>'); return; }
    var count = Math.max(1, Math.min(200, parseInt(args[1], 10) || 20));
    var all = (WS.content(path) || "").split("\n");
    all.slice(Math.max(0, all.length - count)).forEach(function (ln) { out("  " + syntaxLine(path, ln)); });
  };

  cmds.wc = function (args) {
    if (!requireWorkspace()) return;
    var path = resolve(args[0] || "");
    if (!args[0] || !isFile(path)) { out('<span class="c-red">usage: wc &lt;file&gt;</span>'); return; }
    var text = WS.content(path) || "";
    out("  " + text.split("\n").length + " lines · " + (text.trim() ? text.trim().split(/\s+/).length : 0) + " words · " + text.length + " characters");
  };

  cmds.find = function (args) {
    if (!requireWorkspace()) return;
    var term = (args[0] || "").toLowerCase();
    if (!term) { out('<span class="c-red">usage: find &lt;text&gt;</span>'); return; }
    var count = 0;
    WS.visiblePaths().forEach(function (path) {
      var rec = WS.record(path);
      if (!rec || rec.secret) return;
      if (path.toLowerCase().indexOf(term) >= 0 && count < 80) {
        out('  <span class="c-green">' + esc(path) + "</span>");
        count++;
      }
      if (count >= 80) return;
      var lines = rec.content.split("\n");
      for (var i = 0; i < lines.length && count < 80; i++) {
        if (lines[i].toLowerCase().indexOf(term) >= 0) {
          out("  <span class=\"" + "c-accent" + "\">" + esc(path) + ":" + (i + 1) + "</span> <span class=\"c-dim\">" + esc(lines[i].trim().slice(0, 100)) + "</span>");
          count++;
        }
      }
    });
    if (!count) out('<span class="c-dim">no matches for “' + esc(term) + "”</span>");
  };

  cmds.tree = function (args) {
    if (!requireWorkspace()) return;
    var root = resolve(args[0] || ".");
    if (!isDir(root)) { out('<span class="c-red">tree: ' + esc(args[0]) + ": No such directory</span>"); return; }
    out('<span class="c-blue">' + esc(promptPath() === "~" && !root ? WS.projectName : (root ? root + "/" : WS.projectName)) + "</span>");
    (function walk(dir, prefix, depth) {
      if (depth > 6) return;
      var node = children(dir);
      var total = node.dirs.length + node.files.length;
      var index = 0;
      node.dirs.forEach(function (d) {
        index++;
        var last = index === total;
        out('<span class="c-dim">' + prefix + (last ? "└── " : "├── ") + "</span><span class=\"c-blue\">" + esc(d) + "/</span>");
        walk((dir ? dir + "/" : "") + d, prefix + (last ? "    " : "│   "), depth + 1);
      });
      node.files.forEach(function (f) {
        index++;
        var last = index === total;
        out('<span class="c-dim">' + prefix + (last ? "└── " : "├── ") + "</span>" + esc(f));
      });
    })(root, "", 0);
  };

  cmds.open = function (args) {
    if (!requireWorkspace()) return;
    var path = resolve(args[0] || "");
    if (!args[0] || !isFile(path)) { out('<span class="c-red">usage: open &lt;file&gt;</span>'); return; }
    if (window.App) App.openFile(path, { focus: true });
    out('<span class="c-dim">opened ' + esc(path) + "</span>");
  };

  cmds.download = function (args) {
    if (!requireWorkspace()) return;
    var path = resolve(args[0] || "");
    if (!args[0] || !isFile(path)) { out('<span class="c-red">usage: download &lt;file&gt;</span>'); return; }
    if (window.App) App.downloadPath(path);
    out('<span class="c-dim">downloaded a copy of ' + esc(path) + "</span>");
  };

  cmds.clear = function () {
    s().lines = [];
    $("#termLines").innerHTML = "";
  };

  cmds.history = function () {
    if (!history.length) { out('<span class="c-dim">No commands yet.</span>'); return; }
    history.slice(-30).forEach(function (h, i) { out('<span class="c-dim">' + (history.length - Math.min(30, history.length) + i + 1) + "  " + esc(h) + "</span>"); });
  };

  cmds.date = function () { out(esc(new Date().toString())); };
  cmds.echo = function (args) { out(esc(args.join(" "))); };

  cmds.git = function () {
    out('<span class="c-yellow">No git process runs in this browser tab.</span>');
    out('<span class="c-dim">HugMoss tracks session edits in Changes (Alt+Z) and can revert them. Commit with your own git client.</span>');
    var changes = WS.loaded ? WS.changes() : [];
    if (changes.length) {
      out("");
      out('<span class="c-bold">Session changes</span> <span class="c-dim">(not a git status)</span>');
      changes.forEach(function (c) {
        out('  <span class="c-' + (c.kind === "D" ? "red" : c.kind === "U" ? "green" : "yellow") + '">' + c.kind + "  " + esc(c.path) + "</span>");
      });
    }
  };

  ["npm", "npx", "node", "pnpm", "yarn", "bun", "python", "python3", "pip", "cargo", "go", "make", "tsc", "vite", "deno", "java", "dotnet", "ruby", "php"].forEach(function (name) {
    cmds[name] = function () {
      out('<span class="c-yellow">' + esc(name) + ': no process host.</span> <span class="c-dim">A browser tab cannot execute local programs. Run this in your own terminal.</span>');
    };
  });

  /* -------------------------------- exec ------------------------------- */
  function echoCommand(cmd) {
    push('<div class="tline tline--prompt"><span class="term__arrow">➜</span> <span class="term__cwd">' + esc(promptPath()) + "</span> <span class=\"c-dim\">" + esc(cmd) + "</span></div>");
  }

  function exec(raw) {
    var line = raw.trim();
    echoCommand(line);
    if (!line) return;
    history.push(line);
    history = history.slice(-100);
    histIdx = history.length;
    if (line.charAt(0) === "#") return;
    var parts = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    parts = parts.map(function (p) { return p.replace(/^["']|["']$/g, ""); });
    var name = parts[0];
    if (!cmds[name]) {
      out('<span class="c-red">command not found: ' + esc(name) + "</span> <span class=\"c-dim\">type <span class=\"c-cyan\">help</span> — this shell only reads workspace files</span>");
      return;
    }
    try { cmds[name](parts.slice(1)); }
    catch (e) { out('<span class="c-red">' + esc(e.message || String(e)) + "</span>"); }
    scrollDown();
  }

  function run(cmd) {
    if (window.App) App.setPanelOpen(true);
    if (window.App) App.setPanelTab("terminal");
    exec(cmd);
    focus();
  }

  function clear() {
    if (!s()) return;
    cmds.clear();
    renderPrompt();
    focus();
  }

  function focus() {
    var input = $("#termInput");
    if (!input) return;
    input.value = buffer;
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
  }

  function kill() {
    if (sessions.length > 1) {
      sessions.splice(current, 1);
      current = Math.min(current, sessions.length - 1);
      renderTabs();
      switchTo(current);
    } else {
      sessions[0] = { lines: [], label: "shell 1", cwd: "" };
      current = 0;
      renderTabs();
      switchTo(0);
      out('<span class="c-dim">[session cleared — this shell has no process to kill]</span>');
    }
  }

  /* ------------------------------- input IO ---------------------------- */
  function mirror() { $("#termMirror").textContent = buffer; }

  function complete() {
    if (!WS.loaded) return;
    var tokens = buffer.split(" ");
    var token = tokens[tokens.length - 1];
    var cut = token.lastIndexOf("/");
    var dirPart = cut >= 0 ? token.slice(0, cut) : "";
    var prefix = cut >= 0 ? token.slice(cut + 1) : token;
    var dir = resolve(dirPart || ".");
    if (!isDir(dir)) return;
    var node = children(dir);
    var candidates = node.dirs.map(function (d) { return { name: d + "/", dir: true }; })
      .concat(node.files.map(function (f) { return { name: f, dir: false }; }))
      .filter(function (c) { return c.name.toLowerCase().indexOf(prefix.toLowerCase()) === 0; });
    if (!candidates.length) return;
    if (candidates.length === 1) {
      tokens[tokens.length - 1] = (dirPart ? dirPart + "/" : "") + candidates[0].name;
      buffer = tokens.join(" ");
      $("#termInput").value = buffer;
      mirror();
      return;
    }
    out('<span class="c-dim">' + candidates.map(function (c) { return esc(c.name); }).join("  ") + "</span>");
    scrollDown();
  }

  function wire() {
    var body = $("#termBody");
    var input = $("#termInput");
    body.addEventListener("click", function () {
      if (window.getSelection().toString()) return;
      focus();
    });
    input.addEventListener("focus", function () { $("#termCursor").classList.remove("is-off"); });
    input.addEventListener("blur", function () { $("#termCursor").classList.add("is-off"); });
    input.addEventListener("input", function () {
      buffer = input.value.replace(/[\r\n]+/g, " ");
      input.value = buffer;
      mirror();
    });
    input.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        echoCommand(buffer + "^C");
        buffer = ""; input.value = ""; mirror();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); clear(); return; }
      if (e.key === "Tab") { e.preventDefault(); complete(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        var line = buffer;
        buffer = ""; input.value = ""; mirror();
        exec(line);
        scrollDown();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!history.length) return;
        histIdx = Math.max(0, histIdx - 1);
        buffer = history[histIdx] || "";
        input.value = buffer; mirror();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        histIdx = Math.min(history.length, histIdx + 1);
        buffer = history[histIdx] || "";
        input.value = buffer; mirror();
      }
    });
    $("#termAddBtn").addEventListener("click", function () { newSession(); });
    $("#termTrashBtn").addEventListener("click", kill);
  }

  function workspaceChanged() {
    sessions.forEach(function (sess) {
      if (sess.cwd && !isDir(sess.cwd)) sess.cwd = "";
    });
    renderPrompt();
    if (!sessions.length) return;
    out('<span class="c-dim">workspace ' + (WS.loaded ? "opened: " + esc(WS.projectName) : "closed") + "</span>");
  }

  function init() {
    wire();
    newSession(true);
  }

  window.Terminal = {
    init: init,
    run: run,
    focus: focus,
    kill: kill,
    clear: clear,
    newSession: function () { newSession(); },
    workspaceChanged: workspaceChanged,
    output: function (html) { out(html); }
  };
})();
