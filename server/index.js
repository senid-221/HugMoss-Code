"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const providers = require("./providers");
const pkg = require("../package.json");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_MODE = process.argv.includes("--source");
const WEB_ROOT = SOURCE_MODE ? ROOT : path.join(ROOT, "dist");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const BODY_LIMIT = Number(process.env.BODY_LIMIT) || 8 * 1024 * 1024;
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 120;
const RATE_WINDOW = 60 * 1000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(function (value) { return value.trim().replace(/\/+$/, ""); })
  .filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

const activeControllers = new Set();

if (!fs.existsSync(path.join(WEB_ROOT, "index.html"))) {
  console.error("HugMoss gateway: " + path.join(WEB_ROOT, "index.html") + " is missing.");
  console.error('Build the app first with "npm run build", or start in source mode with "npm run dev".');
  process.exit(1);
}

function sendJson(res, status, payload, extra) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  const headers = Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }, extra || {});
  res.writeHead(status, headers);
  res.end(body);
}

function fail(res, status, message, extra) {
  sendJson(res, status, { error: { message: message } }, extra);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const normalized = String(origin).replace(/\/+$/, "");
  if (ALLOWED_ORIGINS.indexOf(normalized) !== -1) return true;
  try {
    return new URL(normalized).host === req.headers.host;
  } catch (err) {
    return false;
  }
}

function corsHeaders(req) {
  if (!req.headers.origin || !originAllowed(req)) return {};
  return {
    "Access-Control-Allow-Origin": String(req.headers.origin),
    Vary: "Origin"
  };
}

const buckets = new Map();

function clientIp(req) {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function withinRateLimit(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const bucket = buckets.get(ip);
  if (!bucket || now > bucket.reset) {
    buckets.set(ip, { count: 1, reset: now + RATE_WINDOW });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT;
}

setInterval(function () {
  const now = Date.now();
  buckets.forEach(function (bucket, ip) {
    if (now > bucket.reset) buckets.delete(ip);
  });
}, RATE_WINDOW).unref();

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    let settled = false;
    const chunks = [];

    function finish(err, body) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(body);
    }

    req.on("data", function (chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        finish(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () { finish(null, Buffer.concat(chunks)); });
    req.on("error", function (err) { finish(err); });
    req.on("aborted", function () {
      finish(Object.assign(new Error("Request aborted."), { status: 400 }));
    });
  });
}

function watchAbort(req, res, controller) {
  activeControllers.add(controller);
  res.on("close", function () {
    activeControllers.delete(controller);
    if (!res.writableEnded) controller.abort();
  });
}

function forwardHeaders(req, upstream) {
  const headers = {};
  const contentType = upstream.headers.get("content-type");
  const retryAfter = upstream.headers.get("retry-after");
  const requestId = upstream.headers.get("x-request-id");
  if (contentType) headers["Content-Type"] = contentType;
  if (retryAfter) headers["Retry-After"] = retryAfter;
  if (requestId) headers["X-Request-Id"] = requestId;
  headers["Cache-Control"] = "no-store";
  headers["X-Accel-Buffering"] = "no";
  headers["X-Content-Type-Options"] = "nosniff";
  return Object.assign(headers, corsHeaders(req));
}

async function pipeUpstream(req, res, upstream) {
  res.writeHead(upstream.status, forwardHeaders(req, upstream));
  if (!upstream.body) {
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (!res.destroyed) res.destroy();
  }
}

