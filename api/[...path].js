"use strict";

const { routeApi } = require("../server/app");

module.exports = function handler(req, res) {
  return Promise.resolve(routeApi(req, res)).catch(function (err) {
    if (!res.headersSent) {
      const status = err && err.status ? err.status : 500;
      const message = err && err.status ? err.message : "The gateway hit an unexpected error.";
      const body = JSON.stringify({ error: { message: message } });
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(body);
    } else if (!res.writableEnded) {
      res.end();
    }
    if (!err || !err.status) console.error(err);
  });
};
