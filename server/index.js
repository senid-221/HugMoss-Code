"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { routeApi, abortAll } = require("./app");
const pkg = require("../package.json");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_MODE = process.argv.includes("--source");
const WEB_ROOT = SOURCE_MODE ? ROOT : path.join(ROOT, "dist");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

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

if (!fs.existsSync(path.join(WEB_ROOT, "index.html"))) {
  console.error("HugMoss gateway: " + path.join(WEB_ROOT, "index.html") + " is missing.");
  console.error('Build the app first with "npm run build", or start in source mode with "npm run dev".');
  process.exit(1);
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
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
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "SAMEORIGIN"
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    pipeline(fs.createReadStream(filePath), res).catch(function () {
      if (!res.destroyed) res.destroy();
    });
  });
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: { message: "Method not allowed." } });
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (err) {
    sendJson(res, 400, { error: { message: "The requested path is not valid." } });
    return;
  }
  if (rel.indexOf("\0") !== -1 || rel.indexOf("\\") !== -1) {
    sendJson(res, 400, { error: { message: "The requested path is not valid." } });
    return;
  }
  if (rel === "/" || rel === "") rel = "/index.html";
  if (SOURCE_MODE && rel !== "/index.html" && rel.indexOf("/assets/") !== 0) {
    return notFound(res);
  }
  const filePath = path.resolve(WEB_ROOT, "." + rel);
  if (filePath !== WEB_ROOT && filePath.indexOf(WEB_ROOT + path.sep) !== 0) {
    sendJson(res, 403, { error: { message: "The requested path is outside the web root." } });
    return;
  }
  if (!path.extname(rel)) {
    return serveFile(req, res, path.join(WEB_ROOT, "index.html"), "/index.html");
  }
  return serveFile(req, res, filePath, rel);
}

function handleError(res, err) {
  if (!res.headersSent) {
    sendJson(res, err.status || 500, {
      error: { message: err.status ? err.message : "The gateway hit an unexpected error." }
    });
  } else if (!res.writableEnded) {
    res.end();
  }
  if (!err.status) console.error(err);
}

const server = http.createServer(function (req, res) {
  const started = Date.now();
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));

  res.on("finish", function () {
    console.log(req.method + " " + url.pathname + " " + res.statusCode + " " + (Date.now() - started) + "ms");
  });

  if (url.pathname.indexOf("/api/") === 0) {
    Promise.resolve(routeApi(req, res)).catch(function (err) { handleError(res, err); });
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, function () {
  console.log("HugMoss gateway " + pkg.version + " listening on http://" + HOST + ":" + PORT);
  console.log("Serving " + WEB_ROOT + (SOURCE_MODE ? " (source mode)" : ""));
  console.log("Ollama upstream " + require("./providers").ollamaHost);
});

function shutdown(signal) {
  console.log("HugMoss gateway received " + signal + ", shutting down.");
  abortAll();
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 5000).unref();
}

process.on("SIGINT", function () { shutdown("SIGINT"); });
process.on("SIGTERM", function () { shutdown("SIGTERM"); });