async function handleAI(req, res, rest, search) {
  const slash = rest.indexOf("/");
  const id = slash === -1 ? rest : rest.slice(0, slash);
  const subpath = (slash === -1 ? "/" : rest.slice(slash)) + search;

  if (!providers.get(id)) return fail(res, 404, "Unknown provider.");
  if (req.method !== "GET" && req.method !== "POST") {
    return fail(res, 405, "Use GET or POST for provider requests.", { Allow: "GET, POST, OPTIONS" });
  }

  let target;
  try {
    target = providers.resolveTarget(id, subpath);
  } catch (err) {
    return fail(res, err.status || 400, err.message);
  }

  const key = String(req.headers["x-hugmoss-key"] || "").trim();
  if (providers.requiresKey(id) && !key) {
    return fail(res, 401, "This provider needs an API key. Add one in Settings.");
  }

  let body;
  if (req.method === "POST") {
    const contentType = String(req.headers["content-type"] || "");
    if (!/^application\/json\b/i.test(contentType)) {
      return fail(res, 415, "Content-Type must be application/json.");
    }
    try {
      body = await readBody(req, BODY_LIMIT);
    } catch (err) {
      return fail(res, err.status || 400, err.message);
    }
    if (!body.length) return fail(res, 400, "The request body is empty.");
  }

  const controller = new AbortController();
  watchAbort(req, res, controller);

  let upstream;
  try {
    upstream = await fetch(target.url, {
      method: req.method,
      headers: providers.upstreamHeaders(id, key, req.headers),
      body: body,
      signal: controller.signal
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    return fail(res, 502, providers.connectionMessage(id, err));
  }

  await pipeUpstream(req, res, upstream);
}

async function handleOllamaTags(req, res) {
  if (req.method !== "GET") return fail(res, 405, "Use GET for model discovery.", { Allow: "GET, OPTIONS" });
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(function () {
    timedOut = true;
    controller.abort();
  }, 15000);
  watchAbort(req, res, controller);
  let upstream;
  try {
    upstream = await fetch(providers.ollamaUrl("/api/tags"), {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } catch (err) {
    if (timedOut) return fail(res, 502, providers.connectionMessage("ollama", err));
    return;
  } finally {
    clearTimeout(timer);
  }
  await pipeUpstream(req, res, upstream);
}

async function handleOllamaPull(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Use POST to download a model.", { Allow: "POST, OPTIONS" });
  let body;
  try {
    body = await readBody(req, 64 * 1024);
  } catch (err) {
    return fail(res, err.status || 400, err.message);
  }
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch (err) {
    return fail(res, 400, "The request body must be JSON.");
  }
  const model = payload && typeof payload.model === "string" ? payload.model.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,159}$/.test(model)) {
    return fail(res, 400, "Enter a valid Ollama model name.");
  }

  const controller = new AbortController();
  watchAbort(req, res, controller);
  let upstream;
  try {
    upstream = await fetch(providers.ollamaUrl("/api/pull"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ model: model, stream: true }),
      signal: controller.signal
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    return fail(res, 502, providers.connectionMessage("ollama", err));
  }
  await pipeUpstream(req, res, upstream);
}

function healthPayload() {
  return {
    ok: true,
    service: "hugmoss-gateway",
    version: pkg.version,
    providers: providers.list(),
    features: { streaming: true, ollama: true, keys: "per-request" }
  };
}

async function handleApi(req, res, url) {
  if (!originAllowed(req)) {
    return fail(res, 403, "This origin is not allowed to use the gateway.");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, Object.assign({
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, X-HugMoss-Key",
      "Access-Control-Max-Age": "600"
    }, corsHeaders(req)));
    res.end();
    return;
  }
  if (!withinRateLimit(req)) {
    return fail(res, 429, "Too many requests. Try again in a minute.", {
      "Retry-After": "60",
      "X-RateLimit-Limit": String(RATE_LIMIT)
    });
  }

  if (url.pathname === "/api/health") {
    if (req.method !== "GET") return fail(res, 405, "Use GET for health checks.", { Allow: "GET, OPTIONS" });
    return sendJson(res, 200, healthPayload(), corsHeaders(req));
  }
  if (url.pathname === "/api/ollama/tags") return handleOllamaTags(req, res);
  if (url.pathname === "/api/ollama/pull") return handleOllamaPull(req, res);
  if (url.pathname.indexOf("/api/ai/") === 0) {
    return handleAI(req, res, url.pathname.slice("/api/ai/".length), url.search);
  }
  return fail(res, 404, "Unknown gateway route.");
}

function notFound(res) {
  sendJson(res, 404, { error: { message: "Not found." } });
}

function serveFile(req, res, filePath, rel) {
  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) return notFound(res);
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": rel.indexOf("/assets/") === 0 ? "public, max-age=300, must-revalidate" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "SAMEORIGIN"
    };
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    pipeline(fs.createReadStream(filePath), res).catch(function () {
      if (!res.destroyed) res.destroy();
    });
  });
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return fail(res, 405, "Method not allowed.", { Allow: "GET, HEAD" });
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (err) {
    return fail(res, 400, "The requested path is not valid.");
  }
  if (rel.indexOf("\0") !== -1 || rel.indexOf("\\") !== -1) {
    return fail(res, 400, "The requested path is not valid.");
  }
  if (rel === "/" || rel === "") rel = "/index.html";
  if (SOURCE_MODE && rel !== "/index.html" && rel.indexOf("/assets/") !== 0) {
    return notFound(res);
  }
  const filePath = path.resolve(WEB_ROOT, "." + rel);
  if (filePath !== WEB_ROOT && filePath.indexOf(WEB_ROOT + path.sep) !== 0) {
    return fail(res, 403, "The requested path is outside the web root.");
  }
  if (!path.extname(rel)) {
    return serveFile(req, res, path.join(WEB_ROOT, "index.html"), "/index.html");
  }
  return serveFile(req, res, filePath, rel);
}

async function route(req, res) {
  const started = Date.now();
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));

  res.on("finish", function () {
    console.log(req.method + " " + url.pathname + " " + res.statusCode + " " + (Date.now() - started) + "ms");
  });

  if (url.pathname.indexOf("/api/") === 0) {
    await handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url.pathname);
}

const server = http.createServer(function (req, res) {
  Promise.resolve(route(req, res)).catch(function (err) {
    if (!res.headersSent) {
      fail(res, err.status || 500, err.status ? err.message : "The gateway hit an unexpected error.");
    } else if (!res.writableEnded) {
      res.end();
    }
    if (!err.status) console.error(err);
  });
});

server.listen(PORT, HOST, function () {
  console.log("HugMoss gateway " + pkg.version + " listening on http://" + HOST + ":" + PORT);
  console.log("Serving " + WEB_ROOT + (SOURCE_MODE ? " (source mode)" : ""));
  console.log("Ollama upstream " + providers.ollamaHost);
});

function shutdown(signal) {
  console.log("HugMoss gateway received " + signal + ", shutting down.");
  activeControllers.forEach(function (controller) { controller.abort(); });
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 5000).unref();
}

process.on("SIGINT", function () { shutdown("SIGINT"); });
process.on("SIGTERM", function () { shutdown("SIGTERM"); });
