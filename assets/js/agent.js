/* agent.js — the agent panel: modes, context, scripted sessions over the real workspace. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) { return HL.esc(s); };

  var MODELS = ["HugMoss Max", "HugMoss Lite", "claude-sonnet-4.5", "gpt-4o"];
  var model = MODELS[0];
  var mode = "agent";
  var ctx = ["src/components/StatsCard.tsx", "src/hooks/useFarmData.ts"];
  var running = false;
  var token = 0;
  var timers = [];
  var streamTimer = null;
  var startedAt = 0;
  var toolCalls = 0;
  var nearBottom = true;

  var ALERT_HOOK = [
    'import { useEffect, useState } from "react";',
    "",
    'import { api } from "../api/client";',
    "",
    "export interface AlertSummary {",
    "  unread: number;",
    "  critical: number;",
    "  updatedAt: string;",
    "}",
    "",
    "const POLL_MS = 30_000;",
    "",
    "export function useAlerts(farmId: string) {",
    "  const [alerts, setAlerts] = useState<AlertSummary | null>(null);",
    "",
    "  useEffect(() => {",
    "    let cancelled = false;",
    "",
    "    async function load() {",
    "      try {",
    "        const next = await api.get<AlertSummary>(",
    "          `/farms/${farmId}/alerts/summary`,",
    "        );",
    "        if (!cancelled) setAlerts(next);",
    "      } catch {",
    "        if (!cancelled) setAlerts(null);",
    "      }",
    "    }",
    "",
    "    load();",
    "    const timer = setInterval(load, POLL_MS);",
    "    return () => {",
    "      cancelled = true;",
    "      clearInterval(timer);",
    "    };",
    "  }, [farmId]);",
    "",
    "  return alerts;",
    "}",
    ""
  ].join("\n");

  var NAVBAR_NEW = [
    'import { Bell, RefreshCw, Search } from "lucide-react";',
    "",
    'import { useAlerts } from "../hooks/useAlerts";',
    "",
    "interface NavbarProps {",
    "  onRefresh?: () => void;",
    '  farmId?: string;',
    "}",
    "",
    'export function Navbar({ onRefresh, farmId = "farm-01" }: NavbarProps) {',
    "  const alerts = useAlerts(farmId);",
    "  const unread = alerts?.unread ?? 0;",
    "",
    "  return (",
    '    <header className="navbar">',
    '      <div className="navbar__brand">',
    '        <span className="navbar__logo" aria-hidden="true">AS</span>',
    "        <div>",
    "          <strong>AgroSmart</strong>",
    '          <small>Farm telemetry console</small>',
    "        </div>",
    "      </div>",
    "",
    '      <div className="navbar__search">',
    "        <Search size={14} />",
    "        <input",
    '          type="search"',
    '          placeholder="Search sensors, fields, reports\u2026"',
    '          aria-label="Search workspace"',
    "        />",
    "      </div>",
    "",
    '      <div className="navbar__actions">',
    "        <button",
    '          className="icon-btn"',
    '          aria-label="Refresh readings"',
    "          onClick={() => onRefresh?.()}",
    "        >",
    "          <RefreshCw size={15} />",
    "        </button>",
    "        <button",
    '          className="icon-btn"',
    "          aria-label={`Notifications (${unread} unread)`}",
    "        >",
    "          <Bell size={15} />",
    '          {unread > 0 && <span className="navbar__badge">{unread > 9 ? "9+" : unread}</span>}',
    "        </button>",
    '        <span className="navbar__avatar" title="Vincent Iraguha">VI</span>',
    "      </div>",
    "    </header>",
    "  );",
    "}",
    ""
  ].join("\n");

  var CSS_BADGE = [
    ".navbar__badge {",
    "  position: absolute;",
    "  top: -3px;",
    "  right: -5px;",
    "  min-width: 16px;",
    "  height: 16px;",
    "  padding: 0 4px;",
    "  display: grid;",
    "  place-items: center;",
    "  border-radius: 999px;",
    "  background: #d6453d;",
    "  color: #fff;",
    "  font-size: 10px;",
    "  font-weight: 600;",
    "  pointer-events: none;",
    "}",
    ""
  ].join("\n");

  /* ------------------------------ utilities ---------------------------- */
  function wait(ms, fn) {
    var id = token;
    var t = setTimeout(function () { if (id === token) fn(); }, ms);
    timers.push(t);
  }
  function stopAll() {
    token++;
    timers.forEach(clearTimeout);
    timers = [];
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
  }
  function el(html) {
    var wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }
  function streamEl() { return $("#agentStream"); }
  function add(node) {
    streamEl().appendChild(node);
    follow();
    return node;
  }
  function follow() {
    var s = streamEl();
    if (nearBottom) s.scrollTop = s.scrollHeight;
  }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), r = sec % 60;
    return (m ? m + "m " : "") + r + "s";
  }
  function md(text) {
    var blocks = text.split(/\n{2,}/);
    return blocks.map(function (b) {
      var lines = b.split("\n");
      if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) {
        return "<ul>" + lines.map(function (l) { return "<li>" + inline(l.replace(/^\s*[-*]\s+/, "")) + "</li>"; }).join("") + "</ul>";
      }
      return "<p>" + lines.map(inline).join("<br>") + "</p>";
    }).join("");
  }
  function inline(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  /* ------------------------------- context ----------------------------- */
  function renderChips() {
    var host = $("#ctxChips");
    host.innerHTML = ctx.map(function (p) {
      return '<span class="ctx-chip">' + Icons.file(p) + esc(p.split("/").pop()) +
        '<button class="ctx-chip__x" data-drop="' + esc(p) + '" aria-label="Remove ' + esc(p) + '">' + Icons.ui("close", 10) + "</button></span>";
    }).join("") +
      '<button class="ctx-chip ctx-add" id="addCtx">' + Icons.ui("plus", 12) + "Add context</button>";
    $$("[data-drop]", host).forEach(function (b) {
      b.addEventListener("click", function () {
        ctx = ctx.filter(function (p) { return p !== b.getAttribute("data-drop"); });
        renderChips();
      });
    });
    $("#addCtx").addEventListener("click", function (e) {
      e.stopPropagation();
      filePop($("#addCtx"), function (path) {
        if (ctx.indexOf(path) < 0) ctx.push(path);
        renderChips();
      });
    });
  }

  function filePop(anchor, onPick, filterText) {
    closePops();
    var panel = $("#agentPanel");
    var pop = el('<div class="pop" style="max-height:260px;overflow:auto;width:280px"></div>');
    pop.innerHTML = '<div class="pop__title">Attach file</div>';
    var term = (filterText || "").toLowerCase();
    var paths = WS.visiblePaths().filter(function (p) { return !term || p.toLowerCase().indexOf(term) >= 0; }).slice(0, 30);
    if (!paths.length) pop.innerHTML += '<div class="pop__item" style="color:var(--text-3)">No file matches</div>';
    paths.forEach(function (p) {
      var item = el('<button class="pop__item">' + Icons.file(p) + esc(p.split("/").pop()) +
        '<span class="pop__sub">' + esc(p.indexOf("/") < 0 ? "." : p.slice(0, p.lastIndexOf("/"))) + "</span></button>");
      item.addEventListener("click", function () { onPick(p); closePops(); });
      pop.appendChild(item);
    });
    panel.appendChild(pop);
    var pr = panel.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(ar.left - pr.left, pr.width - 290)) + "px";
    pop.style.bottom = (pr.bottom - ar.top + 6) + "px";
  }
  function closePops() { $$(".pop").forEach(function (p) { p.remove(); }); }

  /* ------------------------------ transcript --------------------------- */
  function userBubble(text) {
    var node = el('<div class="msg msg--user"><div class="msg__ctx"></div><div class="msg__user-bubble"></div></div>');
    $(".msg__user-bubble", node).textContent = text;
    if (ctx.length) {
      $(".msg__ctx", node).innerHTML = ctx.slice(0, 3).map(function (p) {
        return '<span class="ctx-chip">' + Icons.file(p) + esc(p.split("/").pop()) + "</span>";
      }).join("");
    }
    add(node);
  }
  function agentShell() {
    var node = el('<div class="msg msg--agent"><div class="msg__agent-row">' +
      '<span class="agent-avatar">' + Icons.ui("sparkle", 13) + "</span>" +
      '<div class="msg__body"></div></div></div>');
    add(node);
    return $(".msg__body", node);
  }
  function thinking(body, label) {
    var node = el('<div class="thinking"><span class="spinner spinner--sm"></span><span class="thinking__text">' + esc(label || "Thinking") + "…</span></div>");
    body.appendChild(node);
    follow();
    return node;
  }
  function proseBlock(body) {
    var node = el('<div class="prose"></div>');
    body.appendChild(node);
    return node;
  }
  function streamProse(node, text, speed, done) {
    var words = text.split(/(\s+)/);
    var i = 0;
    streamTimer = setInterval(function () {
      i++;
      var partial = words.slice(0, i).join("");
      node.innerHTML = md(partial) + '<span class="stream-caret"></span>';
      follow();
      if (i >= words.length) {
        clearInterval(streamTimer);
        streamTimer = null;
        node.innerHTML = md(text);
        follow();
        if (done) done();
      }
    }, speed || 22);
  }

  /* ------------------------------- todos ------------------------------- */
  function todoCard(body, items) {
    var node = el('<div class="todo-card"><div class="todo-card__head">' + Icons.ui("check", 13) +
      "Plan<span class=\"todo-progress\">0/" + items.length + '</span></div><div class="todo-list"></div></div>');
    var list = $(".todo-list", node);
    items.forEach(function (text) {
      list.appendChild(el('<div class="todo-item"><span class="todo-status"><span class="todo-status--circle"></span></span>' +
        '<span class="todo-text">' + esc(text) + "</span></div>"));
    });
    body.appendChild(node);
    follow();
    return {
      node: node,
      advance: function (index, status) {
        var row = list.children[index];
        if (!row) return;
        row.className = "todo-item" + (status === "active" ? " todo-item--active" : status === "done" ? " todo-item--done" : status === "cancelled" ? " todo-item--cancelled" : "");
        var st = $(".todo-status", row);
        st.innerHTML = status === "active" ? '<span class="spinner spinner--sm"></span>'
          : status === "done" ? '<span class="todo-check">' + Icons.ui("check", 13) + "</span>"
          : status === "cancelled" ? '<span style="color:var(--danger)">' + Icons.ui("close", 12) + "</span>"
          : '<span class="todo-status--circle"></span>';
        var done = $$(".todo-item--done", list).length;
        $(".todo-progress", node).textContent = done + "/" + items.length;
        follow();
      }
    };
  }

  /* ------------------------------ tool cards --------------------------- */
  var KIND_CLASS = { Read: "read", Grep: "grep", Edit: "edit", Write: "edit", Bash: "bash", Search: "read" };

  function toolCard(body, kind, target, meta) {
    toolCalls++;
    sbBusy(true);
    var node = el('<div class="tool"><div class="tool__head">' +
      '<span class="tool__status"><span class="spinner spinner--sm"></span></span>' +
      '<span class="tool__kind tool__kind--' + KIND_CLASS[kind] + '">' + kind + "</span>" +
      '<span class="tool__target">' + esc(target) + "</span>" +
      '<span class="tool__meta">' + esc(meta || "") + "</span>" +
      '<span class="tool__chev">' + Icons.ui("chevron", 12) + "</span></div>" +
      '<div class="tool__body"></div></div>');
    $(".tool__head", node).addEventListener("click", function () { node.classList.toggle("is-open"); });
    body.appendChild(node);
    follow();
    var id = ++toolCardSeq;
    node.setAttribute("data-seq", String(id));
    return {
      node: node,
      finish: function (newMeta, bodyHtml, open) {
        if (newMeta != null) $(".tool__meta", node).textContent = newMeta;
        $(".tool__status", node).className = "tool__status tool__status--ok";
        $(".tool__status", node).innerHTML = Icons.ui("check", 13);
        if (bodyHtml) {
          $(".tool__body", node).innerHTML = bodyHtml;
          if (open) node.classList.add("is-open");
        }
        follow();
      },
      fail: function () {
        $(".tool__status", node).className = "tool__status tool__status--err";
        $(".tool__status", node).innerHTML = Icons.ui("errorCircle", 13);
      }
    };
  }
  var toolCardSeq = 0;

  function diffHtml(path, oldText, newText, limit) {
    var lines = HL.diffLines(oldText || "", newText || "");
    var changed = lines.filter(function (l) { return l.type !== "ctx"; });
    var shown = lines.filter(function (l) { return l.type !== "ctx"; }).slice(0, limit || 16);
    var html = '<div class="mini-diff">';
    shown.forEach(function (l) {
      var cls = l.type === "add" ? "md-line--add" : "md-line--del";
      html += '<div class="md-line ' + cls + '"><span class="md-line__s">' + (l.type === "add" ? "+" : "−") + "</span>" +
        '<span class="md-line__n">' + (l.b || l.a || "") + "</span>" +
        '<span class="md-line__t">' + HL.renderLine(l.text, WS.language(path)) + "</span></div>";
    });
    if (changed.length > shown.length) {
      html += '<div class="md-collapse">' + (changed.length - shown.length) + " further changed line(s) — open the file for the full diff</div>";
    }
    return html + "</div>";
  }
  function snippetHtml(path, from, to) {
    var lines = (WS.content(path) || "").split("\n").slice(from - 1, to);
    var rows = lines.map(function (ln, i) {
      return '<span class="md-line md-line--ctx"><span class="md-line__n">' + (from + i) + "</span>" +
        '<span class="md-line__t">' + (HL.renderLine(ln, WS.language(path)) || "&nbsp;") + "</span></span>";
    }).join("<br>");
    return '<div class="mini-diff" style="padding:5px 8px">' + rows + "</div>";
  }
  function grepHtml(term) {
    var hits = [];
    WS.visiblePaths().forEach(function (p) {
      (WS.content(p) || "").split("\n").forEach(function (ln, i) {
        if (ln.toLowerCase().indexOf(term.toLowerCase()) >= 0 && hits.length < 8) {
          hits.push('<span class="md-line md-line--ctx"><span class="md-line__t"><span style="color:var(--accent)">' + esc(p) + ":" + (i + 1) + "</span>  " + esc(ln.trim().slice(0, 84)) + "</span></span>");
        }
      });
    });
    return hits.length ? '<div class="mini-diff">' + hits.join("<br>") + "</div>" : '<div class="md-collapse" style="text-align:left">no matches — the capability does not exist yet</div>';
  }
  function bashBody(lines) {
    return '<div class="term-out">' + lines.join("\n") + "</div>";
  }

  function sbBusy(on) {
    var item = $("#sbCursor");
    if (!item) return;
    item.classList.toggle("is-busy", on && running);
  }

  /* --------------------------- feature session ------------------------- */
  var FEATURE_TASK = "Add a real unread-alert count badge to the navbar bell";

  function featureSession(text) {
    startedAt = Date.now();
    toolCalls = 0;
    var body = agentShell();
    var think = thinking(body, "Planning");
    var todos = null;
    var navbarOld = WS.content("src/components/Navbar.tsx");
    var cssOld = WS.content("src/index.css");

    wait(850, function () {
      think.remove();
      todos = todoCard(body, [
        "Inspect Navbar and the API client",
        "Add useAlerts polling hook",
        "Render the unread badge in Navbar + styles",
        "Type-check and build"
      ]);
      todos.advance(0, "active");
    });

    wait(1500, function () {
      var t = toolCard(body, "Read", "src/components/Navbar.tsx", "");
      wait(780, function () {
        t.finish("L1-" + navbarOld.split("\n").length + " · 46 lines", snippetHtml("src/components/Navbar.tsx", 10, 22));
      });
    });

    wait(2400, function () {
      var t = toolCard(body, "Grep", "unread", "");
      wait(620, function () { t.finish("0 matches", grepHtml("unread")); });
    });

    wait(3200, function () {
      var t = toolCard(body, "Read", "src/api/client.ts", "");
      wait(700, function () { t.finish("L1-49", snippetHtml("src/api/client.ts", 18, 30)); });
    });

    wait(4100, function () {
      todos.advance(0, "done");
      todos.advance(1, "active");
      var t = toolCard(body, "Write", "src/hooks/useAlerts.ts", "new file");
      wait(1250, function () {
        WS.files["src/hooks/useAlerts.ts"] = { language: "ts", content: ALERT_HOOK, head: "", hidden: true };
        WS.reveal("src/hooks/useAlerts.ts");
        WS.files["src/hooks/useAlerts.ts"].hidden = false;
        t.finish("+44 lines", diffHtml("src/hooks/useAlerts.ts", "", ALERT_HOOK, 9), true);
        App.scmAdd("src/hooks/useAlerts.ts", "A");
        App.treeRefresh();
        App.openFile("src/hooks/useAlerts.ts");
        App.logOutput("agent", "created src/hooks/useAlerts.ts", "out-agent");
      });
    });

    wait(5700, function () {
      todos.advance(1, "done");
      todos.advance(2, "active");
      var t = toolCard(body, "Edit", "src/components/Navbar.tsx", "");
      wait(1150, function () {
        WS.files["src/components/Navbar.tsx"].head = navbarOld;
        WS.setContent("src/components/Navbar.tsx", NAVBAR_NEW);
        var d = HL.diffLines(navbarOld, NAVBAR_NEW);
        t.finish("+" + d.filter(function (l) { return l.type === "add"; }).length + " / −" + d.filter(function (l) { return l.type === "del"; }).length,
          diffHtml("src/components/Navbar.tsx", navbarOld, NAVBAR_NEW, 12), true);
        App.scmAdd("src/components/Navbar.tsx", "M");
        App.filesChanged("src/components/Navbar.tsx");
        App.logOutput("agent", "edited src/components/Navbar.tsx", "out-agent");
      });
    });

    wait(7100, function () {
      var t = toolCard(body, "Edit", "src/index.css", "");
      wait(900, function () {
        var next = cssOld + "\n" + CSS_BADGE;
        WS.files["src/index.css"].head = cssOld;
        WS.setContent("src/index.css", next);
        t.finish("+17", diffHtml("src/index.css", cssOld, next, 10));
        App.scmAdd("src/index.css", "M");
        App.filesChanged("src/index.css");
      });
    });

    wait(8300, function () {
      todos.advance(2, "done");
      todos.advance(3, "active");
      var t = toolCard(body, "Bash", "npm run build", "");
      var log = [
        '<span class="c-dim">&gt; tsc -b && vite build</span>',
        '<span class="c-bold">vite v6.0.3</span> building for production…',
        "✓ <span class='c-green'>1285 modules transformed</span>",
        "dist/assets/index-Dp4m10.js  <span class='c-cyan'>184.61 kB</span> │ gzip: 59.6 kB",
        "✓ built in <span class='c-bold'>1.42 s</span>"
      ];
      var i = 0;
      (function pump() {
        if (!running) return;
        var partial = log.slice(0, i + 1).map(function (l) { return '<div class="term-out">' + l + "</div>"; }).join("");
        t.finish((i + 1) + "/" + log.length + " lines", '<div class="mini-diff" style="padding:6px 8px">' + partial + "</div>", true);
        i++;
        if (i < log.length) wait(240, pump);
        else {
          todos.advance(3, "done");
          App.problemsAdd({
            sev: "warn", path: "src/hooks/useAlerts.ts", line: 20, col: 5,
            msg: "Promises must be awaited — floating promise inside useEffect",
            src: "eslint(@typescript-eslint/no-floating-promises)"
          });
          finishSession(body);
        }
      })();
    });
  }

  function finishSession(body) {
    var secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    var node = el('<div class="done-meta">' + Icons.ui("check", 12) +
      "<span>Completed</span><span class=\"dot-sep\">·</span><span>" + fmtTime(secs) +
      "</span><span class=\"dot-sep\">·</span><span>" + toolCalls + " tool calls</span></div>");
    body.appendChild(node);
    var prose = proseBlock(body);
    streamProse(prose,
      "Done. The bell is now driven by **`useAlerts`**, which polls `/farms/{id}/alerts/summary` every 30 s through the existing `api` client and degrades to no badge when the request fails.\n\n" +
      "- created `src/hooks/useAlerts.ts` (44 lines)\n" +
      "- rewired `src/components/Navbar.tsx` — the decorative dot became a real count, capped at **9+**\n" +
      "- added `.navbar__badge` to `src/index.css`\n\n" +
      "`npm run build` passes in 1.42 s. One ESLint warning remains on the floating `load()` call — say the word and I will await it properly.",
      20, function () {
        var chips = el('<div class="followups"></div>');
        ["Run the tests", "Fix the ESLint warning", "Commit these changes"].forEach(function (label) {
          var c = el('<button class="fchip">' + esc(label) + "</button>");
          c.addEventListener("click", function () { submit(label); });
          chips.appendChild(c);
        });
        add(chips);
        endRun();
        App.toast({ title: "Agent session completed", msg: FEATURE_TASK + " · " + toolCalls + " tool calls", type: "agent", timeout: 5200 });
        App.logOutput("agent", "session completed in " + fmtTime(secs), "out-ok");
      });
  }

  /* ------------------------- generic mini session ---------------------- */
  function keywords(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter(function (w) { return w.length > 3 && !["with", "that", "this", "please", "could", "would", "should", "make", "add", "the", "and", "for", "from", "have", "into", "your", "when"].includes(w); });
  }
  function rankFiles(words) {
    var score = {};
    WS.visiblePaths().forEach(function (p) {
      var hay = (p + " " + (WS.content(p) || "")).toLowerCase();
      var s = words.reduce(function (acc, w) { return acc + (hay.split(w).length - 1); }, 0);
      if (s > 0) score[p] = s;
    });
    return Object.keys(score).sort(function (a, b) { return score[b] - score[a]; });
  }

  function miniSession(text) {
    startedAt = Date.now();
    toolCalls = 0;
    var body = agentShell();
    var think = thinking(body, "Searching the workspace");
    var words = keywords(text);
    var ranked = rankFiles(words);
    var target = ranked[0] || "src/components/Dashboard.tsx";
    var todos = todoCard(body, ["Locate the relevant code", "Read " + target.split("/").pop(), "Propose the change"]);

    wait(900, function () {
      think.remove();
      todos.advance(0, "active");
      var t = toolCard(body, "Grep", words[0] || text.slice(0, 18), "");
      wait(700, function () {
        t.finish(ranked.length + " files", ranked.slice(0, 5).map(function (p) {
          return '<span class="md-line md-line--ctx"><span class="md-line__t"><span style="color:var(--accent)">' + esc(p) + "</span></span></span>";
        }).join("<br>"));
        todos.advance(0, "done");
      });
    });

    wait(1900, function () {
      todos.advance(1, "active");
      var t = toolCard(body, "Read", target, "");
      wait(850, function () {
        var total = (WS.content(target) || "").split("\n").length;
        t.finish("L1-" + total, snippetHtml(target, 1, Math.min(12, total)));
        todos.advance(1, "done");
      });
    });

    wait(3000, function () {
      todos.advance(2, "active");
      var bash = /test|build|lint|run/i.test(text);
      if (bash) {
        var t = toolCard(body, "Bash", "npm test", "");
        wait(1500, function () {
          t.finish("12 passed", bashBody([
            ' <span class="c-green">✓</span> src/utils/format.test.ts <span class="c-dim">(4)</span>',
            ' <span class="c-green">✓</span> src/hooks/useFarmData.test.ts <span class="c-dim">(3)</span>',
            ' <span class="c-green">✓</span> src/components/StatsCard.test.tsx <span class="c-dim">(5)</span>'
          ]), true);
        });
        wait(2100, function () { todos.advance(2, "done"); miniAnswer(text, body, ranked); });
      } else {
        wait(600, function () { todos.advance(2, "done"); miniAnswer(text, body, ranked); });
      }
    });
  }

  function miniAnswer(text, body, ranked) {
    var files = ranked.slice(0, 3);
    var node = proseBlock(body);
    var answer = files.length
      ? "I traced your request through the workspace. The behaviour you are asking about lives in **" + files[0] + "**" +
        (files[1] ? ", with supporting logic in `" + files[1] + "`" : "") + (files[2] ? " and `" + files[2] + "`" : "") + ".\n\n" +
        "Here is what I would do:\n" +
        "- extend the state returned by the hook that owns this screen\n" +
        "- keep the component presentational and pass the value down as a prop\n" +
        "- cover it with a unit test next to the existing ones\n\n" +
        "Switch to **Plan** mode if you want the full breakdown first, or tell me to go ahead and I will edit the files and run the build."
      : "I could not pin this to a file in `agrosmart-dashboard` yet. Try mentioning the file with **@**, or describe the change in terms of a screen — for example “the stats cards on the dashboard”. " +
        "The agent can read, search, edit and run inside this workspace, so a concrete target gets a concrete diff.";
    streamProse(node, answer, 18, function () {
      var chips = el('<div class="followups"></div>');
      ["Show me the plan", FEATURE_TASK].forEach(function (label) {
        var c = el('<button class="fchip">' + esc(label) + "</button>");
        c.addEventListener("click", function () {
          if (label === FEATURE_TASK) submit(label);
          else { setMode("plan"); submit("Plan the alert badge work"); }
        });
        chips.appendChild(c);
      });
      add(chips);
      endRun();
    });
  }

  /* ------------------------------ ask mode ----------------------------- */
  function askSession(text) {
    startedAt = Date.now();
    toolCalls = 0;
    var body = agentShell();
    var think = thinking(body, "Reading the project");
    var ranked = rankFiles(keywords(text));
    wait(1100, function () {
      think.remove();
      var node = proseBlock(body);
      var isArch = /architect|structure|explain|how does|project|overview/i.test(text);
      var answer = isArch
        ? "**agrosmart-dashboard** is a Vite + React 19 + TypeScript front end for farm telemetry, in four layers:\n\n" +
          "- `src/api/client.ts` — a typed `fetch` wrapper with an 8 s abort timeout and an `ApiError` class\n" +
          "- `src/hooks/useFarmData.ts` — owns `data`, `isLoading`, `error` and `refresh` for a selected range\n" +
          "- `src/components/*` — presentational pieces: `Navbar`, `Sidebar`, `Dashboard`, `StatsCard`, `Skeleton`\n" +
          "- `src/utils/format.ts` — locale-aware number and delta formatting\n\n" +
          "Data flows one way: `Dashboard` picks a range, the hook fetches readings, cards render them. Nothing talks to `fetch` directly, which is why the alert badge can reuse the same client. Want me to trace a specific path, or add something?"
        : (ranked.length
          ? "Based on `" + ranked[0] + "`" + (ranked[1] ? " and `" + ranked[1] + "`" : "") + ": " +
            "this workspace keeps state in hooks and presentation in components, so the answer to “" + text.replace(/\s+/g, " ").trim().slice(0, 60) + "” is to change the hook that owns that state rather than the component.\n\n" +
            "Ask in **Agent** mode if you want me to make the edit — I will read the files, show a diff, and run the build before I call it done."
          : "I read this project as a farm-telemetry dashboard: an API client, one data hook, and a small component tree. I could not find a match for that phrasing in the workspace — try naming a file with **@**, or ask me to explain the architecture.");
      streamProse(node, answer, 18, endRun);
    });
  }

  /* ------------------------------ plan mode ---------------------------- */
  function planSession(text) {
    startedAt = Date.now();
    var body = agentShell();
    var think = thinking(body, "Drafting a plan");
    var ranked = rankFiles(keywords(text));
    wait(1200, function () {
      think.remove();
      var intro = proseBlock(body);
      intro.innerHTML = md("Here is how I would approach **“" + text.replace(/\s+/g, " ").trim().slice(0, 72) + "**. Review it, then approve and I will execute with the same diff-and-build discipline.");
      var steps = [
        ["Map the current code", "Read " + (ranked[0] || "src/components/Dashboard.tsx") + " and its data hook before touching anything."],
        ["Introduce the state", "Extend the owning hook so the component stays presentational and testable."],
        ["Wire the UI", "Render the new branch with a skeleton/loading state — no layout shift while data resolves."],
        ["Style it", "Add the scoped CSS in src/index.css next to the existing .navbar/.stats rules."],
        ["Verify", "Run `npm run build`, then `npm test`, and fix any ESLint findings before reporting back."]
      ];
      var card = el('<div class="plan-card"><div class="plan-card__head">' + Icons.ui("bookOpen", 14) +
        "Plan · read-only mode</div><ol class=\"plan-steps\"></ol>" +
        '<div class="plan-card__foot"><button class="btn btn--accent" data-approve>Approve &amp; build</button>' +
        '<button class="btn btn--ghost" data-exit>Exit Plan Mode</button></div></div>');
      $(".plan-steps", card).innerHTML = steps.map(function (s, i) {
        return '<li class="plan-step"><span class="plan-step__n">' + (i + 1) + "</span>" +
          '<span class="plan-step__t"><strong>' + esc(s[0]) + "</strong><em>" + esc(s[1]) + "</em></span></li>";
      }).join("");
      body.appendChild(card);
      follow();
      $("[data-approve]", card).addEventListener("click", function () {
        setMode("agent");
        submit("Approve: " + text);
      });
      $("[data-exit]", card).addEventListener("click", function () {
        setMode("agent");
        App.toast({ title: "Plan mode exited", msg: "Agent mode is now active", type: "info" });
        card.remove();
        var done = el('<div class="done-meta">' + Icons.ui("check", 12) + "<span>Plan discarded · mode switched to Agent</span></div>");
        body.appendChild(done);
        endRun();
      });
      var meta = el('<div class="done-meta">' + Icons.ui("infoCircle", 12) +
        "<span>Plan mode is read-only — no files were touched</span></div>");
      body.appendChild(meta);
      endRun();
    });
  }

  /* ------------------------------- control ----------------------------- */
  function beginRun() {
    running = true;
    token++;
    timers.forEach(clearTimeout);
    timers = [];
    var btn = $("#sendBtn");
    btn.disabled = false;
    btn.classList.add("send-btn--stop");
    btn.innerHTML = Icons.ui("stop", 15);
    btn.setAttribute("aria-label", "Stop agent");
    $("#agentSessionName").textContent = "running · " + model;
    sbBusy(true);
  }
  function endRun() {
    running = false;
    var btn = $("#sendBtn");
    btn.classList.remove("send-btn--stop");
    btn.innerHTML = Icons.ui("send", 15);
    btn.setAttribute("aria-label", "Send message");
    btn.disabled = !$("#agentInput").value.trim();
    $("#agentSessionName").textContent = "Session " + App.clock();
    sbBusy(false);
    follow();
  }
  function halt() {
    stopAll();
    $$(".todo-item--active").forEach(function (row) {
      row.className = "todo-item todo-item--cancelled";
      $(".todo-status", row).innerHTML = '<span style="color:var(--danger)">' + Icons.ui("close", 12) + "</span>";
    });
    $$(".tool .spinner").forEach(function (sp) {
      var host = sp.closest(".tool");
      $(".tool__status", host).className = "tool__status tool__status--err";
      $(".tool__status", host).innerHTML = Icons.ui("close", 13);
    });
    var body = $$(".msg--agent .msg__body").pop() || streamEl();
    body.appendChild(el('<div class="stopped-banner">' + Icons.ui("warning", 13) + "<span>Stopped by user — partial edits are still in the working tree</span></div>"));
    App.logOutput("agent", "session stopped by user", "out-warn");
    App.toast({ title: "Agent stopped", msg: toolCalls + " tool call(s) before the halt", type: "warn" });
    endRun();
    follow();
  }

  function hideEmpty() {
    var empty = $("#agentEmpty");
    if (empty) empty.hidden = true;
  }

  function submit(text) {
    text = (text || "").trim();
    if (!text || running) return;
    hideEmpty();
    userBubble(text);
    $("#agentInput").value = "";
    autosize();
    $("#sendBtn").disabled = true;
    beginRun();
    if (mode === "plan") return planSession(text);
    if (mode === "ask") return askSession(text);
    if (/alert|badge|notification|unread|bell/i.test(text)) return featureSession(text);
    return miniSession(text);
  }

  /* ------------------------------ composer ----------------------------- */
  function autosize() {
    var ta = $("#agentInput");
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
  }
  function setMode(next) {
    mode = next;
    $$(".mpill").forEach(function (p) { p.classList.toggle("mpill--active", p.getAttribute("data-mode") === next); });
    var sel = $("#agentModeSelect");
    if (sel && sel.value !== next) sel.value = next;
    $("#agentInput").placeholder = next === "plan"
      ? "Describe a goal — the agent will plan without editing files"
      : next === "ask"
        ? "Ask about this codebase (read-only)"
        : "Ask anything, or describe a task… (@ to mention files)";
  }
  function modelPop(anchor) {
    closePops();
    var panel = $("#agentPanel");
    var pop = el('<div class="pop" style="width:210px"></div>');
    pop.innerHTML = '<div class="pop__title">Model</div>';
    MODELS.forEach(function (m) {
      var item = el('<button class="pop__item">' + Icons.ui("sparkle", 14) + esc(m) +
        (m === model ? '<span class="pop__check">' + Icons.ui("check", 13) + "</span>" : "") + "</button>");
      item.addEventListener("click", function () {
        model = m;
        $("#modelName").textContent = m;
        closePops();
        App.toast({ title: m, msg: m === "HugMoss Max" ? "Longest horizon, tool use enabled" : "Model switched for this session", type: "info", timeout: 2600 });
      });
      pop.appendChild(item);
    });
    panel.appendChild(pop);
    var pr = panel.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(ar.left - pr.left - 60, pr.width - 220)) + "px";
    pop.style.bottom = (pr.bottom - ar.top + 6) + "px";
  }

  function historyPop(anchor) {
    closePops();
    var panel = $("#agentPanel");
    var pop = el('<div class="pop" style="width:300px"></div>');
    pop.innerHTML = '<div class="pop__title">Recent sessions</div>';
    var items = [
      { t: "Add loading skeletons to stats cards", s: "Completed · 12:44 · 6 tool calls", kind: "skeleton" },
      { t: "Why is the humidity reading clamped?", s: "Completed · 12:31 · read-only", kind: "clamp" },
      { t: "Split Dashboard.tsx into panels", s: "Stopped by user · yesterday", kind: "stopped" }
    ];
    items.forEach(function (it) {
      var b = el('<button class="pop__item">' + Icons.ui("history", 14) +
        '<span style="min-width:0"><span style="display:block;color:var(--text-1)">' + esc(it.t) + "</span>" +
        '<span style="display:block;font-size:10.5px;color:var(--text-3)">' + esc(it.s) + "</span></span></button>");
      b.addEventListener("click", function () { closePops(); loadTranscript(it.kind); });
      pop.appendChild(b);
    });
    panel.appendChild(pop);
    var pr = panel.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(ar.left - pr.left - 200, pr.width - 310)) + "px";
    pop.style.top = (ar.bottom - pr.top + 4) + "px";
  }

  function loadTranscript(kind) {
    hideEmpty();
    streamEl().innerHTML = "";
    stopAll();
    endRun();
    var scripts = {
      skeleton: {
        q: "Add a loading skeleton to the stats cards",
        a: "Added `Skeleton.tsx` and drove it from `isLoading` in `useFarmData`, so the grid keeps its shape while readings resolve. Build passed in 1.34 s — those three files are still uncommitted in Source Control."
      },
      clamp: {
        q: "Why is humidity clamped to 0-100?",
        a: "Sensors drift above 100 % on wet mornings and the chart axis broke. `b21e80d` clamps in the mapping layer so the visual stays honest while the raw value is preserved for export."
      },
      stopped: {
        q: "Split Dashboard.tsx into panels",
        a: "Stopped after reading the file. The component is 118 lines — the split into `Panels/` would be a good first task if you want it."
      }
    }[kind];
    userBubble(scripts.q);
    var body = agentShell();
    proseBlock(body).innerHTML = md(scripts.a);
    add(el('<div class="done-meta">' + Icons.ui("bookOpen", 12) + "<span>Past session · read-only view</span></div>"));
    follow();
  }

  function suggest(title, sub, icon) {
    var b = el('<button class="sugg"><span class="sugg__icon">' + Icons.ui(icon, 15) + "</span>" +
      '<span class="sugg__text">' + esc(title) + "<em>" + esc(sub) + "</em></span></button>");
    b.addEventListener("click", function () { submit(title); });
    return b;
  }

  function newSession() {
    stopAll();
    running = false;
    endRun();
    streamEl().innerHTML =
      '<div class="agent__empty" id="agentEmpty"><div class="agent__empty-mark">' + Icons.ui("sparkleLarge", 30) + "</div>" +
      '<h3 class="agent__empty-title">Hi Vincent, I&rsquo;m your coding agent</h3>' +
      '<p class="agent__empty-credit">Built by IRAGUHA Vincent</p>' +
      '<div class="agent__suggestions" id="agentSuggestions"></div></div>';
    mountSuggestions();
    toolCalls = 0;
    $("#agentInput").value = "";
    autosize();
  }
  function mountSuggestions() {
    var host = $("#agentSuggestions");
    if (!host) return;
    host.innerHTML = "";
    host.appendChild(suggest("Explain the dashboard architecture", "read-only tour of src/", "bookOpen"));
    host.appendChild(suggest(FEATURE_TASK, "new hook + navbar diff + build", "sparkle"));
    host.appendChild(suggest("Fix the ESLint warning in useAlerts", "await the floating promise", "check"));
  }

  /* -------------------------------- boot ------------------------------- */
  function wire() {
    mountSuggestions();
    renderChips();
    setMode(App.settings.agentMode || "agent");

    var ta = $("#agentInput");
    ta.addEventListener("input", function () {
      autosize();
      $("#sendBtn").disabled = !ta.value.trim() || running;
      var m = ta.value.match(/(?:^|\s)@([\w./-]*)$/);
      if (m) filePop(ta, function (path) {
        if (ctx.indexOf(path) < 0) ctx.push(path);
        renderChips();
        ta.value = ta.value.replace(/@[\w./-]*$/, "");
        autosize();
        ta.focus();
      }, m[1]);
    });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(ta.value); }
      if (e.key === "Escape") closePops();
    });
    $("#sendBtn").addEventListener("click", function () {
      if (running) halt();
      else submit(ta.value);
    });
    $$(".mpill").forEach(function (p) {
      p.addEventListener("click", function () { setMode(p.getAttribute("data-mode")); });
    });
    $("#modelBtn").addEventListener("click", function (e) { e.stopPropagation(); modelPop($("#modelBtn")); });
    $("#agentHistoryBtn").addEventListener("click", function (e) { e.stopPropagation(); historyPop($("#agentHistoryBtn")); });
    $("#agentNewChatBtn").addEventListener("click", newSession);
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".pop") && !e.target.closest("#modelBtn") && !e.target.closest("#addCtx") && !e.target.closest("#agentHistoryBtn")) closePops();
    });

    var s = streamEl();
    s.addEventListener("scroll", function () {
      nearBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 60;
      $("#agentJump").hidden = nearBottom;
    });
    $("#agentJump").addEventListener("click", function () {
      nearBottom = true;
      s.scrollTop = s.scrollHeight;
      $("#agentJump").hidden = true;
    });
    $("#modelName").textContent = model;
  }

  window.Agent = {
    init: wire,
    submit: submit,
    setMode: setMode,
    getMode: function () { return mode; },
    newSession: newSession,
    focusInput: function () { $("#agentInput").focus(); },
    isRunning: function () { return running; },
    runDemo: function () { setMode("agent"); submit(FEATURE_TASK); }
  };
})();
