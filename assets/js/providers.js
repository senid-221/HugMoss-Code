/* providers.js — provider registry, official marks, bring-your-own-key storage and model catalogues. */
(function () {
  "use strict";

  var KEY_STORE = "hugmoss.keys.v1";
  var CACHE_STORE = "hugmoss.models.v1";
  var SELECT_STORE = "hugmoss.model.v1";
  var CUSTOM_STORE = "hugmoss.custom.v1";

  var COLORS = {
    openai: "#10a37f", anthropic: "#d97757", google: "#4285f4", xai: "currentColor",
    mistral: "#fa520f", deepseek: "#4d6bfe", groq: "#f55036", together: "#0f6fff",
    openrouter: "#6467f2", perplexity: "#20808d", ollama: "currentColor", meta: "#0866ff",
    qwen: "#615ced", kimi: "currentColor"
  };

  var LIST = [
    {
      id: "openai", name: "OpenAI", kind: "openai", mark: "openai", color: COLORS.openai,
      baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys",
      docs: "https://platform.openai.com/docs", auth: "bearer", cors: true,
      fallback: [
        ["gpt-4o", "GPT-4o"], ["gpt-4o-mini", "GPT-4o mini"], ["gpt-4.1", "GPT-4.1"],
        ["gpt-4.1-mini", "GPT-4.1 mini"], ["o3", "o3"], ["o4-mini", "o4-mini"]
      ]
    },
    {
      id: "anthropic", name: "Anthropic", kind: "anthropic", mark: "anthropic", color: COLORS.anthropic,
      baseUrl: "https://api.anthropic.com/v1", keyUrl: "https://console.anthropic.com/settings/keys",
      docs: "https://docs.anthropic.com", auth: "x-api-key", cors: true,
      note: "Browser calls are authorised with Anthropic's direct-browser-access header.",
      fallback: [
        ["claude-sonnet-4-5", "Claude Sonnet 4.5"], ["claude-opus-4-1", "Claude Opus 4.1"],
        ["claude-haiku-4-5", "Claude Haiku 4.5"], ["claude-3-7-sonnet-latest", "Claude Sonnet 3.7"]
      ]
    },
    {
      id: "google", name: "Google Gemini", kind: "gemini", mark: "google", color: COLORS.google,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta", keyUrl: "https://aistudio.google.com/app/apikey",
      docs: "https://ai.google.dev/gemini-api/docs", auth: "query", cors: true,
      fallback: [
        ["gemini-2.5-pro", "Gemini 2.5 Pro"], ["gemini-2.5-flash", "Gemini 2.5 Flash"],
        ["gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite"], ["gemini-2.0-flash", "Gemini 2.0 Flash"]
      ]
    },
    {
      id: "xai", name: "xAI", kind: "openai", mark: "xai", color: COLORS.xai,
      baseUrl: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", docs: "https://docs.x.ai",
      auth: "bearer", cors: true,
      fallback: [["grok-4", "Grok 4"], ["grok-3", "Grok 3"], ["grok-3-mini", "Grok 3 mini"], ["grok-code-fast-1", "Grok Code Fast"]]
    },
    {
      id: "mistral", name: "Mistral AI", kind: "openai", mark: "mistral", color: COLORS.mistral,
      baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys",
      docs: "https://docs.mistral.ai", auth: "bearer", cors: true,
      fallback: [
        ["mistral-large-latest", "Mistral Large"], ["mistral-medium-latest", "Mistral Medium"],
        ["mistral-small-latest", "Mistral Small"], ["codestral-latest", "Codestral"]
      ]
    },
    {
      id: "deepseek", name: "DeepSeek", kind: "openai", mark: "deepseek", color: COLORS.deepseek,
      baseUrl: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys",
      docs: "https://api-docs.deepseek.com", auth: "bearer", cors: true,
      fallback: [["deepseek-chat", "DeepSeek Chat"], ["deepseek-reasoner", "DeepSeek Reasoner"]]
    },
    {
      id: "groq", name: "Groq", kind: "openai", mark: "groq", color: COLORS.groq,
      baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys",
      docs: "https://console.groq.com/docs", auth: "bearer", cors: true,
      fallback: [
        ["llama-3.3-70b-versatile", "Llama 3.3 70B"], ["llama-3.1-8b-instant", "Llama 3.1 8B"],
        ["openai/gpt-oss-120b", "GPT-OSS 120B"], ["qwen/qwen3-32b", "Qwen 3 32B"],
        ["moonshotai/kimi-k2-instruct", "Kimi K2"]
      ]
    },
    {
      id: "openrouter", name: "OpenRouter", kind: "openai", mark: "openrouter", color: COLORS.openrouter,
      baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys",
      docs: "https://openrouter.ai/docs", auth: "bearer", cors: true, openrouter: true,
      fallback: [
        ["openrouter/auto", "Auto router"], ["anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5"],
        ["openai/gpt-4o", "GPT-4o"], ["google/gemini-2.5-pro", "Gemini 2.5 Pro"],
        ["deepseek/deepseek-chat", "DeepSeek Chat"], ["qwen/qwen3-coder", "Qwen3 Coder"]
      ]
    },
    {
      id: "perplexity", name: "Perplexity", kind: "openai", mark: "perplexity", color: COLORS.perplexity,
      baseUrl: "https://api.perplexity.ai", keyUrl: "https://www.perplexity.ai/settings/api",
      docs: "https://docs.perplexity.ai", auth: "bearer", cors: true, modelsPath: "/v1/models", supportsTools: false,
      fallback: [
        ["sonar", "Sonar"], ["sonar-pro", "Sonar Pro"], ["sonar-reasoning", "Sonar Reasoning"],
        ["sonar-reasoning-pro", "Sonar Reasoning Pro"], ["sonar-deep-research", "Sonar Deep Research"]
      ]
    },
    {
      id: "together", name: "Together AI", kind: "openai", mark: "together", color: COLORS.together,
      baseUrl: "https://api.together.xyz/v1", keyUrl: "https://api.together.ai/settings/api-keys",
      docs: "https://docs.together.ai", auth: "bearer", cors: true,
      fallback: [
        ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Llama 3.3 70B Turbo"],
        ["Qwen/Qwen2.5-Coder-32B-Instruct", "Qwen 2.5 Coder 32B"],
        ["deepseek-ai/DeepSeek-V3", "DeepSeek V3"]
      ]
    },
    {
      id: "ollama", name: "Ollama", kind: "openai", mark: "ollama", color: COLORS.ollama,
      baseUrl: "http://localhost:11434/v1", keyUrl: "https://ollama.com/download",
      docs: "https://github.com/ollama/ollama/blob/main/docs/openai.md", auth: "none", keyless: true,
      cors: true, note: "Run Ollama with OLLAMA_ORIGINS=* so this page may reach localhost.",
      fallback: [
        ["qwen2.5-coder:7b", "Qwen 2.5 Coder 7B"], ["qwen2.5-coder:14b", "Qwen 2.5 Coder 14B"],
        ["llama3.3:70b", "Llama 3.3 70B"], ["deepseek-r1:8b", "DeepSeek R1 8B"]
      ]
    },
    {
      id: "custom", name: "Custom endpoint", kind: "openai", mark: "openai", color: "currentColor",
      baseUrl: "", keyUrl: "", docs: "", auth: "bearer", keyless: true, cors: true, custom: true,
      note: "Any OpenAI-compatible server — vLLM, LM Studio, LiteLLM or your own proxy.",
      fallback: []
    }
  ];

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function get(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  function customConfig() {
    var cfg = readJson(CUSTOM_STORE, {});
    return { baseUrl: cfg.baseUrl || "", models: Array.isArray(cfg.models) ? cfg.models : [] };
  }
  function setCustomConfig(cfg) {
    var prev = customConfig();
    writeJson(CUSTOM_STORE, {
      baseUrl: (cfg.baseUrl != null ? cfg.baseUrl : prev.baseUrl).trim(),
      models: cfg.models != null ? cfg.models : prev.models
    });
    clearCatalog("custom");
  }
  function baseUrl(p) {
    if (!p) return "";
    if (p.custom) return customConfig().baseUrl.replace(/\/+$/, "");
    return p.baseUrl;
  }
  function available() {
    return LIST.filter(function (p) { return !p.custom || baseUrl(p); });
  }

  function keys() { return readJson(KEY_STORE, {}); }
  function key(id) { return keys()[id] || ""; }
  function setKey(id, value) {
    var all = keys();
    if (value) all[id] = value;
    else delete all[id];
    writeJson(KEY_STORE, all);
    clearCatalog(id);
  }
  function hasKey(id) {
    var p = get(id);
    return !!p && (!!key(id) || (p.keyless && (!p.custom || !!baseUrl(p))));
  }
  function configuredCount() {
    return LIST.filter(function (p) {
      if (p.custom) return !!baseUrl(p);
      if (p.keyless) return false;
      return !!key(p.id);
    }).length;
  }

  function selection() {
    var sel = readJson(SELECT_STORE, null);
    return sel && sel.provider ? sel : null;
  }
  function setSelection(provider, model, label) {
    if (!provider || !model) { try { localStorage.removeItem(SELECT_STORE); } catch (e) { /* ignore */ } return; }
    var p = get(provider);
    writeJson(SELECT_STORE, { provider: provider, model: model, label: label || model, mark: p ? p.mark : "openai" });
  }

  function familyFor(model, provider) {
    var s = String(model || "").toLowerCase();
    if (/gpt|chatgpt|^o[1-9](-|$)/.test(s)) return "openai";
    if (/claude/.test(s)) return "claude";
    if (/gemini|gemma/.test(s)) return "gemini";
    if (/grok/.test(s)) return "grok";
    if (/deepseek/.test(s)) return "deepseek";
    if (/qwen|qwq/.test(s)) return "qwen";
    if (/kimi|moonshot/.test(s)) return "kimi";
    if (/llama|meta-llama/.test(s)) return "meta";
    if (/mistral|codestral|magistral|devstral/.test(s)) return "mistral";
    if (/sonar/.test(s)) return "perplexity";
    if (/gpt-oss/.test(s)) return "openai";
    return (provider && provider.mark) || "openai";
  }
  function familyColor(mark) {
    return COLORS[mark] || "currentColor";
  }

  function labelFor(id) {
    var tail = id.split("/").pop().split(":").pop();
    return tail
      .replace(/[-_]/g, " ")
      .replace(/\b(\d+)\b/g, "$1")
      .replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); })
      .replace(/\bGpt\b/g, "GPT").replace(/\bOss\b/g, "OSS").replace(/\bAi\b/g, "AI")
      .replace(/\bLlama\b/g, "Llama");
  }

  function normalize(provider, items) {
    var seen = {};
    var out = [];
    items.forEach(function (it) {
      var id = it.id;
      if (!id || seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, label: it.label || labelFor(id), mark: familyFor(id, provider) });
    });
    return out;
  }

  function fallbackModels(provider) {
    if (provider.custom) {
      return customConfig().models.map(function (id) { return { id: id, label: labelFor(id), mark: familyFor(id, provider) }; });
    }
    return provider.fallback.map(function (m) { return { id: m[0], label: m[1], mark: familyFor(m[0], provider) }; });
  }

  function cached(providerId) {
    var all = readJson(CACHE_STORE, {});
    var entry = all[providerId];
    if (!entry || Date.now() - entry.at > 6 * 60 * 60 * 1000) return null;
    return entry.models;
  }
  function setCache(providerId, models) {
    var all = readJson(CACHE_STORE, {});
    all[providerId] = { at: Date.now(), models: models };
    writeJson(CACHE_STORE, all);
  }
  function clearCatalog(providerId) {
    var all = readJson(CACHE_STORE, {});
    if (all[providerId]) { delete all[providerId]; writeJson(CACHE_STORE, all); }
  }

  function headers(provider, apiKey) {
    var h = {};
    if (provider.auth === "bearer" && apiKey) h.Authorization = "Bearer " + apiKey;
    if (provider.auth === "x-api-key") {
      h["x-api-key"] = apiKey;
      h["anthropic-version"] = "2023-06-01";
      h["anthropic-dangerous-direct-browser-access"] = "true";
    }
    if (provider.openrouter) h["X-Title"] = "HugMoss Code";
    return h;
  }

  function withQuery(url, provider, apiKey) {
    if (provider.auth !== "query" || !apiKey) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "key=" + encodeURIComponent(apiKey);
  }

  function modelsUrl(provider) {
    var base = baseUrl(provider);
    if (provider.kind === "gemini") return base + "/models?pageSize=1000";
    return base + (provider.modelsPath || "/models");
  }

  function fetchModels(provider, opts) {
    opts = opts || {};
    var apiKey = opts.apiKey || key(provider.id);
    if (!provider.custom && !provider.keyless && !apiKey) return Promise.reject(new Error("Add an API key for " + provider.name + " first."));
    if (provider.custom && !baseUrl(provider)) return Promise.reject(new Error("Set the base URL for your custom endpoint first."));
    if (!opts.force) {
      var hit = cached(provider.id);
      if (hit) return Promise.resolve({ models: hit, source: "cache" });
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 20000);
    var started = Date.now();
    return fetch(withQuery(modelsUrl(provider), provider, apiKey), {
      method: "GET",
      headers: headers(provider, apiKey),
      signal: controller.signal
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* non-JSON error page */ }
        if (!res.ok) {
          var msg = data && data.error && (data.error.message || data.error) || res.status + " " + res.statusText;
          throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        }
        var raw = [];
        if (provider.kind === "anthropic") {
          raw = ((data && data.data) || []).map(function (m) { return { id: m.id, label: m.display_name }; });
        } else if (provider.kind === "gemini") {
          raw = ((data && data.models) || [])
            .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0; })
            .map(function (m) { return { id: String(m.name || "").replace(/^models\//, ""), label: m.displayName }; });
        } else {
          raw = ((data && data.data) || []).map(function (m) { return { id: m.id, label: provider.openrouter ? m.name || m.id : null }; });
        }
        var models = normalize(provider, raw).filter(function (m) {
          if (provider.id === "openai") return !/embedding|tts|whisper|dall-e|moderation|image|audio|realtime|transcribe|search|codex-mini/.test(m.id);
          if (provider.id === "mistral") return !/embed|moderation/.test(m.id);
          if (provider.id === "google") return /gemini|gemma/.test(m.id);
          if (provider.id === "groq") return !/whisper|tts|guard/.test(m.id);
          if (provider.id === "together") return !/embedding|rerank|vision-free/.test(m.id);
          return true;
        }).sort(function (a, b) { return a.label.localeCompare(b.label); });
        if (!models.length) throw new Error("The provider returned no usable chat models.");
        setCache(provider.id, models);
        return { models: models, source: "network", ms: Date.now() - started };
      });
    }).catch(function (err) {
      if (err && err.name === "AbortError") throw new Error("The model list request timed out.");
      throw err;
    }).finally(function () { clearTimeout(timer); });
  }

  window.Providers = {
    list: function () { return LIST; },
    available: available,
    get: get,
    baseUrl: baseUrl,
    modelsUrl: modelsUrl,
    headers: headers,
    withQuery: withQuery,
    key: key,
    setKey: setKey,
    hasKey: hasKey,
    configuredCount: configuredCount,
    selection: selection,
    setSelection: setSelection,
    customConfig: customConfig,
    setCustomConfig: setCustomConfig,
    fallbackModels: fallbackModels,
    fetchModels: fetchModels,
    cachedModels: cached,
    clearCatalog: clearCatalog,
    familyFor: familyFor,
    familyColor: familyColor,
    labelFor: labelFor,
    mark: function (name, size) {
      return window.Brands.has(name) ? window.Brands.svg(name, size) : window.Brands.svg("openai", size);
    }
  };
})();
