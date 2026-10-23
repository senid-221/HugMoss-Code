/* agent.js — a real tool-using agent over the open folder, streamed from the selected provider. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) { return HL.esc(s); };

  var mode = "agent";
  var running = false;
  var halted = false;
  var abort = null;
  var startedAt = 0;
  var toolCalls = 0;
  var ctx = [];
  var messages = [];
  var session = null;
  var todoApi = null;
  var pendingApproval = null;
  var nearBottom = true;
  var streamTimer = null;
  var lastPrompt = "";
  var usageTotals = null;
  var toolCardSeq = 0;

  var MAX_ROUNDS = 10;
  var MAX_HISTORY = 30;
  var STORE = "hugmoss.sessions.v1";

  /* ------------------------------ utilities ---------------------------- */
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), r = Math.round(sec % 60);
    return (m ? m + "m " : "") + r + "s";
  }
  function fmtTokens(n) {
    if (!n) return "";
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
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
  function hideEmpty() {
    var empty = $("#agentEmpty");
    if (empty) empty.hidden = true;
  }
  function paint(node, color) {
    if (!node) return;
    if (color && color !== "currentColor") node.style.color = color;
    else node.style.removeProperty("color");
  }

  /* ---------------------------- markdown ------------------------------- */
  var MD_LANG = {
    js: "js", javascript: "js", jsx: "jsx", ts: "ts", typescript: "ts", tsx: "tsx",
    json: "json", css: "css", scss: "css", html: "html", xml: "html", svg: "svg",
    md: "md", markdown: "md"
  };
  function inline(text) {
    return esc(text)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function renderCode(lang, code) {
    var key = MD_LANG[String(lang || "").toLowerCase()] || "txt";
    var html = HL.render(code.replace(/\n$/, ""), key).join("\n");
    return '<pre class="md-pre" data-lang="' + esc(lang || "code") + '"><code>' + html + "</code></pre>";
  }
  function md(text) {
    var source = String(text || "");
    var out = [];
    var re = /```([\w+.-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
    var last = 0, m;
    while ((m = re.exec(source))) {
      out.push(renderProse(source.slice(last, m.index)));
      out.push(renderCode(m[1], m[2]));
      last = m.index + m[0].length;
    }
    out.push(renderProse(source.slice(last)));
    return out.join("");
  }
  function renderProse(chunk) {
    var lines = String(chunk || "").split("\n");
    var html = [];
    var list = null;
    var para = [];

    function flushPara() {
      if (para.length) {
        html.push("<p>" + para.map(inline).join("<br>") + "</p>");
        para = [];
      }
    }
    function flushList() {
      if (list) {
        html.push("<" + list.tag + ">" + list.items.map(function (it) { return "<li>" + inline(it) + "</li>"; }).join("") + "</" + list.tag + ">");
        list = null;
      }
    }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, "");
      var head = line.match(/^(#{1,4})\s+(.*)$/);
      var bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      var ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      var quote = line.match(/^\s*>\s?(.*)$/);
      if (!line.trim()) { flushPara(); flushList(); return; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(); flushList(); html.push("<hr>"); return; }
      if (head) {
        flushPara(); flushList();
        var level = Math.min(4, head[1].length + 2);
        html.push("<h" + level + ">" + inline(head[2]) + "</h" + level + ">");
        return;
      }
      if (bullet || ordered) {
        flushPara();
        var tag = bullet ? "ul" : "ol";
        if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
        list.items.push((bullet || ordered)[1]);
        return;
      }
      if (quote) {
        flushPara(); flushList();
        html.push("<blockquote>" + inline(quote[1]) + "</blockquote>");
        return;
      }
      flushList();
      para.push(line);
    });
    flushPara();
    flushList();
    return html.join("");
  }

  /* ------------------------------- context ----------------------------- */
  function renderChips() {
    var host = $("#ctxChips");
    if (!host) return;
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
    var btn = $("#addCtx");
    if (btn) btn.addEventListener("click", function (e) {
      e.stopPropagation();
      filePop(btn, function (path) {
        if (ctx.indexOf(path) < 0 && ctx.length < 8) ctx.push(path);
        renderChips();
      });
    });
  }

  function closePops() { $$(".pop").forEach(function (p) { p.remove(); }); }

  function filePop(anchor, onPick, filterText) {
    closePops();
    var panel = $("#agentPanel");
    var pop = el('<div class="pop" style="max-height:280px;overflow:auto;width:300px"></div>');
    pop.innerHTML = '<div class="pop__title">Attach file</div>';
    var term = (filterText || "").toLowerCase();
    var paths = WS.visiblePaths().filter(function (p) { return !term || p.toLowerCase().indexOf(term) >= 0; }).slice(0, 60);
    if (!WS.loaded) {
      pop.innerHTML += '<div class="pop__empty">Open a folder to attach files.</div>';
    } else if (!paths.length) {
      pop.innerHTML += '<div class="pop__empty">No file matches.</div>';
    }
    paths.forEach(function (p) {
      var secret = WS.isSecret(p);
      var item = el('<button class="pop__item' + (secret ? " pop__item--disabled" : "") + '">' + Icons.file(p) + esc(p.split("/").pop()) +
        '<span class="pop__sub">' + (secret ? "secret · not sent" : esc(p.indexOf("/") < 0 ? "." : p.slice(0, p.lastIndexOf("/")))) + "</span></button>");
      if (!secret) item.addEventListener("click", function () { onPick(p); closePops(); });
      pop.appendChild(item);
    });
    panel.appendChild(pop);
    var pr = panel.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(ar.left - pr.left, pr.width - 310)) + "px";
    pop.style.bottom = (pr.bottom - ar.top + 6) + "px";
  }

  /* ------------------------------ transcript --------------------------- */
  function userBubble(text) {
    var node = el('<div class="msg msg--user"><div class="msg__ctx"></div><div class="msg__user-bubble"></div></div>');
    $(".msg__user-bubble", node).textContent = text;
    if (ctx.length) {
      $(".msg__ctx", node).innerHTML = ctx.slice(0, 4).map(function (p) {
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
    follow();
    return node;
  }

  /* -------------------------------- todos ------------------------------ */
  function todoCard(body, items) {
    if (todoApi) { todoApi.set(items); return todoApi; }
    var node = el('<div class="todo-card"><div class="todo-card__head">' + Icons.ui("check", 13) +
      'Plan<span class="todo-progress">0/' + items.length + '</span></div><div class="todo-list"></div></div>');
    var list = $(".todo-list", node);
    body.appendChild(node);
    follow();
    var api = {
      node: node,
      set: function (next) {
        items = next;
        list.innerHTML = items.map(function (it) {
          var status = it.status || "pending";
          var statusHtml = status === "active" ? '<span class="spinner spinner--sm"></span>'
            : status === "done" ? '<span class="todo-check">' + Icons.ui("check", 13) + "</span>"
            : status === "cancelled" ? '<span style="color:var(--danger)">' + Icons.ui("close", 12) + "</span>"
            : '<span class="todo-status--circle"></span>';
          return '<div class="todo-item' + (status === "active" ? " todo-item--active" : status === "done" ? " todo-item--done" : status === "cancelled" ? " todo-item--cancelled" : "") + '">' +
            '<span class="todo-status">' + statusHtml + "</span>" +
            '<span class="todo-text">' + esc(it.text) + "</span></div>";
        }).join("");
        var done = items.filter(function (it) { return it.status === "done"; }).length;
        $(".todo-progress", node).textContent = done + "/" + items.length;
        follow();
      },
      cancel: function () {
        api.set(items.map(function (it) {
          return { text: it.text, status: it.status === "done" ? "done" : "cancelled" };
        }));
      }
    };
    api.set(items);
    todoApi = api;
    return api;
  }

  /* ------------------------------ tool cards --------------------------- */
  var TOOL_META = {
    list_files: { label: "List", cls: "read" },
    read_file: { label: "Read", cls: "read" },
    search: { label: "Search", cls: "grep" },
    write_file: { label: "Write", cls: "edit" },
    delete_file: { label: "Delete", cls: "bash" },
    update_todos: { label: "Plan", cls: "read" }
  };

  function toolCard(body, name, target, meta) {
    var spec = TOOL_META[name] || { label: name, cls: "read" };
    var node = el('<div class="tool"><div class="tool__head">' +
      '<span class="tool__status"><span class="spinner spinner--sm"></span></span>' +
      '<span class="tool__kind tool__kind--' + spec.cls + '">' + esc(spec.label) + "</span>" +
      '<span class="tool__target">' + esc(target || "") + "</span>" +
      '<span class="tool__meta">' + esc(meta || "") + "</span>" +
      '<span class="tool__chev">' + Icons.ui("chevron", 12) + "</span></div>" +
      '<div class="tool__body"></div></div>');
    $(".tool__head", node).addEventListener("click", function () { node.classList.toggle("is-open"); });
    body.appendChild(node);
    follow();
    toolCardSeq++;
    toolCalls++;
    return {
      node: node,
      setMeta: function (text) { $(".tool__meta", node).textContent = text; },
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
      fail: function (message) {
        $(".tool__status", node).className = "tool__status tool__status--err";
        $(".tool__status", node).innerHTML = Icons.ui("errorCircle", 13);
        if (message) $(".tool__body", node).innerHTML = '<div class="tool__error">' + esc(message) + "</div>";
        follow();
      },
      cancel: function () {
        $(".tool__status", node).className = "tool__status tool__status--err";
        $(".tool__status", node).innerHTML = Icons.ui("close", 13);
      }
    };
  }

  function diffHtml(oldText, newText, limit) {
    var changed = HL.diffLines(oldText || "", newText || "").filter(function (l) { return l.type !== "ctx"; });
    var shown = changed.slice(0, limit || 30);
    var html = '<div class="mini-diff">';
    shown.forEach(function (l) {
      var cls = l.type === "add" ? "md-line--add" : "md-line--del";
      html += '<div class="md-line ' + cls + '"><span class="md-line__s">' + (l.type === "add" ? "+" : "−") + "</span>" +
        '<span class="md-line__n">' + (l.b || l.a || "") + "</span>" +
        '<span class="md-line__t">' + (HL.renderLine(l.text, "txt") || "&nbsp;") + "</span></div>";
    });
    if (changed.length > shown.length) html += '<div class="md-collapse">' + (changed.length - shown.length) + " more changed line(s)</div>";
    return html + "</div>";
  }
  function diffStat(oldText, newText) {
    var lines = HL.diffLines(oldText || "", newText || "");
    var adds = 0, dels = 0;
    lines.forEach(function (l) { if (l.type === "add") adds++; if (l.type === "del") dels++; });
    return { adds: adds, dels: dels };
  }
  function snippetHtml(content, limit) {
    return '<div class="mini-diff" style="padding:6px 9px">' + String(content || "").split("\n").slice(0, limit || 14).map(function (line, i) {
      return '<span class="md-line md-line--ctx"><span class="md-line__n">' + (i + 1) + "</span>" +
        '<span class="md-line__t">' + (HL.renderLine(line, "txt") || "&nbsp;") + "</span></span>";
    }).join("<br>") + "</div>";
  }

  function approvalCard(body, opts) {
    return new Promise(function (resolve) {
      var stat = diffStat(opts.oldText, opts.newText);
      var node = el('<div class="approval"><div class="approval__head">' +
        Icons.ui(opts.action === "delete" ? "trash" : "pencil", 14) +
        "<span>" + esc(opts.action === "delete" ? "Approve deletion" : "Approve change") + "</span>" +
        '<span class="approval__stat"><b class="c-green">+' + stat.adds + '</b> <b class="c-red">−' + stat.dels + "</b></span></div>" +
        '<div class="approval__path">' + Icons.file(opts.path) + esc(opts.path) + "</div>" +
        '<div class="approval__note"></div>' + diffHtml(opts.oldText, opts.newText, 40) +
        '<div class="approval__foot"><button class="btn btn--accent btn--sm" data-apply>Apply</button>' +
        '<button class="btn btn--ghost btn--sm" data-discard>Discard</button>' +
        '<span class="approval__hint">The agent is waiting</span></div></div>');

      if (WS.isDirty(opts.path)) {
        $(".approval__note", node).textContent = "This file has unsaved edits in the editor; applying replaces them.";
      } else if (WS.readonly) {
        $(".approval__note", node).textContent = "This workspace is read-only, so the change cannot be written to disk.";
      } else if (!WS.loaded) {
        $(".approval__note", node).textContent = "No folder is open; there is nowhere to write this change.";
      }
      body.appendChild(node);
      follow();

      var settled = false;
      function settle(ok) {
        if (settled) return;
        settled = true;
        pendingApproval = null;
        node.classList.add(ok ? "is-applied" : "is-discarded");
        $$("button", $(".approval__foot", node)).forEach(function (b) { b.disabled = true; });
        $(".approval__hint", node).textContent = ok ? "Approved" : "Discarded";
        resolve(ok);
      }
      $("[data-apply]", node).addEventListener("click", function () { settle(true); });
      $("[data-discard]", node).addEventListener("click", function () { settle(false); });
      if (WS.readonly || !WS.loaded) $("[data-apply]", node).disabled = true;
      pendingApproval = { cancel: function () { settle(false); } };
    });
  }

  /* ------------------------------- tools ------------------------------- */
  function toolSpecs() {
    var specs = [
      {
        name: "list_files",
        description: "List files in the open workspace. Optionally pass a folder path to list only that subtree.",
        parameters: { type: "object", properties: { path: { type: "string", description: "Folder path relative to the workspace root." } } }
      },
      {
        name: "read_file",
        description: "Read a UTF-8 text file from the workspace. Always read a file before proposing changes to it.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to the workspace root." },
            start_line: { type: "integer", description: "First line to return (1-based)." },
            end_line: { type: "integer", description: "Last line to return (inclusive)." }
          },
          required: ["path"]
        }
      },
      {
        name: "search",
        description: "Search the workspace contents. Returns matching file paths, line numbers and text.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Literal text or regular expression to find." },
            regex: { type: "boolean", description: "Treat query as a regular expression." }
          },
          required: ["query"]
        }
      }
    ];
    if (mode === "ask") return specs;
    specs.push({
      name: "update_todos",
      description: "Maintain the visible task plan. Use this for work with three or more steps.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                status: { type: "string", enum: ["pending", "active", "done", "cancelled"] }
              },
              required: ["text", "status"]
            }
          }
        },
        required: ["items"]
      }
    });
    if (mode === "plan") return specs;
    specs.push({
      name: "write_file",
      description: "Create or replace a file in the workspace. The user must approve every write; include the complete final file content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the workspace root." },
          content: { type: "string", description: "The complete new file content." },
          summary: { type: "string", description: "One line describing the change." }
        },
        required: ["path", "content"]
      }
    });
    specs.push({
      name: "delete_file",
      description: "Delete a file from the workspace. The user must approve the deletion.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          reason: { type: "string" }
        },
        required: ["path"]
      }
    });
    return specs;
  }

  async function executeTool(call, body) {
    var args = call.args || {};
    var name = call.name;
    try {
      if (name === "update_todos") {
        var items = Array.isArray(args.items) ? args.items.map(function (it) {
          return typeof it === "string" ? { text: it, status: "pending" } : { text: String(it.text || ""), status: it.status || "pending" };
        }).filter(function (it) { return it.text; }) : [];
        if (!items.length) return "No todos were provided.";
        todoCard(body, items);
        return "Plan updated: " + items.map(function (it) { return "[" + it.status + "] " + it.text; }).join("; ");
      }

      if (name === "list_files") {
        var cardL = toolCard(body, name, args.path || ".", "");
        var listing = WS.listForAgent(args.path || "");
        cardL.finish(WS.visiblePaths().length + " files", '<pre class="tool__pre">' + esc(listing.slice(0, 4000)) + "</pre>", false);
        return listing;
      }

      if (name === "read_file") {
        var read = WS.readForAgent(args.path || "");
        if (!read.ok) {
          var cardErr = toolCard(body, name, args.path || "", "");
          cardErr.fail(read.error);
          return "Error: " + read.error;
        }
        var all = read.content.split("\n");
        var from = Math.max(1, Number(args.start_line) || 1);
        var to = Math.min(all.length, Number(args.end_line) || Math.min(all.length, from + 499));
        if (to < from) to = Math.min(all.length, from + 499);
        var slice = all.slice(from - 1, to);
        var numbered = slice.map(function (line, i) {
          return String(from + i).padStart(5, " ") + "│ " + line;
        }).join("\n");
        if (numbered.length > 40000) numbered = numbered.slice(0, 40000) + "\n… output truncated";
        var cardR = toolCard(body, name, args.path, "");
        cardR.finish("L" + from + "–" + to + " of " + all.length, snippetHtml(slice.join("\n"), 16), false);
        return "File: " + read.path + " (lines " + from + "–" + to + " of " + all.length + ")\n\n" + numbered;
      }

      if (name === "search") {
        var cardS = toolCard(body, name, args.query || "", "");
        var found = WS.searchAll(args.query || "", { regex: !!args.regex });
        if (!found.ok) { cardS.fail(found.error); return "Error: " + found.error; }
        var hitText = found.hits.map(function (h) { return h.path + ":" + h.line + ": " + h.text; }).join("\n");
        cardS.finish(found.hits.length + " match" + (found.hits.length === 1 ? "" : "es"), found.hits.length
          ? '<div class="mini-diff" style="padding:6px 9px">' + found.hits.slice(0, 20).map(function (h) {
              return '<span class="md-line md-line--ctx"><span class="md-line__t"><span class="c-accent">' + esc(h.path + ":" + h.line) + "</span>  " + esc(h.text.slice(0, 110)) + "</span></span>";
            }).join("<br>") + "</div>"
          : '<div class="tool__error">No matches.</div>', true);
        return found.hits.length ? hitText + (found.truncated ? "\n… results truncated" : "") : "No matches for " + args.query;
      }

      if (name === "write_file") {
        var path = WS.normalize(args.path || "");
        if (!path) return "Error: a file path is required.";
        if (typeof args.content !== "string") return "Error: content must be a string.";
        var rec = WS.record(path);
        var oldText = rec && !rec.deleted ? rec.content : "";
        var stat = diffStat(oldText, args.content);
        var cardW = toolCard(body, name, path, stat.adds + " additions, " + stat.dels + " deletions");
        if (WS.readonly) {
          cardW.fail("This workspace is read-only, so the agent cannot write files.");
          return "Error: the workspace is read-only. Ask the user to reopen the folder with write access.";
        }
        if (oldText === args.content) {
          cardW.finish("no change", null);
          return "The file already has that content; nothing was written.";
        }
        var approved = await approvalCard(body, { path: path, oldText: oldText, newText: args.content, action: "write" });
        if (halted) { cardW.cancel(); return "The user stopped the agent before this change was applied."; }
        if (!approved) {
          cardW.finish("discarded", null);
          return "The user discarded this change. Do not retry it unless asked.";
        }
        cardW.setMeta("writing…");
        var written = await WS.agentWrite(path, args.content);
        if (!written.ok) {
          cardW.fail(written.error);
          return "Error: " + written.error;
        }
        cardW.finish("+" + stat.adds + " −" + stat.dels, diffHtml(oldText, args.content, 18), true);
        App.treeRefresh();
        App.filesChanged(path);
        App.logOutput("agent", (written.created ? "created " : "updated ") + path, "out-agent");
        return "Applied to " + path + " (+" + stat.adds + " −" + stat.dels + "). The change is already on disk.";
      }

      if (name === "delete_file") {
        var delPath = WS.normalize(args.path || "");
        var delRec = WS.record(delPath);
        if (!delRec || delRec.deleted) return "Error: file not found: " + args.path;
        if (WS.readonly) return "Error: the workspace is read-only.";
        var cardD = toolCard(body, name, delPath, "");
        var approvedDel = await approvalCard(body, { path: delPath, oldText: delRec.content, newText: "", action: "delete" });
        if (halted) { cardD.cancel(); return "The user stopped the agent."; }
        if (!approvedDel) { cardD.finish("discarded", null); return "The user discarded this deletion."; }
        var deleted = await WS.agentDelete(delPath);
        if (!deleted.ok) { cardD.fail(deleted.error); return "Error: " + deleted.error; }
        cardD.finish("deleted", diffHtml(delRec.content, "", 10), true);
        if (App.fileRemoved) App.fileRemoved(delPath);
        App.treeRefresh();
        App.logOutput("agent", "deleted " + delPath, "out-warn");
        return "Deleted " + delPath + ". The user can restore it from Source Control.";
      }

      return "Error: unknown tool " + name + ".";
    } catch (err) {
      return "Error: " + (err && err.message || "tool failed");
    }
  }

  /* ------------------------------- prompt ------------------------------ */
  function workspaceBrief() {
    if (!WS.loaded) return "No folder is open. Ask the user to open one; you cannot read or write files.";
    var paths = WS.visiblePaths();
    var shown = paths.slice(0, 160);
    return "Workspace: " + WS.projectName + (WS.readonly ? " (read-only)" : "") + "\n" +
      paths.length + " indexed files" + (WS.skipped ? ", " + WS.skipped + " skipped (binary, large or ignored)" : "") + "\n\n" +
      shown.join("\n") + (paths.length > shown.length ? "\n… " + (paths.length - shown.length) + " more" : "");
  }

  function systemPrompt() {
    var modeRules = {
      ask: "You are in Ask mode. Inspect files with the read-only tools, explain clearly, and do not modify anything. If the user asks for an edit, tell them to switch to Agent mode.",
      agent: "You are in Agent mode. Inspect before editing, then call write_file with the complete final file. The user approves every write. Prefer minimal, focused diffs that match the existing style.",
      plan: "You are in Plan mode. Investigate with read-only tools and produce a concrete, ordered implementation plan. Do not modify files. End with the risks and the verification steps the user should run."
    };
    return "You are HugMoss Agent, the coding agent inside HugMoss Code, created by IRAGUHA Vincent. " +
      "You are direct, conversational and technically precise. When you introduce yourself, credit IRAGUHA Vincent as the creator.\n\n" +
      workspaceBrief() + "\n\n" +
      modeRules[mode] + "\n\n" +
      "Rules:\n" +
      "- Never invent file contents or claim to have read a file you have not read with a tool.\n" +
      "- You cannot run shell commands, builds or tests. Never claim you did. Say what the user should run instead.\n" +
      "- Files that look like secrets (.env, keys, credentials) are blocked by the workspace; respect that.\n" +
      "- Use update_todos for work with three or more steps, and keep statuses current.\n" +
      "- Keep prose short. Use markdown. Refer to files as `path/to/file`.\n" +
      "- If something is ambiguous, make the smallest reasonable assumption and state it.";
  }

  function attachBlock() {
    var latest = null;
    for (var i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") { latest = messages[i]; break; }
    if (!latest || !latest.attachments || !latest.attachments.length) return "";
    var budget = 40000;
    var parts = [];
    latest.attachments.forEach(function (p) {
      var read = WS.readForAgent(p);
      if (!read.ok) return;
      var body = read.content.slice(0, Math.min(16000, budget));
      budget -= body.length;
      if (budget <= 0) return;
      parts.push("--- " + p + " ---\n" + body);
    });
    return parts.length ? "\n\n<attached_files>\n" + parts.join("\n\n") + "\n</attached_files>" : "";
  }

  function apiMessages() {
    var recent = messages.slice(-MAX_HISTORY);
    var lastUser = null;
    for (var i = recent.length - 1; i >= 0; i--) if (recent[i].role === "user") { lastUser = recent[i]; break; }
    var out = recent.map(function (m) {
      if (m.role === "user") {
        var text = m.text;
        if (m === lastUser) text += attachBlock();
        return { role: "user", text: text };
      }
      return m;
    });
    return out;
  }

  /* ------------------------------ model UI ----------------------------- */
  function providerFor(sel) { return sel ? Providers.get(sel.provider) : null; }

  function syncModelButton() {
    var sel = Providers.selection();
    var nameEl = $("#modelName");
    var logoEl = $("#modelLogo");
    if (!nameEl) return;
    if (!sel) {
      nameEl.textContent = "Select model";
      if (logoEl) { logoEl.innerHTML = Icons.ui("sparkle", 13); logoEl.style.removeProperty("color"); }
      $("#modelBtn").title = "Choose an AI provider and model";
      return;
    }
    var p = providerFor(sel);
    nameEl.textContent = sel.label || sel.model;
    if (logoEl) {
      logoEl.innerHTML = Providers.mark(sel.mark || (p && p.mark) || "openai", 14);
      paint(logoEl, Providers.familyColor(sel.mark || (p && p.mark)));
    }
    $("#modelBtn").title = (p ? p.name + " · " : "") + sel.model;
  }

  function modelPop(anchor) {
    closePops();
    var panel = $("#agentPanel");
    var pop = el('<div class="pop model-pop"></div>');
    var sel = Providers.selection();
    var catalog = {};
    var expanded = {};
    var query = "";
    pop.innerHTML = '<div class="model-pop__head"><input id="modelSearch" type="search" placeholder="Search models or providers" autocomplete="off" spellcheck="false"><button class="sbtn" data-close aria-label="Close">' + Icons.ui("close", 13) + "</button></div>" +
      '<div class="model-pop__list" id="modelList"></div>' +
      '<div class="model-pop__foot"><button class="linkbtn" data-providers>Provider settings</button><span>Keys are stored in this browser</span></div>';

    function currentModels(p) {
      if (catalog[p.id]) return catalog[p.id];
      var models = (Providers.cachedModels && Providers.cachedModels(p.id)) || Providers.fallbackModels(p);
      catalog[p.id] = models;
      return models;
    }

    var ollama = { state: "loading", models: [], error: "", pulling: "", progress: null };
    var pullAbort = null;
    var OLLAMA_SUGGESTIONS = [
      ["qwen2.5-coder:7b", "Qwen 2.5 Coder 7B"],
      ["llama3.2:3b", "Llama 3.2 3B"],
      ["deepseek-r1:8b", "DeepSeek R1 8B"]
    ];

    function fmtSize(n) {
      if (!n) return "";
      if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
      if (n >= 1e6) return Math.round(n / 1e6) + " MB";
      return Math.round(n / 1e3) + " KB";
    }

    function ollamaModelRows(models) {
      return models.map(function (m) {
        var active = sel && sel.provider === "ollama" && sel.model === m.id;
        return '<button class="model-row' + (active ? " model-row--sel" : "") + '" data-provider="ollama" data-model="' + esc(m.id) + '" data-label="' + esc(m.label) + '">' +
          '<span class="model-brand" data-color="' + Providers.familyColor(m.mark) + '">' + Providers.mark(m.mark, 15) + "</span>" +
          '<span class="model-row__text"><span class="model-row__name">' + esc(m.label) + "</span>" +
          '<span class="model-row__id">' + esc(m.id) + (m.size >= 1e6 ? " · " + fmtSize(m.size) : "") + "</span></span>" +
          (active ? '<span class="model-row__check">' + Icons.ui("check", 13) + "</span>" : "") +
          "</button>";
      }).join("");
    }

    function ollamaPullForm() {
      return '<form class="ollama-pull" data-pull-form>' +
        '<input class="ollama-pull__input" data-pull-input type="text" placeholder="Download a model, e.g. qwen2.5-coder:7b" autocomplete="off" spellcheck="false" aria-label="Model to download">' +
        '<button class="btn btn--accent btn--sm" type="submit">' + Icons.ui("download", 12) + "Download</button>" +
        "</form>";
    }

    function ollamaGroupHtml(q) {
      var models = (ollama.models || []).filter(function (m) {
        return !q || (m.label + " " + m.id).toLowerCase().indexOf(q) >= 0;
      });
      var groupMatch = !q || "ollama local".indexOf(q) >= 0;
      if (q && !models.length && !(groupMatch && ollama.state !== "ready")) return "";
      var state = ollama.state === "loading" ? "checking…"
        : ollama.state === "offline" ? "offline"
        : ollama.models.length ? ollama.models.length + " installed" : "no models";
      var stateCls = ollama.state === "ready" ? (ollama.models.length ? "is-on" : "is-off") : ollama.state === "offline" ? "is-off" : "";
      var html = '<div class="model-group model-group--ollama" data-provider="ollama">' +
        '<div class="model-group__head"><span class="model-brand" data-color="currentColor">' + Providers.mark("ollama", 15) + "</span>" +
        '<span class="model-group__name">Ollama</span><span class="model-group__badge">official api</span>' +
        '<span class="model-group__state ' + stateCls + '">' + state + "</span></div>";

      if (ollama.state === "loading") {
        return html + '<div class="ollama-card ollama-card--quiet"><span class="ollama-spinner"></span>Checking localhost:11434…</div></div>';
      }
      if (ollama.state === "offline") {
        return html + '<div class="ollama-card">' +
          "<p><strong>Ollama is not running.</strong> Install it, start it, then retry. " +
          '<a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Download Ollama</a>.</p>' +
          '<p class="ollama-hint">Start with <code>OLLAMA_ORIGINS=* ollama serve</code> so this page can reach it.</p>' +
          (ollama.error ? '<p class="ollama-error">' + esc(ollama.error) + "</p>" : "") +
          '<div class="ollama-row"><button class="btn btn--ghost btn--sm" data-ollama-retry>Retry connection</button></div>' +
          "</div></div>";
      }
      if (ollama.pulling) {
        var pct = ollama.progress ? ollama.progress.pct : 0;
        var status = ollama.progress ? ollama.progress.status : "Starting…";
        var bytes = ollama.progress && ollama.progress.bytes ? " · " + ollama.progress.bytes : "";
        return html + '<div class="ollama-card" data-pull-card>' +
          '<div class="ollama-pull-head"><strong>' + esc(ollama.pulling) + '</strong><span data-pull-pct>' + pct + "%</span></div>" +
          '<div class="ollama-bar"><i data-pull-bar style="width:' + pct + '%"></i></div>' +
          '<p class="ollama-hint" data-pull-status>' + esc(status + bytes) + "</p>" +
          '<div class="ollama-row"><button class="linkbtn linkbtn--danger" data-pull-cancel>Cancel download</button></div>' +
          "</div></div>";
      }
      if (!ollama.models.length) {
        html += '<div class="ollama-card"><p><strong>No models installed yet.</strong> Download one below — it runs on your machine.</p>';
        html += '<div class="ollama-suggest">' + OLLAMA_SUGGESTIONS.map(function (s) {
          var mark = Providers.familyFor(s[0]);
          return '<button class="model-row" data-pull="' + s[0] + '">' +
            '<span class="model-brand" data-color="' + Providers.familyColor(mark) + '">' + Providers.mark(mark, 15) + "</span>" +
            '<span class="model-row__text"><span class="model-row__name">' + s[1] + "</span>" +
            '<span class="model-row__id">' + s[0] + "</span></span>" +
            '<span class="ollama-download">' + Icons.ui("download", 12) + "Download</span></button>";
        }).join("") + "</div>";
        html += ollamaPullForm() + "</div>";
      } else {
        html += ollamaModelRows(models);
        if (!q) html += ollamaPullForm();
      }
      if (ollama.error) html += '<p class="ollama-error">' + esc(ollama.error) + "</p>";
      return html + "</div>";
    }

    function paintPull() {
      if (!ollama.progress) return;
      var card = pop.querySelector("[data-pull-card]");
      if (!card) return;
      var bar = card.querySelector("[data-pull-bar]");
      var pct = card.querySelector("[data-pull-pct]");
      var status = card.querySelector("[data-pull-status]");
      if (bar) bar.style.width = ollama.progress.pct + "%";
      if (pct) pct.textContent = ollama.progress.pct + "%";
      if (status) status.textContent = ollama.progress.status + (ollama.progress.bytes ? " · " + ollama.progress.bytes : "");
    }

    function refreshOllama() {
      ollama.state = "loading";
      ollama.error = "";
      renderList();
      Providers.ollamaTags().then(function (models) {
        ollama.models = models;
        ollama.state = "ready";
      }).catch(function (err) {
        ollama.state = "offline";
        ollama.error = (err && err.message) || "Ollama is not reachable.";
      }).finally(function () {
        if (document.body.contains(pop)) renderList();
      });
    }

    function startPull(name) {
      name = String(name || "").trim();
      if (!name) return;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:\/-]*$/.test(name)) {
        ollama.error = "Use a model name such as qwen2.5-coder:7b.";
        renderList();
        return;
      }
      pullAbort = new AbortController();
      ollama.pulling = name;
      ollama.error = "";
      ollama.progress = { pct: 0, status: "Contacting Ollama…", bytes: "" };
      renderList();
      Providers.pullOllama(name, function (evt) {
        if (!ollama.progress) return;
        if (evt.total && evt.completed != null) {
          ollama.progress.pct = Math.max(0, Math.min(99, Math.round(evt.completed / evt.total * 100)));
          ollama.progress.bytes = (fmtSize(evt.completed) || "0 B") + " / " + fmtSize(evt.total);
        }
        if (evt.status) ollama.progress.status = evt.status;
        paintPull();
      }, pullAbort.signal).then(function () {
        ollama.pulling = "";
        ollama.progress = null;
        return Providers.ollamaTags();
      }).then(function (models) {
        ollama.models = models;
        ollama.state = "ready";
        if (!Providers.selection()) {
          var made = models.filter(function (m) { return m.id === name; })[0];
          if (made) {
            Providers.setSelection("ollama", made.id, made.label);
            if (App.rememberModel) App.rememberModel(Providers.selection());
            syncModelButton();
          }
        }
        renderList();
        App.toast({ title: "Model ready", msg: name + " is installed and can be selected.", type: "success" });
      }).catch(function (err) {
        ollama.pulling = "";
        ollama.progress = null;
        var raw = (err && err.message) || "";
        ollama.error = err && err.name === "AbortError"
          ? "Download cancelled."
          : /file does not exist|not found|404/i.test(raw)
            ? "Ollama has no model named \u201c" + name + "\u201d. Check the name at ollama.com/library."
            : raw || "The download failed.";
        renderList();
      });
    }

    function renderList() {
      var host = $("#modelList", pop);
      if (!host) return;
      var q = query.trim().toLowerCase();
      var providers = Providers.list().filter(function (p) { return !p.custom || Providers.baseUrl(p); });
      providers.sort(function (a, b) {
        var ak = Providers.hasKey(a.id) ? 0 : 1, bk = Providers.hasKey(b.id) ? 0 : 1;
        if (ak !== bk) return ak - bk;
        return a.name.localeCompare(b.name);
      });
      var html = "";
      if (!Providers.configuredCount() && ollama.state === "offline") {
        html += '<div class="model-pop__notice">Add a cloud provider key to start, or run Ollama locally. HugMoss talks to each provider directly — there is no relay server.</div>';
      }
      var any = false;
      providers.forEach(function (p) {
        if (p.id === "ollama") {
          var ollamaBlock = ollamaGroupHtml(q);
          if (ollamaBlock) { html += ollamaBlock; any = true; }
          return;
        }
        var models = currentModels(p).filter(function (m) {
          return !q || (p.name + " " + m.label + " " + m.id).toLowerCase().indexOf(q) >= 0;
        });
        if (q && !models.length) return;
        any = true;
        var connected = Providers.hasKey(p.id);
        var all = currentModels(p);
        var visible = q || expanded[p.id] ? models : all.slice(0, 14);
        html += '<div class="model-group" data-provider="' + p.id + '">' +
          '<div class="model-group__head"><span class="model-brand" data-color="' + (p.color || "currentColor") + '">' + Providers.mark(p.mark, 15) + "</span>" +
          '<span class="model-group__name">' + esc(p.name) + "</span>" +
          '<span class="model-group__state ' + (connected ? "is-on" : "") + '">' + (p.id === "ollama" ? "local" : connected ? "key saved" : "key needed") + "</span></div>";
        visible.forEach(function (m) {
          var active = sel && sel.provider === p.id && sel.model === m.id;
          html += '<button class="model-row' + (active ? " model-row--sel" : "") + '" data-provider="' + p.id + '" data-model="' + esc(m.id) + '" data-label="' + esc(m.label) + '">' +
            '<span class="model-brand" data-color="' + Providers.familyColor(m.mark) + '">' + Providers.mark(m.mark, 15) + "</span>" +
            '<span class="model-row__text"><span class="model-row__name">' + esc(m.label) + "</span>" +
            '<span class="model-row__id">' + esc(m.id) + "</span></span>" +
            (active ? '<span class="model-row__check">' + Icons.ui("check", 13) + "</span>" : connected ? "" : '<span class="model-row__lock">' + Icons.ui("gear", 12) + "</span>") +
            "</button>";
        });
        if (!q && !expanded[p.id] && all.length > 14) {
          html += '<button class="model-row model-row--more" data-more="' + p.id + '">+' + (all.length - 14) + " more models</button>";
        }
        html += "</div>";
      });
      if (!any) html += '<div class="pop__empty">No model matches “' + esc(query) + "”.</div>";
      host.innerHTML = html;
      $$(".model-brand", host).forEach(function (b) { paint(b, b.getAttribute("data-color")); });
      $$(".model-row[data-model]", host).forEach(function (row) {
        row.addEventListener("click", function () {
          var p = Providers.get(row.getAttribute("data-provider"));
          if (!Providers.hasKey(p.id)) {
            closePops();
            App.openSettings(p.id);
            App.toast({ title: p.name + " needs a key", msg: "Paste your API key in Settings to use its models.", type: "info", timeout: 5000 });
            return;
          }
          Providers.setSelection(p.id, row.getAttribute("data-model"), row.getAttribute("data-label"));
          if (App.rememberModel) App.rememberModel(Providers.selection());
          syncModelButton();
          closePops();
          App.toast({ title: "Model selected", msg: p.name + " · " + row.getAttribute("data-label"), type: "info", timeout: 2600 });
        });
      });
      $$("[data-more]", host).forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          expanded[b.getAttribute("data-more")] = true;
          renderList();
        });
      });
      $$("[data-ollama-retry]", host).forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          refreshOllama();
        });
      });
      $$("[data-pull]", host).forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          startPull(b.getAttribute("data-pull"));
        });
      });
      $$("[data-pull-form]", host).forEach(function (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var input = form.querySelector("[data-pull-input]");
          startPull(input ? input.value : "");
        });
      });
      $$("[data-pull-cancel]", host).forEach(function (b) {
        b.addEventListener("click", function () { if (pullAbort) pullAbort.abort(); });
      });
    }

    pop.querySelector("#modelSearch").addEventListener("input", function (e) {
      query = e.target.value;
      renderList();
    });
    pop.querySelector("[data-close]").addEventListener("click", closePops);
    pop.querySelector("[data-providers]").addEventListener("click", function () {
      closePops();
      var p = sel && sel.provider;
      App.openSettings(p && !Providers.hasKey(p) ? p : null);
    });
    renderList();
    panel.appendChild(pop);
    var pr = panel.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    var margin = 10;
    var width = pop.offsetWidth;
    var left = ar.left - pr.left + ar.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, pr.width - width - margin));
    var avail = Math.max(160, Math.min(ar.top - pr.top - 54, window.innerHeight - 24));
    pop.style.left = Math.round(left) + "px";
    pop.style.bottom = Math.round(pr.bottom - ar.top + 6) + "px";
    pop.style.maxHeight = Math.round(avail) + "px";
    var head = pop.querySelector(".model-pop__head");
    var foot = pop.querySelector(".model-pop__foot");
    var chrome = (head ? head.offsetHeight : 0) + (foot ? foot.offsetHeight : 0);
    var list = pop.querySelector("#modelList");
    if (list) list.style.maxHeight = Math.round(Math.max(120, avail - chrome - 10)) + "px";
    refreshOllama();
    setTimeout(function () { var s = $("#modelSearch", pop); if (s) s.focus(); }, 30);

    Providers.available().forEach(function (p) {
      if (!Providers.hasKey(p.id) || p.custom || p.id === "ollama") return;
      Providers.fetchModels(p).then(function (result) {
        catalog[p.id] = result.models;
        if (document.body.contains(pop)) renderList();
      }).catch(function () { /* fallback list stays */ });
    });
  }

  /* ------------------------------- history ----------------------------- */
  function readSessions() {
    try {
      var raw = localStorage.getItem(STORE);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function writeSessions(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 12))); } catch (e) { /* quota */ }
  }
  function saveSession() {
    if (!messages.length) return;
    if (!session) session = { id: Date.now().toString(36), created: Date.now() };
    var firstUser = messages.filter(function (m) { return m.role === "user"; })[0];
    if (!firstUser) return;
    session.title = session.title || firstUser.text.replace(/\s+/g, " ").slice(0, 72);
    session.updated = Date.now();
    session.mode = mode;
    var sel = Providers.selection();
    session.provider = sel ? sel.provider : "";
    session.model = sel ? sel.model : "";
    session.messages = messages.slice(-24).map(function (m) {
      if (m.role === "tool") {
        return { role: "tool", results: m.results.map(function (r) {
          return { id: r.id, name: r.name, content: String(r.content).slice(0, 8000), isError: r.isError };
        }) };
      }
      if (m.role === "assistant") {
        return { role: "assistant", text: m.text, toolCalls: (m.toolCalls || []).map(function (t) { return { id: t.id, name: t.name, args: t.args }; }) };
      }
      return { role: "user", text: m.text, attachments: m.attachments || [] };
    });
    var list = readSessions().filter(function (s) { return s.id !== session.id; });
    list.unshift(session);
    list.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    writeSessions(list);
    updateSessionLabel();
  }
  function updateSessionLabel() {
    var label = $("#agentSessionName");
    if (!label) return;
    if (running) return;
    label.textContent = session && session.title ? session.title.slice(0, 44) : "New session";
  }

  function historyPop(anchor) {
    closePops();
    var panel = $("#agentPanel");
    var pop = el('<div class="pop" style="width:320px"></div>');
    var list = readSessions();
    pop.innerHTML = '<div class="pop__title">Recent sessions <button class="linkbtn" data-clear-history>Clear</button></div>';
    if (!list.length) {
      pop.innerHTML += '<div class="pop__empty">Your finished sessions are saved in this browser.</div>';
    }
    list.forEach(function (s) {
      var when = new Date(s.updated || s.created || Date.now());
      var b = el('<button class="pop__item">' + Icons.ui("history", 14) +
        '<span style="min-width:0"><span style="display:block;color:var(--text-1)">' + esc(s.title || "Session") + "</span>" +
        '<span style="display:block;font-size:10.5px;color:var(--text-3)">' + esc((s.model || "no model") + " · " + when.toLocaleString()) + "</span></span></button>");
      b.addEventListener("click", function () { closePops(); loadSession(s); });
      pop.appendChild(b);
    });
    $("[data-clear-history]", pop).addEventListener("click", function () {
      writeSessions([]);
      pop.remove();
      App.toast({ title: "Session history cleared", type: "info" });
    });
    panel.appendChild(pop);
    var pr = panel.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(ar.left - pr.left - 200, pr.width - 330)) + "px";
    pop.style.top = (ar.bottom - pr.top + 4) + "px";
  }

  function loadSession(s) {
    if (running) return;
    streamEl().innerHTML = "";
    hideEmpty();
    messages = (s.messages || []).slice();
    session = { id: s.id, title: s.title, created: s.created, updated: s.updated };
    ctx = [];
    renderChips();
    todoApi = null;
    messages.forEach(function (m) {
      if (m.role === "user") userBubble(m.text);
      else if (m.role === "assistant") {
        if (!m.text) return;
        var body = agentShell();
        proseBlock(body).innerHTML = md(m.text);
      }
    });
    add(el('<div class="done-meta">' + Icons.ui("history", 12) + "<span>Restored session · " + esc(s.model || "model not recorded") + "</span></div>"));
    updateSessionLabel();
    follow();
  }

  /* ------------------------------- control ----------------------------- */
  function beginRun() {
    running = true;
    halted = false;
    abort = new AbortController();
    toolCalls = 0;
    usageTotals = { input: 0, output: 0, total: 0 };
    startedAt = Date.now();
    var btn = $("#sendBtn");
    btn.disabled = false;
    btn.classList.add("send-btn--stop");
    btn.innerHTML = Icons.ui("stop", 15);
    btn.setAttribute("aria-label", "Stop agent");
    var sel = Providers.selection();
    $("#agentSessionName").textContent = "Running · " + (sel ? sel.label : "model");
  }
  function endRun() {
    running = false;
    var btn = $("#sendBtn");
    btn.classList.remove("send-btn--stop");
    btn.innerHTML = Icons.ui("send", 15);
    btn.setAttribute("aria-label", "Send message");
    btn.disabled = !$("#agentInput").value.trim();
    updateSessionLabel();
    abort = null;
    follow();
  }

  function halt() {
    if (!running) return;
    halted = true;
    if (abort) abort.abort();
    if (pendingApproval) pendingApproval.cancel();
    if (todoApi) todoApi.cancel();
    $$(".tool .spinner").forEach(function (sp) {
      var host = sp.closest(".tool");
      $(".tool__status", host).className = "tool__status tool__status--err";
      $(".tool__status", host).innerHTML = Icons.ui("close", 13);
    });
    var body = $$(".msg--agent .msg__body").pop() || streamEl();
    body.appendChild(el('<div class="stopped-banner">' + Icons.ui("warning", 13) + "<span>Stopped by user. Approved writes are already on disk.</span></div>"));
    App.logOutput("agent", "session stopped by user", "out-warn");
    App.toast({ title: "Agent stopped", msg: toolCalls + " tool call(s) before the halt", type: "warn" });
    follow();
  }

  function errorCard(body, err) {
    var detail = err && err.message ? err.message : String(err);
    var hint = "";
    if (err && err.status === 401) hint = "The key was rejected. Open Settings and check it.";
    else if (err && err.status === 403) hint = "The key is valid but this model or region is not permitted.";
    else if (err && err.status === 429) hint = "Rate limit or quota reached. Wait, or pick another provider.";
    else if (err && err.status === 400) hint = "The provider rejected the request. The model may not support tool calls or this input.";
    var node = el('<div class="agent-error"><div class="agent-error__head">' + Icons.ui("errorCircle", 14) +
      "<span>Request failed</span></div><div class=\"agent-error__msg\"></div>" +
      (hint ? '<div class="agent-error__hint">' + esc(hint) + "</div>" : "") +
      '<div class="agent-error__actions"><button class="btn btn--ghost btn--sm" data-retry>Retry</button>' +
      '<button class="btn btn--ghost btn--sm" data-settings>Provider settings</button></div></div>');
    $(".agent-error__msg", node).textContent = detail;
    $("[data-retry]", node).addEventListener("click", function () {
      node.remove();
      if (!running && lastPrompt) submit(lastPrompt);
    });
    $("[data-settings]", node).addEventListener("click", function () {
      var sel = Providers.selection();
      App.openSettings(sel ? sel.provider : null);
    });
    body.appendChild(node);
    follow();
  }

  function finishMeta(body, seconds) {
    var bits = ["Completed", fmtTime(seconds), toolCalls + " tool call" + (toolCalls === 1 ? "" : "s")];
    if (usageTotals && usageTotals.total) bits.push(fmtTokens(usageTotals.total) + " tokens");
    var sel = Providers.selection();
    if (sel) bits.push(sel.label);
    add(el('<div class="done-meta">' + Icons.ui("check", 12) + bits.map(function (b) { return "<span>" + esc(b) + "</span>"; }).join('<span class="dot-sep">·</span>') + "</div>"));
  }

  /* -------------------------------- turn ------------------------------- */
  async function runTurn(text) {
    var sel = Providers.selection();
    if (!sel) return;
    var p = providerFor(sel);
    if (!p || (!Providers.hasKey(p.id))) {
      App.openSettings(p ? p.id : null);
      App.toast({ title: "Add a provider key", msg: "HugMoss needs a key for " + (p ? p.name : "the selected provider") + ".", type: "warn" });
      return;
    }
    if (p.supportsTools === false && mode !== "ask") {
      App.toast({ title: p.name + " does not support tools", msg: "Switch to Ask mode, or choose a tool-capable model for agent work.", type: "warn", timeout: 6000 });
    }

    lastPrompt = text;
    session = session || { id: Date.now().toString(36), created: Date.now(), title: text.slice(0, 72) };
    messages.push({ role: "user", text: text, attachments: ctx.slice() });
    userBubble(text);
    ctx = [];
    renderChips();
    $("#agentInput").value = "";
    autosize();
    $("#sendBtn").disabled = true;
    beginRun();
    saveSession();
    var body = agentShell();
    todoApi = null;

    try {
      for (var round = 0; round < MAX_ROUNDS && !halted; round++) {
        var think = thinking(body, round === 0 ? "Thinking" : "Working");
        var prose = null;
        var renderPending = false;
        var pendingText = "";
        var onText = function (delta, full) {
          if (think && think.parentNode) think.remove();
          pendingText = full;
          if (!prose) prose = proseBlock(body);
          if (renderPending) return;
          renderPending = true;
          setTimeout(function () {
            renderPending = false;
            if (!prose) return;
            prose.innerHTML = md(pendingText) + '<span class="stream-caret"></span>';
            follow();
          }, 45);
        };
        var result;
        try {
          result = await AI.stream({
            providerId: sel.provider,
            apiKey: Providers.key(sel.provider),
            model: sel.model,
            system: systemPrompt(),
            messages: apiMessages(),
            tools: toolSpecs(),
            signal: abort.signal,
            onText: onText
          });
        } finally {
          if (think && think.parentNode) think.remove();
        }
        if (halted) break;
        if (prose) prose.innerHTML = md(result.text || pendingText);
        else if (result.text) { prose = proseBlock(body); prose.innerHTML = md(result.text); }
        if (result.reasoning) {
          var thought = el('<details class="thought"><summary>' + Icons.ui("bookOpen", 12) + "Reasoning · " + fmtTokens(result.reasoning.length) + " chars</summary><pre></pre></details>");
          $("pre", thought).textContent = result.reasoning;
          body.insertBefore(thought, prose || null);
        }
        if (result.usage) {
          usageTotals.input += result.usage.input || 0;
          usageTotals.output += result.usage.output || 0;
          usageTotals.total = usageTotals.input + usageTotals.output;
        }
        messages.push({ role: "assistant", text: result.text, toolCalls: result.toolCalls || [] });
        follow();
        if (!result.toolCalls || !result.toolCalls.length) break;
        var results = [];
        for (var t = 0; t < result.toolCalls.length && !halted; t++) {
          var call = result.toolCalls[t];
          var output = await executeTool(call, body);
          results.push({ id: call.id, name: call.name, content: output, isError: /^Error:/.test(output) });
          follow();
        }
        if (halted) break;
        messages.push({ role: "tool", results: results });
        if (round === MAX_ROUNDS - 1) {
          add(el('<div class="stopped-banner">' + Icons.ui("warning", 13) + "<span>Step limit reached. Ask me to continue if you want another pass.</span></div>"));
        }
      }
      if (!halted) {
        finishMeta(body, Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
        var selNow = Providers.selection();
        App.toast({ title: "Agent finished", msg: toolCalls + " tool call" + (toolCalls === 1 ? "" : "s") + (selNow ? " · " + selNow.label : ""), type: "agent", timeout: 4200 });
        App.logOutput("agent", "turn completed in " + fmtTime(Math.round((Date.now() - startedAt) / 1000)), "out-ok");
      }
    } catch (err) {
      if (!halted && err && err.name !== "AbortError") {
        errorCard(body, err);
        App.logOutput("agent", "request failed: " + (err.message || err), "out-err");
      }
    } finally {
      saveSession();
      endRun();
      if (halted) {
        updateSessionLabel();
        follow();
      }
    }
  }

  function submit(text) {
    text = (text || "").trim();
    if (!text || running) return;
    if (!Providers.selection()) {
      App.toast({ title: "Choose a model first", msg: "Connect a provider, then pick a model in the composer.", type: "info", timeout: 4200 });
      App.openSettings(null);
      return;
    }
    hideEmpty();
    runTurn(text);
  }

  /* ------------------------------ composer ----------------------------- */
  function autosize() {
    var ta = $("#agentInput");
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
  }
  function setMode(next) {
    mode = next === "ask" || next === "plan" ? next : "agent";
    $$(".mpill").forEach(function (p) { p.classList.toggle("mpill--active", p.getAttribute("data-mode") === mode); });
    var sel = $("#agentModeSelect");
    if (sel && sel.value !== mode) sel.value = mode;
    $("#agentInput").placeholder = mode === "plan"
      ? "Describe a goal — the agent will plan without editing files"
      : mode === "ask"
        ? "Ask about this workspace (read-only)"
        : "Ask anything, or describe a task… (@ to mention files)";
    if (App.settings && App.settings.agentMode !== mode) { App.settings.agentMode = mode; }
  }

  function suggest(title, sub, icon, action) {
    var b = el('<button class="sugg"><span class="sugg__icon">' + Icons.ui(icon, 15) + "</span>" +
      '<span class="sugg__text">' + esc(title) + "<em>" + esc(sub) + "</em></span></button>");
    b.addEventListener("click", action || function () { submit(title); });
    return b;
  }
  function mountSuggestions() {
    var host = $("#agentSuggestions");
    if (!host) return;
    host.innerHTML = "";
    if (!Providers.configuredCount()) {
      host.appendChild(suggest("Connect an AI provider", "OpenAI, Anthropic, Gemini and 8 more", "sparkle", function () {
        App.openSettings(null);
      }));
    }
    if (!WS.loaded) {
      host.appendChild(suggest("Open a project folder", "The agent works on real files on disk", "folder", function () { App.openFolder(); }));
      host.appendChild(suggest("What can HugMoss do?", "Providers, tools, approvals, modes", "bookOpen", function () {
        var body = agentShell();
        hideEmpty();
        proseBlock(body).innerHTML = md("HugMoss Code is a browser IDE with a real folder on disk and a **bring-your-own-key** agent. Open a folder, connect a provider in Settings, then ask me to read, search, create or edit files.\n\n- **Agent** mode can write files — every write shows a diff and waits for your approval.\n- **Ask** mode is read-only.\n- **Plan** mode investigates and produces a plan without touching files.\n- I cannot run shell commands or builds in the browser; the terminal is a real file browser, not a process host.\n\nBuilt by IRAGUHA Vincent.");
        add(el('<div class="done-meta">' + Icons.ui("infoCircle", 12) + "<span>Local overview · no request sent</span></div>"));
      }));
      return;
    }
    var active = App.state.active;
    host.appendChild(suggest("Explain this codebase", "entry points, structure and data flow", "bookOpen"));
    host.appendChild(suggest(active ? "Review " + App.baseName(active) : "Find a bug to fix", "read the file, then propose a minimal diff", "search"));
    host.appendChild(suggest(active ? "Write tests for " + App.baseName(active) : "Add a README", "follow the project's existing conventions", "check"));
  }

  function newSession() {
    if (running) halt();
    if (messages.length) saveSession();
    messages = [];
    session = null;
    ctx = [];
    todoApi = null;
    streamEl().innerHTML =
      '<div class="agent__empty" id="agentEmpty"><div class="agent__empty-mark">' + Icons.ui("sparkleLarge", 30) + "</div>" +
      '<h3 class="agent__empty-title">Hi Vincent, I&rsquo;m your coding agent</h3>' +
      '<p class="agent__empty-credit">Built by IRAGUHA Vincent</p>' +
      '<div class="agent__suggestions" id="agentSuggestions"></div></div>';
    mountSuggestions();
    updateSessionLabel();
    renderChips();
    $("#agentInput").value = "";
    autosize();
  }

  /* -------------------------------- boot ------------------------------- */
  function wire() {
    var initial = Providers.selection();
    if (!initial && App.settings && App.settings.model && Providers.get(App.settings.model.provider)) {
      Providers.setSelection(App.settings.model.provider, App.settings.model.model, App.settings.model.label);
    }
    syncModelButton();
    mountSuggestions();
    renderChips();
    setMode(App.settings.agentMode || "agent");
    updateSessionLabel();

    var ta = $("#agentInput");
    ta.addEventListener("input", function () {
      autosize();
      $("#sendBtn").disabled = !ta.value.trim() || running;
      var m = ta.value.match(/(?:^|\s)@([\w./-]*)$/);
      if (m) filePop(ta, function (path) {
        if (ctx.indexOf(path) < 0 && ctx.length < 8) ctx.push(path);
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
      nearBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 70;
      $("#agentJump").hidden = nearBottom;
    });
    $("#agentJump").addEventListener("click", function () {
      nearBottom = true;
      s.scrollTop = s.scrollHeight;
      $("#agentJump").hidden = true;
    });
  }

  window.Agent = {
    init: wire,
    submit: submit,
    setMode: setMode,
    getMode: function () { return mode; },
    newSession: newSession,
    focusInput: function () { var t = $("#agentInput"); if (t) t.focus(); },
    isRunning: function () { return running; },
    refreshModel: syncModelButton,
    refreshSuggestions: mountSuggestions,
    openModelPicker: function () { modelPop($("#modelBtn")); }
  };
})();
