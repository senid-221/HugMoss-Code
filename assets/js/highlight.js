/* highlight.js — small regex tokenizer (ts/tsx/js/json/css/md/html/env) + LCS line diff. */
(function () {
  "use strict";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var KW = "abstract|any|as|asserts|async|await|boolean|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|infer|instanceof|interface|is|keyof|let|namespace|never|new|null|number|object|of|override|private|protected|public|readonly|return|satisfies|set|static|string|super|switch|this|throw|true|try|type|typeof|undefined|unknown|var|void|while|yield";
  var ATTRS = "className|aria-[a-z]+|data-[\\w-]+|role|key|ref|style|title|size|type|src|href|id|placeholder|autoComplete|spellCheck|target|rel";

  function R(type, src, flags) { return { type: type, re: new RegExp(src, flags ? flags + "y" : "y") }; }

  var CODE_RULES = [
    R("com", "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/"),
    R("str", '"(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?|`(?:[^`\\\\]|\\\\.)*`'),
    R("num", "\\b0x[\\da-fA-F]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b"),
    R("kw", "\\b(?:" + KW + ")\\b"),
    R("fn", "\\b[A-Za-z_$][\\w$]*(?=\\s*[(<])"),
    R("type", "\\b[A-Z][\\w$]*\\b"),
    R("tag", "<\\/?[A-Za-z][\\w.-]*"),
    R("attr", "(?<=\\s)(?:" + ATTRS + ")(?==)"),
    R("var", "\\b[a-z_$][\\w$]*\\b")
  ];

  var TS_RULES = CODE_RULES.filter(function (r) { return r.type !== "tag" && r.type !== "attr"; });

  var JSON_RULES = [
    R("prop", '"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:)'),
    R("str", '"(?:[^"\\\\\\n]|\\\\.)*"?'),
    R("num", "-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b"),
    R("kw", "\\b(?:true|false|null)\\b")
  ];

  var CSS_RULES = [
    R("com", "\\/\\*[\\s\\S]*?\\*\\/"),
    R("str", '"[^"\\n]*"|\'[^\'\\n]*\''),
    R("kw", "!important|@[\\w-]+"),
    R("num", "#[0-9a-fA-F]{3}\\b|#[0-9a-fA-F]{6}\\b|#[0-9a-fA-F]{8}\\b"),
    R("prop", "--[\\w-]+"),
    R("fn", "[-\\w]+(?=\\()"),
    R("attr", "[a-zA-Z-]+(?=\\s*:)"),
    R("type", "\\.[-\\w]+|#[-\\w]+"),
    R("num2", "\\b\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|dvh|s|ms|deg|fr)?\\b")
  ];

  var MD_RULES = [
    R("kw", "^```[^\\n]*", "m"),
    R("kw", "^#{1,6}[^\\n]*", "m"),
    R("com", "^>[^\\n]*", "m"),
    R("fn", "!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)"),
    R("type", "\\*\\*[^*\\n]+\\*\\*"),
    R("str", "`[^`\\n]+`"),
    R("tag", "^\\s*(?:[-*]|\\d+\\.)\\s", "m")
  ];

  var HTML_RULES = [
    R("com", "<!--[\\s\\S]*?-->"),
    R("kw", "<!doctype[^>]*>", "i"),
    R("tag", "<\\/?[a-zA-Z][\\w-]*"),
    R("attr", "[\\w-]+(?=\\s*=\\s*[\"'])"),
    R("str", '"[^"\\n]*"|\'[^\'\\n]*\'')
  ];

  var ENV_RULES = [
    R("com", "^#[^\\n]*", "m"),
    R("prop", "^[A-Z_][A-Z0-9_]*(?==)", "m"),
    R("str", "(?<==)[^\\n]+")
  ];

  var GITIGNORE_RULES = [
    R("com", "^#[^\\n]*", "m"),
    R("fn", "^![^\\n]*", "m")
  ];

  var LANGS = {
    ts: TS_RULES, tsx: CODE_RULES, js: TS_RULES, jsx: CODE_RULES,
    json: JSON_RULES, css: CSS_RULES, md: MD_RULES,
    html: HTML_RULES, svg: HTML_RULES, env: ENV_RULES, gitignore: GITIGNORE_RULES
  };

  function tokenize(code, lang) {
    var rules = LANGS[lang] || [];
    var tokens = [];
    var i = 0, len = code.length;
    while (i < len) {
      var matched = false;
      for (var r = 0; r < rules.length; r++) {
        rules[r].re.lastIndex = i;
        var m = rules[r].re.exec(code);
        if (m && m[0].length > 0) {
          tokens.push({ text: m[0], type: rules[r].type });
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        tokens.push({ text: code[i], type: "plain" });
        i++;
      }
    }
    return tokens;
  }

  /* tokens -> array of lines, each an array of {text, type} */
  function tokenizeLines(code, lang) {
    var tokens = tokenize(code, lang);
    var lines = [[]];
    for (var t = 0; t < tokens.length; t++) {
      var parts = tokens[t].text.split("\n");
      for (var p = 0; p < parts.length; p++) {
        if (p > 0) lines.push([]);
        if (parts[p]) lines[lines.length - 1].push({ text: parts[p], type: tokens[t].type });
      }
    }
    return lines;
  }

  /* code -> array of HTML strings, one per line */
  function render(code, lang) {
    var lines = tokenizeLines(code, lang);
    return lines.map(function (line) {
      return line.map(function (tok) {
        if (tok.type === "plain") return esc(tok.text);
        return '<span class="tok-' + tok.type + '">' + esc(tok.text) + "</span>";
      }).join("");
    });
  }

  /* render a single line (used by terminal + diff rows) */
  function renderLine(text, lang) {
    return render(text, lang)[0] || "";
  }

  /* unified line diff via LCS; returns [{type: ctx|add|del, a, b, text}] */
  function diffLines(aText, bText) {
    var a = aText ? aText.replace(/\r\n/g, "\n").split("\n") : [];
    var b = bText ? bText.replace(/\r\n/g, "\n").split("\n") : [];
    var n = a.length, m = b.length;
    if (n * m > 2000000) return coarseDiff(a, b);
    var dp = [];
    for (var i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var out = [];
    var ai = 0, bj = 0, la = 0, lb = 0;
    while (ai < n && bj < m) {
      if (a[ai] === b[bj]) {
        out.push({ type: "ctx", a: ++la, b: ++lb, text: a[ai] });
        ai++; bj++;
      } else if (dp[ai + 1][bj] >= dp[ai][bj + 1]) {
        out.push({ type: "del", a: ++la, b: null, text: a[ai] });
        ai++;
      } else {
        out.push({ type: "add", a: null, b: ++lb, text: b[bj] });
        bj++;
      }
    }
    while (ai < n) out.push({ type: "del", a: ++la, b: null, text: a[ai++] });
    while (bj < m) out.push({ type: "add", a: null, b: ++lb, text: b[bj++] });
    return out;
  }

  /* whole-file diffs get expensive past a few thousand lines: keep the common
     prefix and suffix and treat the middle as one replaced block. */
  function coarseDiff(a, b) {
    var prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    var suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix &&
      a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    var out = [];
    var i;
    for (i = 0; i < prefix; i++) out.push({ type: "ctx", a: i + 1, b: i + 1, text: a[i] });
    for (i = prefix; i < a.length - suffix; i++) out.push({ type: "del", a: i + 1, b: null, text: a[i] });
    for (i = prefix; i < b.length - suffix; i++) out.push({ type: "add", a: null, b: i + 1, text: b[i] });
    for (i = a.length - suffix; i < a.length; i++) {
      out.push({ type: "ctx", a: i + 1, b: b.length - (a.length - i) + 1, text: a[i] });
    }
    return out;
  }

  window.HL = {
    esc: esc,
    tokenize: tokenize,
    tokenizeLines: tokenizeLines,
    render: render,
    renderLine: renderLine,
    diffLines: diffLines
  };
})();
