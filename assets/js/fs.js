/* fs.js — a real workspace backed by the File System Access API, with an in-memory fallback. */
(function () {
  "use strict";

  var MAX_FILES = 4000;
  var MAX_BYTES = 768 * 1024;
  var MAX_DEPTH = 24;
  var SKIP_DIRS = {
    ".git": 1, node_modules: 1, dist: 1, build: 1, out: 1, coverage: 1, vendor: 1, target: 1,
    ".next": 1, ".nuxt": 1, ".svelte-kit": 1, ".turbo": 1, ".cache": 1, ".parcel-cache": 1,
    ".venv": 1, venv: 1, env: 1, __pycache__: 1, ".pytest_cache": 1, ".mypy_cache": 1,
    ".idea": 1, ".gradle": 1, ".dart_tool": 1, Pods: 1, DerivedData: 1, bower_components: 1,
    ".yarn": 1, ".pnpm-store": 1, ".terraform": 1, ".DS_Store": 1
  };
  var SECRET_RE = /(^|\/)(\.env(?=$|\.(?!example$|sample$|template$))|\.npmrc$|\.netrc$|\.pgpass$|credentials(\.json)?$|secrets?\.(json|ya?ml)$|id_(rsa|dsa|ecdsa|ed25519)$|[^/]+\.(pem|p12|pfx|key|keystore)$)/i;

  var LANGS = {
    ts: "ts", tsx: "tsx", mts: "ts", cts: "ts", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
    json: "json", jsonc: "json", css: "css", scss: "css", sass: "css", less: "css",
    md: "md", markdown: "md", mdx: "md", html: "html", htm: "html", xml: "html", svg: "svg",
    env: "env", gitignore: "gitignore", txt: "txt", log: "txt",
    py: "py", pyi: "py", go: "go", rs: "rs", java: "java", kt: "java", kts: "java",
    c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", cs: "java",
    php: "php", rb: "rb", swift: "swift", sh: "sh", bash: "sh", zsh: "sh",
    yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql", vue: "html", svelte: "html",
    lock: "txt", dockerfile: "sh", makefile: "sh", ini: "txt", conf: "txt"
  };

  var state = {
    name: "",
    handle: null,
    pendingHandle: null,
    readonly: false,
    loaded: false,
    source: "none",
    files: {},
    paths: [],
    skipped: 0,
    truncated: false,
    openedAt: 0
  };

  function $(sel) { return document.querySelector(sel); }
  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent("hugmoss:" + type, { detail: detail || {} }));
  }
  function baseName(p) { return p.split("/").pop(); }
  function dirName(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function extOf(p) { var n = baseName(p).toLowerCase(); var m = n.match(/\.([a-z0-9]+)$/); return m ? m[1] : ""; }
  function isSecret(p) { return SECRET_RE.test(p); }

  function language(p) {
    var n = baseName(p);
    if (n === ".gitignore" || n === ".dockerignore" || n === ".npmignore") return "gitignore";
    if (/^\.env(\.|$)/.test(n)) return "env";
    var e = extOf(p);
    return LANGS[e] || "txt";
  }

  function normalize(p) {
    var clean = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
    var parts = clean.split("/");
    var out = [];
    parts.forEach(function (part) {
      if (!part || part === ".") return;
      if (part === "..") { out.pop(); return; }
      out.push(part);
    });
    return out.join("/");
  }

  function unsupported(message, code) {
    var err = new Error(message);
    err.code = code || "unsupported";
    return err;
  }

  /* ------------------------------- IndexedDB ---------------------------- */
  function idb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
      var req = indexedDB.open("hugmoss-workspace", 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbSet(key, value) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("kv", "readonly");
        var req = tx.objectStore("kv").get(key);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); reject(req.error); };
      });
    });
  }
  function idbDelete(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").delete(key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); resolve(); };
      });
    });
  }

  /* ------------------------------- loading ------------------------------ */
  async function readEntry(entry) {
    var file = await entry.handle.getFile();
    if (file.size > MAX_BYTES) return { skip: "large", size: file.size };
    var text = await file.text();
    if (text.indexOf("\u0000") >= 0) return { skip: "binary", size: file.size };
    return { text: text, size: file.size, mtime: file.lastModified };
  }

  async function scan(handle, readonly) {
    var entries = [];
    var queue = [{ handle: handle, prefix: "", depth: 0 }];
    var skipped = 0;
    var truncated = false;
    while (queue.length) {
      var cur = queue.shift();
      var batch = [];
      try {
        for await (var pair of cur.handle.entries()) batch.push(pair);
      } catch (e) { skipped++; continue; }
      for (var i = 0; i < batch.length; i++) {
        var name = batch[i][0], h = batch[i][1];
        if (h.kind === "directory") {
          if (SKIP_DIRS[name] || name === ".git" || cur.depth >= MAX_DEPTH) { skipped++; continue; }
          queue.push({ handle: h, prefix: cur.prefix + name + "/", depth: cur.depth + 1 });
        } else if (h.kind === "file") {
          if (entries.length >= MAX_FILES) { truncated = true; continue; }
          entries.push({ handle: h, path: cur.prefix + name });
        }
      }
      emit("ws-progress", { phase: "index", found: entries.length, skipped: skipped, name: handle.name });
    }

    entries.sort(function (a, b) { return a.path.localeCompare(b.path); });
    var files = {};
    var done = 0;
    var cursor = 0;
    async function worker() {
      while (cursor < entries.length) {
        var entry = entries[cursor++];
        try {
          var result = await readEntry(entry);
          if (result.skip) { skipped++; }
          else {
            files[entry.path] = {
              path: entry.path,
              name: baseName(entry.path),
              content: result.text,
              base: result.text,
              saved: result.text,
              size: result.size,
              mtime: result.mtime,
              handle: entry.handle,
              secret: isSecret(entry.path),
              isNew: false,
              deleted: false
            };
          }
        } catch (e) { skipped++; }
        done++;
        if (done % 25 === 0 || done === entries.length) {
          emit("ws-progress", { phase: "read", done: done, total: entries.length, name: handle.name });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(12, entries.length || 1) }, worker));
    return {
      name: handle.name,
      handle: handle,
      readonly: !!readonly,
      files: files,
      skipped: skipped,
      truncated: truncated,
      source: "folder"
    };
  }

  function adopt(result) {
    state.pendingHandle = null;
    state.name = result.name || "Workspace";
    state.handle = result.handle || null;
    state.readonly = !!result.readonly;
    state.files = result.files;
    state.skipped = result.skipped || 0;
    state.truncated = !!result.truncated;
    state.source = result.source || "folder";
    state.loaded = true;
    state.openedAt = Date.now();
    state.paths = Object.keys(state.files).sort(function (a, b) { return a.localeCompare(b); });
    emit("ws-loaded", summary());
    return summary();
  }

  async function loadDirectory(handle, opts) {
    opts = opts || {};
    emit("ws-progress", { phase: "start", name: handle.name });
    var result = await scan(handle, opts.readonly);
    var summaryOut = adopt(result);
    if (state.handle && !state.readonly) {
      try { await idbSet("dir", handle); } catch (e) { /* persistence unavailable */ }
    }
    return summaryOut;
  }

  async function openFolder() {
    if (!window.showDirectoryPicker) {
      openFallbackPicker();
      return { fallback: true };
    }
    var handle;
    try {
      handle = await window.showDirectoryPicker({ id: "hugmoss-workspace", mode: "readwrite", startIn: "documents" });
    } catch (e) {
      if (e && e.name === "AbortError") return { cancelled: true };
      if (e && (e.name === "SecurityError" || e.name === "NotAllowedError")) {
        openFallbackPicker();
        return { fallback: true };
      }
      throw e;
    }
    var perm = "granted";
    try {
      if (handle.requestPermission) perm = await handle.requestPermission({ mode: "readwrite" });
    } catch (e) { perm = "denied"; }
    var summaryOut = await loadDirectory(handle, { readonly: perm !== "granted" });
    if (perm !== "granted") {
      summaryOut.readonly = true;
      if (window.App) App.toast({ title: "Opened read-only", msg: "Write permission was declined. Reopen the folder to grant it.", type: "warn", timeout: 6000 });
    }
    return summaryOut;
  }

  async function restore() {
    var handle = null;
    try { handle = await idbGet("dir"); } catch (e) { return null; }
    if (!handle || !handle.queryPermission) return null;
    var perm = "prompt";
    try { perm = await handle.queryPermission({ mode: "readwrite" }); } catch (e) { perm = "prompt"; }
    if (perm === "granted") {
      var summaryOut = await loadDirectory(handle, { readonly: false });
      summaryOut.restored = true;
      return summaryOut;
    }
    state.pendingHandle = handle;
    state.name = handle.name;
    emit("ws-restored", { name: handle.name, needsPermission: true });
    return { name: handle.name, needsPermission: true };
  }

  async function rescan() {
    if (!state.handle) return summary();
    return loadDirectory(state.handle, { readonly: state.readonly });
  }

  async function reopen() {
    var handle = state.pendingHandle;
    if (!handle) {
      try { handle = await idbGet("dir"); } catch (e) { handle = null; }
    }
    if (!handle) throw new Error("No previous folder to reopen.");
    var perm = "denied";
    try { if (handle.requestPermission) perm = await handle.requestPermission({ mode: "readwrite" }); }
    catch (e) { perm = "denied"; }
    state.pendingHandle = null;
    return loadDirectory(handle, { readonly: perm !== "granted" });
  }

  function openFallbackPicker() {
    var input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.style.display = "none";
    input.addEventListener("change", function () {
      var files = Array.from(input.files || []);
      if (files.length) loadFileList(files, "folder");
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  async function loadFileList(fileList, mode) {
    var files = Array.from(fileList || []);
    if (!files.length) return null;
    var pairs = [];
    files.forEach(function (f) {
      var rel = normalize(f.webkitRelativePath || f.name);
      pairs.push({ path: rel, file: f });
    });
    pairs.sort(function (a, b) { return a.path.localeCompare(b.path); });
    var firstName = pairs[0].path.split("/")[0];
    var commonRoot = pairs[0].path.indexOf("/") >= 0 && pairs.every(function (p) { return p.path.split("/")[0] === firstName; }) ? firstName : "";
    var filesOut = {};
    var skipped = 0;
    for (var i = 0; i < pairs.length; i++) {
      var path = commonRoot ? pairs[i].path.slice(commonRoot.length + 1) : pairs[i].path;
      if (!path) continue;
      if (pairs[i].file.size > MAX_BYTES) { skipped++; continue; }
      var text = "";
      try { text = await pairs[i].file.text(); } catch (e) { skipped++; continue; }
      if (text.indexOf("\u0000") >= 0) { skipped++; continue; }
      filesOut[path] = {
        path: path, name: baseName(path), content: text, base: text, saved: text,
        size: pairs[i].file.size, mtime: pairs[i].file.lastModified, handle: null,
        secret: isSecret(path), isNew: false, deleted: false
      };
    }
    if (!Object.keys(filesOut).length) throw new Error("No readable text files were found in that selection.");
    var summaryOut = adopt({
      name: commonRoot || (mode === "folder" ? "Opened folder" : "Open files"),
      handle: null, readonly: true, files: filesOut, skipped: skipped, source: "files"
    });
    summaryOut.readonly = true;
    return summaryOut;
  }

  async function openDrop(dataTransfer) {
    if (!dataTransfer) return { cancelled: true };
    var items = Array.from(dataTransfer.items || []);
    if (items.length && typeof items[0].getAsFileSystemHandle === "function") {
      var handles = [];
      for (var i = 0; i < items.length; i++) {
        try {
          var h = await items[i].getAsFileSystemHandle();
          if (h) handles.push(h);
        } catch (e) { /* ignore unsupported item */ }
      }
      var dir = handles.find(function (x) { return x.kind === "directory"; });
      if (dir) {
        var perm = "denied";
        try { if (dir.requestPermission) perm = await dir.requestPermission({ mode: "readwrite" }); } catch (e) { perm = "denied"; }
        return loadDirectory(dir, { readonly: perm !== "granted" });
      }
      var fileHandles = handles.filter(function (x) { return x.kind === "file"; });
      if (fileHandles.length) {
        var fileObjs = await Promise.all(fileHandles.map(function (fh) { return fh.getFile(); }));
        return loadFileList(fileObjs, "files");
      }
    }
    if (dataTransfer.files && dataTransfer.files.length) return loadFileList(dataTransfer.files, "files");
    return { cancelled: true };
  }

  /* -------------------------------- records ----------------------------- */
  function record(path) { return state.files[path] || null; }
  function allPaths() { return state.paths.slice(); }
  function visiblePaths() {
    return state.paths.filter(function (p) { var r = state.files[p]; return r && !r.deleted; });
  }
  function content(path) { var r = record(path); return r && !r.deleted ? r.content : ""; }
  function head(path) { var r = record(path); return r ? r.base : ""; }
  function setContent(path, text) {
    var r = record(path);
    if (!r) return false;
    r.content = String(text);
    return true;
  }
  function isDirty(path) { var r = record(path); return !!r && !r.deleted && r.content !== r.saved; }
  function dirtyPaths() { return state.paths.filter(isDirty); }
  function changes() {
    var out = [];
    state.paths.forEach(function (path) {
      var r = state.files[path];
      if (!r) return;
      if (r.deleted) { out.push({ path: path, kind: "D" }); return; }
      if (r.content === r.base && !r.isNew) return;
      out.push({ path: path, kind: r.isNew || r.base === "" ? "U" : "M" });
    });
    return out;
  }

  async function ensureFileHandle(path) {
    var parts = normalize(path).split("/");
    if (!parts.length || !parts[parts.length - 1]) throw new Error("Invalid file path.");
    var dir = state.handle;
    for (var i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    return dir.getFileHandle(parts[parts.length - 1], { create: true });
  }
  async function writeDisk(rec) {
    if (state.readonly) throw unsupported("This workspace is read-only. Reopen the folder with write access to save.", "readonly");
    if (!state.handle) throw unsupported("This workspace has no writable folder handle.", "readonly");
    var fh = rec.handle || await ensureFileHandle(rec.path);
    var writable = await fh.createWritable();
    await writable.write(rec.content);
    await writable.close();
    rec.handle = fh;
    rec.saved = rec.content;
    rec.size = new Blob([rec.content]).size;
    rec.mtime = Date.now();
  }

  async function save(path) {
    var r = record(path);
    if (!r || r.deleted) throw new Error("File is not available.");
    await writeDisk(r);
    emit("ws-saved", { path: path });
    return true;
  }
  async function saveAll() {
    var list = dirtyPaths();
    for (var i = 0; i < list.length; i++) await save(list[i]);
    return list;
  }

  async function createFile(path, text, opts) {
    opts = opts || {};
    var clean = normalize(path);
    if (!clean) throw new Error("Enter a file path.");
    var existing = record(clean);
    if (existing && !existing.deleted) {
      existing.content = String(text == null ? "" : text);
      existing.deleted = false;
      if (opts.byAgent) await writeDisk(existing);
      else if (!opts.memoryOnly && state.handle && !state.readonly) await writeDisk(existing);
      else existing.saved = existing.content;
    } else {
      var rec = {
        path: clean, name: baseName(clean), content: String(text == null ? "" : text),
        base: "", saved: String(text == null ? "" : text), size: 0, mtime: Date.now(),
        handle: existing && existing.handle || null, secret: isSecret(clean), isNew: true, deleted: false
      };
      if (opts.byAgent) await writeDisk(rec);
      else if (!opts.memoryOnly && state.handle && !state.readonly) await writeDisk(rec);
      state.files[clean] = rec;
      state.paths = Object.keys(state.files).sort(function (a, b) { return a.localeCompare(b); });
    }
    emit("ws-changed", { path: clean, action: "write" });
    return clean;
  }

  async function createFolder(path) {
    var clean = normalize(path);
    if (!clean) throw new Error("Enter a folder path.");
    if (state.readonly || !state.handle) throw unsupported("This workspace is read-only.", "readonly");
    var parts = clean.split("/");
    var dir = state.handle;
    for (var i = 0; i < parts.length; i++) dir = await dir.getDirectoryHandle(parts[i], { create: true });
    emit("ws-changed", { path: clean, action: "folder" });
    return clean;
  }

  async function deleteFile(path) {
    var r = record(path);
    if (!r) throw new Error("File not found.");
    if (state.readonly) throw unsupported("This workspace is read-only.", "readonly");
    if (state.handle) {
      try {
        var dir = state.handle;
        var parts = r.path.split("/");
        for (var i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
        await dir.removeEntry(parts[parts.length - 1]);
      } catch (e) {
        if (!e || e.name !== "NotFoundError") throw e;
      }
    }
    r.deleted = true;
    r.content = "";
    r.saved = "";
    r.handle = null;
    emit("ws-changed", { path: path, action: "delete" });
    return true;
  }

  async function revert(path) {
    var r = record(path);
    if (!r) throw new Error("File not found.");
    if (state.readonly) throw unsupported("This workspace is read-only.", "readonly");
    if (r.deleted) {
      r.deleted = false;
      r.content = r.base;
      r.isNew = false;
      r.saved = r.content;
      await writeDisk(r);
    } else if (r.isNew) {
      if (state.handle) {
        try {
          var dir = state.handle;
          var parts = r.path.split("/");
          for (var i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
          await dir.removeEntry(parts[parts.length - 1]);
        } catch (e) { /* already gone */ }
      }
      delete state.files[r.path];
      state.paths = Object.keys(state.files).sort(function (a, b) { return a.localeCompare(b); });
    } else {
      r.content = r.base;
      await writeDisk(r);
    }
    emit("ws-changed", { path: path, action: "revert" });
    return true;
  }

  async function revertAll() {
    var list = changes().map(function (c) { return c.path; });
    for (var i = 0; i < list.length; i++) {
      try { await revert(list[i]); } catch (e) { /* keep going */ }
    }
    return list;
  }

  function close() {
    state.name = "";
    state.handle = null;
    state.pendingHandle = null;
    state.readonly = false;
    state.loaded = false;
    state.source = "none";
    state.files = {};
    state.paths = [];
    state.skipped = 0;
    state.truncated = false;
    idbDelete("dir").catch(function () {});
    emit("ws-loaded", summary());
  }

  /* --------------------------------- tree ------------------------------- */
  function buildTree() {
    var root = { name: "", path: "", dirs: {}, files: [] };
    visiblePaths().forEach(function (p) {
      var parts = p.split("/");
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var name = parts[i], path = parts.slice(0, i + 1).join("/");
        if (!node.dirs[name]) node.dirs[name] = { name: name, path: path, dirs: {}, files: [] };
        node = node.dirs[name];
      }
      node.files.push({ name: parts[parts.length - 1], path: p });
    });
    (function finalize(node) {
      node.dirs = Object.keys(node.dirs).sort(function (a, b) { return a.localeCompare(b); })
        .map(function (k) { return finalize(node.dirs[k]); });
      node.files.sort(function (a, b) { return a.name.localeCompare(b.name); });
      return { name: node.name, path: node.path, dirs: node.dirs, files: node.files };
    })(root);
    return root;
  }

  function summary() {
    return {
      name: state.name,
      loaded: state.loaded,
      readonly: state.readonly,
      source: state.source,
      count: state.paths.length,
      visible: visiblePaths().length,
      skipped: state.skipped,
      truncated: state.truncated,
      changes: changes().length,
      openedAt: state.openedAt
    };
  }

  /* ----------------------------- agent helpers -------------------------- */
  function listForAgent(prefix) {
    var base = normalize(prefix || "");
    var paths = visiblePaths();
    if (base) paths = paths.filter(function (p) { return p === base || p.indexOf(base.replace(/\/$/, "") + "/") === 0; });
    var total = paths.length;
    paths = paths.slice(0, 800);
    var out = [];
    var lastDir = null;
    paths.forEach(function (p) {
      var d = dirName(p);
      if (d !== lastDir) { if (d) out.push(d + "/"); lastDir = d; }
      var r = state.files[p];
      out.push(p + "  (" + r.content.split("\n").length + " lines)");
    });
    if (total > paths.length) out.push("… " + (total - paths.length) + " more files (narrow the request)");
    return out.join("\n") || "(empty workspace)";
  }

  function readForAgent(path) {
    var clean = normalize(path);
    var r = record(clean);
    if (!r || r.deleted) return { ok: false, error: "File not found: " + path };
    if (r.secret) return { ok: false, error: "Blocked: " + clean + " looks like a secret-bearing file. Ask the user to attach it explicitly if it is needed." };
    return { ok: true, path: clean, content: r.content, lines: r.content.split("\n").length, readonly: state.readonly };
  }

  function searchAll(query, opts) {
    opts = opts || {};
    if (!query) return { ok: false, error: "Empty search query." };
    var re;
    try {
      re = opts.regex ? new RegExp(query, "gi") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    } catch (e) { return { ok: false, error: "Invalid regular expression: " + e.message }; }
    var hits = [];
    var limit = opts.limit || 60;
    for (var i = 0; i < state.paths.length && hits.length < limit; i++) {
      var path = state.paths[i];
      var r = state.files[path];
      if (!r || r.deleted || r.secret) continue;
      var lines = r.content.split("\n");
      for (var j = 0; j < lines.length && hits.length < limit; j++) {
        re.lastIndex = 0;
        if (re.test(lines[j])) hits.push({ path: path, line: j + 1, text: lines[j].trim().slice(0, 180) });
      }
    }
    return { ok: true, hits: hits, truncated: hits.length >= limit };
  }

  async function agentWrite(path, text) {
    if (state.readonly) return { ok: false, error: "The workspace is read-only; the user must reopen the folder with write access." };
    if (!state.loaded) return { ok: false, error: "No folder is open." };
    var clean = normalize(path);
    if (!clean) return { ok: false, error: "Invalid path." };
    if (isSecret(clean)) return { ok: false, error: "Refusing to write a secret-bearing path." };
    var existed = !!record(clean) && !record(clean).deleted;
    try {
      await createFile(clean, text, { byAgent: true });
      return { ok: true, path: clean, created: !existed };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async function agentDelete(path) {
    if (state.readonly) return { ok: false, error: "The workspace is read-only." };
    var clean = normalize(path);
    var r = record(clean);
    if (!r || r.deleted) return { ok: false, error: "File not found: " + path };
    if (r.secret) return { ok: false, error: "Refusing to delete a secret-bearing file." };
    try {
      await deleteFile(clean);
      return { ok: true, path: clean };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  function fileStats(path) {
    var r = record(path);
    return r ? { size: r.size, mtime: r.mtime, lines: r.content ? r.content.split("\n").length : 0 } : null;
  }

  var WS = {
    language: language,
    content: content,
    head: head,
    setContent: setContent,
    isSecret: isSecret,
    isDirty: isDirty,
    dirtyPaths: dirtyPaths,
    changes: changes,
    record: record,
    buildTree: buildTree,
    visiblePaths: visiblePaths,
    allPaths: allPaths,
    summary: summary,
    openFolder: openFolder,
    openFiles: function (files) { return loadFileList(files, "files"); },
    openDrop: openDrop,
    restore: restore,
    reopen: reopen,
    rescan: rescan,
    close: close,
    save: save,
    saveAll: saveAll,
    createFile: createFile,
    createFolder: createFolder,
    deleteFile: deleteFile,
    revert: revert,
    revertAll: revertAll,
    listForAgent: listForAgent,
    readForAgent: readForAgent,
    searchAll: searchAll,
    agentWrite: agentWrite,
    agentDelete: agentDelete,
    fileStats: fileStats,
    normalize: normalize,
    baseName: baseName,
    dirName: dirName,
    reveal: function () { /* selection is handled by the UI */ }
  };
  Object.defineProperty(WS, "projectName", { get: function () { return state.name || "No folder"; } });
  Object.defineProperty(WS, "files", { get: function () { return state.files; } });
  Object.defineProperty(WS, "loaded", { get: function () { return state.loaded; } });
  Object.defineProperty(WS, "readonly", { get: function () { return state.readonly; } });
  Object.defineProperty(WS, "hasHandle", { get: function () { return !!state.handle; } });
  Object.defineProperty(WS, "pendingHandle", { get: function () { return state.pendingHandle; } });
  Object.defineProperty(WS, "source", { get: function () { return state.source; } });
  Object.defineProperty(WS, "skipped", { get: function () { return state.skipped; } });
  Object.defineProperty(WS, "truncated", { get: function () { return state.truncated; } });

  window.WS = WS;
})();
