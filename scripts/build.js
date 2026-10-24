"use strict";

const fs = require("node:fs");
const path = require("node:path");

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

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(root, "index.html"), path.join(dist, "index.html"));
fs.cpSync(path.join(root, "assets"), path.join(dist, "assets"), { recursive: true });

const total = measure(dist);
console.log("HugMoss build: " + total.files + " files, " + (total.bytes / 1024 / 1024).toFixed(2) + " MB -> dist/");
