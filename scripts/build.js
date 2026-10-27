"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

function measure(dir) {
  let files = 0;
  let bytes = 0;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = measure(full);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  });
  return { files: files, bytes: bytes };
}

function fingerprint(dir, hash) {
  fs.readdirSync(dir, { withFileTypes: true })
    .sort(function (a, b) { return a.name < b.name ? -1 : 1; })
    .forEach(function (entry) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fingerprint(full, hash);
      } else {
        hash.update(entry.name);
        hash.update(fs.readFileSync(full));
      }
    });
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(path.join(root, "assets"), path.join(dist, "assets"), { recursive: true });

const hash = crypto.createHash("sha1");
fingerprint(path.join(dist, "assets"), hash);
const stamp = hash.digest("hex").slice(0, 8);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8")
  .replace(/(assets\/(?:css|js)\/[^"'?]+\.(?:css|js))(?=["'])/g, "$1?v=" + stamp);
fs.writeFileSync(path.join(dist, "index.html"), html);

const total = measure(dist);
console.log("HugMoss build: " + total.files + " files, " + (total.bytes / 1024 / 1024).toFixed(2) + " MB -> dist/");
