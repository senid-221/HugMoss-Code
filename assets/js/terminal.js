/* terminal.js — simulated shell operating on the virtual workspace. */
(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };

  var sessions = [];
  var current = 0;
  var buffer = "";
  var history = [];
  var histIdx = -1;
  var streamLock = false;

  var COMMITS = [
    ["7f3a1c9", "feat: dashboard grid + stats cards"],
    ["b21e80d", "fix: clamp humidity reading to 0-100"],
    ["4c9f772", "refactor: extract api client with timeout"],
    ["1ad5530", "chore: scaffold Vite + TypeScript"],
    ["0e6b218", "initial commit"]
  ];

  function esc(s) { return HL.esc(s); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ----------------------------- session model ------------------------- */
  function newSession(silent) {
    sessions.push({ lines: [], label: "pwsh — agrosmart", id: sessions.length + 1 });
    current = sessions.length - 1;
    push(banner());
    renderTabs();
    if (!silent) focus();
  }
  function banner() {
    return '<div class="tline tline--dim">HugMoss integrated terminal · <span class="c-accent">pwsh</span> · node 22.11.0 · ' +
      esc(WS.projectName) + "</div>";
  }
  function s() { return sessions[current]; }

  function push(html) {
    s().lines.push(html);
    if (s() === sessions[current]) {
      $("#termLines").insertAdjacentHTML("beforeend", html);
      scrollDown();
    }
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
    current = i;
    $("#termLines").innerHTML = s().lines.join("");
    renderTabs();
    scrollDown();
    focus();
  }

  /* -------------------------------- prompt ----------------------------- */
  function promptHtml(cmd) {
    return '<div class="tline"><span class="term__arrow">➜</span> <span class="term__cwd">agrosmart-dashboard</span>' +
      (cmd ? ' <span class="c-dim">' + esc(cmd) + "</span>" : "") + "</div>";
  }
  function echoCommand(cmd) {
    push(promptHtml(cmd));
  }

  /* ------------------------------- commands ---------------------------- */
  var cmds = {
    help: function () {
      out('<span class="c-bold">Available commands</span>');
      out('  <span class="c-cyan">ls</span> [dir]        list workspace files');
      out('  <span class="c-cyan">cat</span> &lt;file&gt;      print a file with syntax colour');
      out('  <span class="c-cyan">find</span> &lt;term&gt;     search file names and contents');
      out('  <span class="c-cyan">clear</span>          clear this terminal');
      out('  <span class="c-cyan">pwd</span> · <span class="c-cyan">whoami</span> · <span class="c-cyan">date</span> · <span class="c-cyan">echo</span>');
      out('  <span class="c-cyan">git status</span> · <span class="c-cyan">git log</span> · <span class="c-cyan">git diff</span> · <span class="c-cyan">git add .</span> · <span class="c-cyan">git commit -m "…"</span>');
      out('  <span class="c-cyan">npm run dev</span> · <span class="c-cyan">npm run build</span> · <span class="c-cyan">npm test</span> · <span class="c-cyan">npm install</span>');
      out('  <span class="c-dim">↑ / ↓ walk history · Ctrl+C aborts · Ctrl+L clears</span>');
    },
    ls: function (args) {
      var dir = args[0];
      var paths = WS.visiblePaths();
      if (dir) {
        var clean = dir.replace(/\/+$/, "").replace(/^\.\//, "");
        var hits = paths.filter(function (p) { return p.indexOf(clean + "/") === 0; })
          .map(function (p) { return p.slice(clean.length + 1); })
          .filter(function (p) { return p.indexOf("/") < 0; });
        if (!hits.length) return out('<span class="c-red">ls: ' + esc(dir) + ": No such file or directory</span>");
        return hits.forEach(function (h) { out("  " + esc(h)); });
      }
      var root = WS.buildTree();
      root.dirs.forEach(function (d) { out('  <span class="c-blue">' + esc(d.name) + "/</span>"); });
      root.files.forEach(function (f) { out("  " + esc(f.name)); });
    },
    cat: function (args) {
      var path = args[0];
      if (!path) return out('<span class="c-red">usage: cat &lt;file&gt;</span>');
      var clean = path.replace(/^\.\//, "");
      if (!WS.files[clean]) return out('<span class="c-red">cat: ' + esc(path) + ": No such file</span>");
      (WS.content(clean) || "").split("\n").forEach(function (ln) {
        out("  " + (HL.renderLine(ln, WS.language(clean)) || "&nbsp;"));
      });
    },
    find: function (args) {
      var term = (args[0] || "").toLowerCase();
      if (!term) return out('<span class="c-red">usage: find &lt;term&gt;</span>');
      var n = 0;
      WS.visiblePaths().forEach(function (p) {
        if (p.toLowerCase().indexOf(term) >= 0) { out('  <span class="c-green">' + esc(p) + "</span>"); n++; return; }
        (WS.content(p) || "").split("\n").forEach(function (ln, i) {
          if (ln.toLowerCase().indexOf(term) >= 0 && n < 40) { out("  " + esc(p) + ":" + (i + 1) + ": <span class=\"c-dim\">" + esc(ln.trim().slice(0, 70)) + "</span>"); n++; }
        });
      });
      if (!n) out("  <span class=\"c-dim\">no matches for “" + esc(term) + "”</span>");
    },
    clear: function () { s().lines = []; $("#termLines").innerHTML = ""; },
    pwd: function () { out("/home/vincent/projects/agrosmart-dashboard"); },
    whoami: function () { out("vincent"); },
    date: function () { out(new Date().toString()); },
    echo: function (args) { out(esc(args.join(" "))); },
    node: function (args) {
      if (args[0] === "-v" || args[0] === "--version") return out("v22.11.0");
      out('<span class="c-dim">node REPL is not wired in this preview</span>');
    },
    git: function (args) {
      var sub = args[0];
      if (sub === "status") {
        out("On branch <span class='c-accent'>main</span>");
        out("Your branch is up to date with '<span class='c-accent'>origin/main</span>'.");
        out("");
        var list = App.state.scm;
        if (!list.length) return out("nothing to commit, working tree clean");
        out('<span class="c-bold">Changes not staged for commit:</span>');
        list.forEach(function (c) {
          var isNew = c.kind === "U" || c.kind === "A";
          var tag = isNew ? "new file:   " : "modified:   ";
          out('  <span class="' + (isNew ? "c-green" : "c-yellow") + '">' + tag + esc(c.path) + "</span>");
        });
        out("");
        out("no changes added to commit — <span class='c-cyan'>git add .</span> then <span class='c-cyan'>git commit -m \"…\"</span>");
        return;
      }
      if (sub === "log" || sub === "l") {
        COMMITS.forEach(function (c) {
          out('<span class="c-accent">commit ' + c[0] + '</span> <span class="c-dim">(HEAD -&gt; main, origin/main)</span>');
          out('  <span class="c-bold">IRAGUHA Vincent</span> &lt;vincent@agrosmart.dev&gt;');
          out("  " + esc(c[1]));
          out("");
        });
        return;
      }
      if (sub === "diff") {
        var list2 = App.state.scm.filter(function (c) { return c.kind !== "U" && c.kind !== "A"; });
        if (!list2.length) return out('<span class="c-dim">(no unstaged differences)</span>');
        list2.forEach(function (c) {
          var lines = HL.diffLines(WS.head(c.path) || "", WS.content(c.path) || "");
          var adds = lines.filter(function (l) { return l.type === "add"; }).length;
          var dels = lines.filter(function (l) { return l.type === "del"; }).length;
          out('<span class="c-bold">diff --git a/' + esc(c.path) + " b/" + esc(c.path) + "</span>");
          out('<span class="c-dim">@@ -1,' + adds + dels + " +1," + adds + dels + ' @@</span>');
          lines.forEach(function (l) {
            if (l.type === "ctx") return out('  <span class="c-dim">' + esc(l.text.slice(0, 90)) + "</span>");
            var sign = l.type === "add" ? "+" : "-";
            var cls = l.type === "add" ? "c-green" : "c-red";
            out('<span class="' + cls + '">' + sign + " " + esc(l.text.slice(0, 90)) + "</span>");
          });
        });
        return;
      }
      if (sub === "add") {
        out('<span class="c-dim">staged ' + App.state.scm.length + " file(s)</span>");
        return;
      }
      if (sub === "commit") {
        var msg = args.slice(1).join(" ").replace(/^["']|["']$/g, "");
        if (!msg) return out('<span class="c-red">aborting: empty commit message</span>');
        var n = App.state.scm.length;
        App.state.scm = [];
        App.treeRefresh();
        out('<span class="c-green">[main ' + Math.random().toString(16).slice(2, 9) + "] " + esc(msg) + "</span>");
        out(" " + n + " file" + (n === 1 ? "" : "s") + " changed");
        return;
      }
      if (sub === "branch") return out("* <span class='c-accent'>main</span>\n  feature/alert-badges");
      out('<span class="c-red">git: "' + esc(sub || "") + '" is not a git command. See "git help".</span>');
    },
    npm: function (args) {
      var j = args.join(" ");
      if (/^run\s+dev$|^start$/.test(j)) return devServer();
      if (/^run\s+build$|^build$/.test(j)) return build();
      if (/^test$|^run\s+test$|^t$/.test(j)) return test();
      if (/^install$|^i$/.test(j)) return install();
      if (/^run\s+lint$|^lint$/.test(j)) return lint();
      out('<span class="c-red">npm error</span> no script for "' + esc(j) + '"');
    }
  };

  function stream(lines, done) {
    streamLock = true;
    var i = 0;
    (function step() {
      if (i >= lines.length) { streamLock = false; if (done) done(); return; }
      out(lines[i++]);
      setTimeout(step, lines[i - 1] && lines[i - 1].indexOf("▏") >= 0 ? 26 : 95);
    })();
  }
  function devServer() {
    stream([
      '<span class="c-dim">&gt; agrosmart-dashboard@0.4.0 dev</span>',
      '<span class="c-dim">&gt; vite</span>',
      "",
      '  <span class="c-green">VITE</span> v6.0.3  <span class="c-bold">ready in 412 ms</span>',
      "",
      '  <span class="c-bold">➜  Local:</span>   <span class="c-cyan">http://localhost:5173/</span>',
      '  <span class="c-bold">➜  Network:</span> use <span class="c-dim">--host</span> to expose',
      '  <span class="c-dim">➜  press h + enter to show help</span>',
      ""
    ], function () { out('<span class="c-dim">dev server running — press Ctrl+C in a real terminal to stop</span>'); });
  }
  function build() {
    stream([
      '<span class="c-dim">&gt; agrosmart-dashboard@0.4.0 build</span>',
      '<span class="c-dim">&gt; tsc -b && vite build</span>',
      "",
      '<span class="c-bold">vite v6.0.3</span> building for production...',
      '  <span class="c-dim">transforming (1) src/main.tsx</span>',
      '  <span class="c-dim">transforming (47) src/components/StatsCard.tsx</span>',
      '  <span class="c-dim">transforming (112) node_modules/recharts/es6/index.js</span>',
      '✓ <span class="c-green">1284 modules transformed</span>',
      '<span class="c-dim">rendering chunks...</span>',
      'dist/index.html                    <span class="c-cyan">0.42 kB</span> │ gzip:  0.29 kB',
      'dist/assets/index-Bq7x2.css       <span class="c-cyan">11.86 kB</span> │ gzip:  2.71 kB',
      'dist/assets/index-Dp4m10.js       <span class="c-cyan">184.03 kB</span> │ gzip: 59.41 kB',
      "✓ built in <span class='c-bold'>1.34 s</span>"
    ]);
  }
  function test() {
    stream([
      '<span class="c-dim">&gt; agrosmart-dashboard@0.4.0 test</span>',
      '<span class="c-dim">&gt; vitest run</span>',
      "",
      ' <span class="c-bold">RUN</span>  v2.1.8  <span class="c-dim">agrosmart-dashboard</span>',
      "",
      ' <span class="c-green">✓</span> src/utils/format.test.ts <span class="c-dim">(4 tests)</span> <span class="c-dim">7 ms</span>',
      ' <span class="c-green">✓</span> src/hooks/useFarmData.test.ts <span class="c-dim">(3 tests)</span> <span class="c-dim">21 ms</span>',
      ' <span class="c-green">✓</span> src/components/StatsCard.test.tsx <span class="c-dim">(5 tests)</span> <span class="c-dim">38 ms</span>',
      "",
      '<span class="c-dim"> Test Files </span>  <span class="c-green">3 passed</span> (3)',
      '<span class="c-dim">      Tests </span>  <span class="c-green">12 passed</span> (12)',
      '<span class="c-dim">   Duration </span>  1.06s'
    ]);
  }
  function install() {
    stream([
      '<span class="c-dim">⠋ resolving dependencies…</span>',
      '<span class="c-dim">⠹ fetching react@19.0.0…</span>',
      "",
      'added <span class="c-bold">7</span> packages in 2s',
      '<span class="c-dim">142 packages are looking for funding</span>'
    ]);
  }
  function lint() {
    stream([
      '<span class="c-dim">&gt; eslint "src/**/*.{ts,tsx}"</span>',
      "",
      App.state.problems.length
        ? App.state.problems.map(function (p) {
            return '  <span class="' + (p.sev === "error" ? "c-red" : "c-yellow") + '">' + (p.sev === "error" ? "error" : "warning") + "</span>  " +
              esc(p.msg) + "\n      <span class=\"c-dim\">" + esc(p.path) + ":" + p.line + ":" + p.col + "</span>";
          }).join("\n")
        : '  <span class="c-green">✚ 0 problems (0 errors, 0 warnings)</span>'
    ]);
  }

  /* -------------------------------- exec ------------------------------- */
  function exec(raw) {
    var line = raw.trim();
    echoCommand(line);
    if (!line) return;
    history.push(line);
    histIdx = history.length;
    if (line.charAt(0) === "#") return;
    var parts = line.split(/\s+/);
    var name = parts[0];
    if (name === "ll") { name = "ls"; parts = ["ls", "-la"].concat(parts.slice(1)); }
    if (name === "cd") return out('<span class="c-dim">cd is a no-op here — the workspace root is always current</span>');
    if (name === "sudo") return out('<span class="c-yellow">nice try.</span>');
    if (!cmds[name]) {
      out('<span class="c-red">command not found: ' + esc(name) + "</span>  <span class=\"c-dim\">type <span class='c-cyan'>help</span></span>");
      return;
    }
    cmds[name](parts.slice(1));
  }
  function run(cmd) {
    if (window.App) App.setPanelOpen(true);
    setTab("terminal");
    exec(cmd);
  }
  function setTab(name) {
    if (window.App) App.setPanelTab(name);
  }
  function focus() {
    var input = $("#termInput");
    if (input) { input.value = buffer; input.focus(); }
  }
  function kill() {
    sessions.splice(current, 1);
    if (!sessions.length) newSession(true);
    current = Math.min(current, sessions.length - 1);
    switchTo(current);
    out('<span class="c-dim">[process exited — terminal reused]</span>');
  }

  /* ------------------------------- input IO ---------------------------- */
  function mirror() { $("#termMirror").textContent = buffer; }
  function wire() {
    var body = $("#termBody");
    var input = $("#termInput");
    body.addEventListener("click", function (e) {
      if (window.getSelection().toString()) return;
      focus();
    });
    body.addEventListener("mouseup", function () { setTimeout(focus, 0); });
    input.addEventListener("focus", function () { $("#termCursor").classList.remove("is-off"); });
    input.addEventListener("blur", function () { $("#termCursor").classList.add("is-off"); });
    input.addEventListener("input", function () {
      buffer = input.value.replace(/[\r\n]+/g, " ");
      input.value = buffer;
      mirror();
      scrollDown();
    });
    input.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        echoCommand(buffer + "^C");
        buffer = ""; input.value = ""; mirror();
        if (streamLock) out('<span class="c-dim">interrupted</span>');
        streamLock = false;
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); cmds.clear(); return; }
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

  function init() {
    wire();
    newSession(true);
  }

  window.Terminal = {
    init: init,
    run: run,
    focus: focus,
    kill: kill,
    newSession: function () { newSession(); },
    output: function (html) { out(html); }
  };
})();
