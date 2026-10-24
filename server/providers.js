"use strict";

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");

const PROVIDERS = Object.freeze({
  openai: { name: "OpenAI", base: "https://api.openai.com/v1", auth: "bearer" },
  anthropic: { name: "Anthropic", base: "https://api.anthropic.com/v1", auth: "anthropic" },
  google: { name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta", auth: "google" },
  xai: { name: "xAI", base: "https://api.x.ai/v1", auth: "bearer" },
  mistral: { name: "Mistral AI", base: "https://api.mistral.ai/v1", auth: "bearer" },
  deepseek: { name: "DeepSeek", base: "https://api.deepseek.com/v1", auth: "bearer" },
  groq: { name: "Groq", base: "https://api.groq.com/openai/v1", auth: "bearer" },
  openrouter: { name: "OpenRouter", base: "https://openrouter.ai/api/v1", auth: "bearer", openrouter: true },
  together: { name: "Together AI", base: "https://api.together.xyz/v1", auth: "bearer" },
  perplexity: { name: "Perplexity", base: "https://api.perplexity.ai", auth: "bearer" },
  ollama: { name: "Ollama", base: OLLAMA_URL + "/v1", auth: "none", local: true }
});

function get(id) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}

function list() {
  return Object.keys(PROVIDERS).map(function (id) {
    const provider = PROVIDERS[id];
    return { id: id, name: provider.name, keyless: provider.auth === "none", local: !!provider.local };
  });
}

function requiresKey(id) {
  const provider = get(id);
  return !!provider && provider.auth !== "none";
}

function ollamaUrl(pathname) {
  return OLLAMA_URL + pathname;
}

function connectionMessage(id, err) {
  const provider = get(id);
  if (!provider) return "Unknown provider.";
  if (provider.local) {
    return "Ollama is not reachable at " + OLLAMA_URL + ". Start it on the gateway host or set OLLAMA_URL.";
  }
  const detail = err && err.message ? " (" + err.message + ")" : "";
  return "The gateway could not reach " + provider.name + "." + detail;
}

function resolveTarget(id, subpath) {
  const provider = get(id);
  if (!provider) return null;
  if (typeof subpath !== "string" || subpath.charAt(0) !== "/") {
    throw Object.assign(new Error("Invalid upstream path."), { status: 400 });
  }
  let decoded;
  try {
    decoded = decodeURIComponent(subpath);
  } catch (err) {
    throw Object.assign(new Error("Invalid upstream path encoding."), { status: 400 });
  }
  if (decoded.indexOf("..") !== -1 || decoded.indexOf("\\") !== -1 || decoded.indexOf("\0") !== -1) {
    throw Object.assign(new Error("Invalid upstream path."), { status: 400 });
  }
  const baseUrl = new URL(provider.base);
  const targetUrl = new URL(provider.base + subpath);
  if (targetUrl.origin !== baseUrl.origin) {
    throw Object.assign(new Error("Blocked upstream origin."), { status: 403 });
  }
  if (provider.local && targetUrl.protocol !== "http:") {
    throw Object.assign(new Error("Blocked Ollama protocol."), { status: 403 });
  }
  targetUrl.searchParams.delete("key");
  targetUrl.searchParams.delete("api_key");
  return { url: targetUrl.toString(), provider: provider };
}

function authHeaders(id, key) {
  const provider = get(id);
  if (!provider || !key) return {};
  if (provider.auth === "bearer") return { Authorization: "Bearer " + key };
  if (provider.auth === "anthropic") {
    return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  }
  if (provider.auth === "google") return { "x-goog-api-key": key };
  return {};
}

function upstreamHeaders(id, key, incoming) {
  const provider = get(id);
  const headers = authHeaders(id, key);
  headers["User-Agent"] = "HugMoss-Gateway/1.0";
  const accept = incoming && incoming["accept"];
  headers.Accept = accept || "application/json";
  const contentType = incoming && incoming["content-type"];
  if (contentType) headers["Content-Type"] = contentType;
  if (provider && provider.openrouter) headers["X-Title"] = "HugMoss Code";
  return headers;
}

module.exports = {
  list: list,
  get: get,
  requiresKey: requiresKey,
  resolveTarget: resolveTarget,
  upstreamHeaders: upstreamHeaders,
  ollamaUrl: ollamaUrl,
  connectionMessage: connectionMessage,
  ollamaHost: OLLAMA_URL
};
