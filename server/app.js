"use strict";

const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const providers = require("./providers");
const pkg = require("../package.json");

const BODY_LIMIT = Number(process.env.BODY_LIMIT) || 8 * 1024 * 1024;
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 120;
const RATE_WINDOW = 60 * 1000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(function (value) { return value.trim().replace(/\/+$/, ""); })
  .filter(Boolean);

const activeControllers = new Set();

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

function abortAll() {
  activeControllers.forEach(function (controller) { controller.abort(); });
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

  const key = String(req.headers["x-hugmoss-key"] || "").trim() || providers.hostedKey(id);
  if (providers.requiresKey(id) && !key) {
    return fail(res, 401, "This provider needs an API key. Add one in Settings, or configure one on the gateway.");
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
  const timer = setTimeout(function () { controller.abort(); }, 15000);
  watchAbort(req, res, controller);
  let upstream;
  try {
    upstream = await fetch(providers.ollamaUrl("/api/tags"), {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } catch (err) {
    if (res.destroyed || res.headersSent) return;
    if (controller.signal.aborted) {
      return fail(res, 504, "Ollama did not answer in time.");
    }
    return fail(res, 502, providers.connectionMessage("ollama", err));
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
    features: { streaming: true, ollama: true, keys: "request-or-hosted" }
  };
}

async function handleApi(req, res, url) {
  if (!originAllowed(req)) {
    return fail(res, 403, "This origin is not allowed to use the gateway.");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, Object.assign({
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, X-Hugmoss-Key",
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

async function routeApi(req, res) {
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
  if (url.pathname.indexOf("/api/") !== 0) {
    return fail(res, 404, "Unknown gateway route.");
  }
  await handleApi(req, res, url);
}

module.exports = {
  routeApi: routeApi,
  healthPayload: healthPayload,
  abortAll: abortAll
};
