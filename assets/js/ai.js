/* ai.js — streaming chat + tool-call transport for OpenAI-compatible, Anthropic and Gemini APIs. */
(function () {
  "use strict";

  function AIError(message, status, provider) {
    var err = new Error(message);
    err.name = "AIError";
    err.status = status || 0;
    err.provider = provider || "";
    return err;
  }

  function textOf(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map(function (part) {
        if (typeof part === "string") return part;
        return part && (part.text || part.content) || "";
      }).join("");
    }
    return value == null ? "" : String(value);
  }

  function usageOf(raw, kind) {
    if (!raw) return null;
    if (kind === "anthropic") {
      return { input: raw.input_tokens || 0, output: raw.output_tokens || 0, total: (raw.input_tokens || 0) + (raw.output_tokens || 0) };
    }
    if (kind === "gemini") {
      return { input: raw.promptTokenCount || 0, output: raw.candidatesTokenCount || 0, total: raw.totalTokenCount || 0 };
    }
    return { input: raw.prompt_tokens || 0, output: raw.completion_tokens || 0, total: raw.total_tokens || 0 };
  }

  function parseArgs(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try { return JSON.parse(raw); }
    catch (e) { return { __parseError: "The model produced invalid JSON arguments." }; }
  }

  function checkResponse(res, provider) {
    if (res.ok) return Promise.resolve(res);
    return res.text().then(function (text) {
      var message = "";
      try {
        var data = JSON.parse(text);
        var e = data.error || data;
        message = e.message || e.detail || (typeof e === "string" ? e : "");
        if (!message) message = JSON.stringify(data).slice(0, 400);
      } catch (err) { message = text.slice(0, 400); }
      throw AIError(message || res.status + " " + res.statusText, res.status, provider.name);
    });
  }

  async function readSSE(response, onEvent) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var eventName = "";
    var dataLines = [];

    function dispatch() {
      if (!dataLines.length) { eventName = ""; return; }
      var payload = dataLines.join("\n");
      var name = eventName;
      eventName = "";
      dataLines = [];
      onEvent(name, payload);
    }

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split("\n");
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\r$/, "");
        if (line === "") { dispatch(); continue; }
        if (line.charAt(0) === ":") continue;
        if (line.indexOf("event:") === 0) eventName = line.slice(6).trim();
        else if (line.indexOf("data:") === 0) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      var tail = buffer.replace(/\r$/, "");
      if (tail.indexOf("data:") === 0) dataLines.push(tail.slice(5).replace(/^ /, ""));
    }
    dispatch();
  }

  /* ------------------------------ OpenAI -------------------------------- */
  function openAIMessages(system, messages) {
    var out = [];
    if (system) out.push({ role: "system", content: system });
    messages.forEach(function (m) {
      if (m.role === "user") out.push({ role: "user", content: m.text });
      else if (m.role === "assistant") {
        var msg = { role: "assistant", content: m.text || (m.toolCalls && m.toolCalls.length ? null : "") };
        if (m.toolCalls && m.toolCalls.length) {
          msg.tool_calls = m.toolCalls.map(function (tc) {
            return { id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } };
          });
        }
        out.push(msg);
      } else if (m.role === "tool") {
        (m.results || []).forEach(function (r) {
          out.push({ role: "tool", tool_call_id: r.id, content: r.content });
        });
      }
    });
    return out;
  }

  async function streamOpenAI(provider, opts) {
    var url = Providers.baseUrl(provider).replace(/\/+$/, "") + "/chat/completions";
    var body = {
      model: opts.model,
      messages: openAIMessages(opts.system, opts.messages),
      stream: true
    };
    if (opts.tools && opts.tools.length && provider.supportsTools !== false) {
      body.tools = opts.tools.map(function (t) {
        return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } };
      });
      body.tool_choice = "auto";
    }
    var res = await fetch(url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, Providers.headers(provider, opts.apiKey)),
      body: JSON.stringify(body),
      signal: opts.signal
    });
    await checkResponse(res, provider);
    var contentType = res.headers.get("content-type") || "";
    var text = "", reasoning = "", finish = "";
    var tools = [];
    var usage = null;

    function applyDelta(delta) {
      if (!delta) return;
      if (delta.content != null) {
        var piece = textOf(delta.content);
        if (piece) { text += piece; opts.onText && opts.onText(piece, text); }
      }
      var think = delta.reasoning_content || delta.reasoning;
      if (think) { reasoning += think; opts.onReasoning && opts.onReasoning(think, reasoning); }
      if (delta.tool_calls) {
        delta.tool_calls.forEach(function (part) {
          var index = typeof part.index === "number" ? part.index : tools.length;
          if (!tools[index]) tools[index] = { id: "", name: "", argsRaw: "" };
          var slot = tools[index];
          if (part.id) slot.id = part.id;
          if (part.function && part.function.name) slot.name += part.function.name;
          if (part.function && part.function.arguments) slot.argsRaw += part.function.arguments;
        });
      }
    }

    if (contentType.indexOf("text/event-stream") === -1) {
      var data = null;
      try { data = JSON.parse(await res.text()); } catch (e) { throw AIError("The provider returned a non-JSON response.", res.status, provider.name); }
      if (data.error) throw AIError(data.error.message || String(data.error), res.status, provider.name);
      var choice = (data.choices || [])[0] || {};
      applyDelta(choice.message || {});
      finish = choice.finish_reason || "stop";
      usage = usageOf(data.usage, "openai");
    } else {
      await readSSE(res, function (name, payload) {
        if (payload === "[DONE]") return;
        var event;
        try { event = JSON.parse(payload); } catch (e) { return; }
        if (event.error) throw AIError(event.error.message || String(event.error), event.error.code || 0, provider.name);
        var choice = (event.choices || [])[0];
        if (choice) {
          applyDelta(choice.delta);
          if (choice.finish_reason) finish = choice.finish_reason;
        }
        if (event.usage) usage = usageOf(event.usage, "openai");
      });
    }

    var toolCalls = tools.filter(function (t) { return t && t.name; }).map(function (t, i) {
      return { id: t.id || "call_" + i + "_" + Date.now().toString(36), name: t.name, args: parseArgs(t.argsRaw) };
    });
    return { text: text, reasoning: reasoning, toolCalls: toolCalls, usage: usage, finish: finish || "stop" };
  }

  /* ----------------------------- Anthropic ------------------------------ */
  function anthropicMessages(messages) {
    var out = [];
    function push(role, blocks) {
      if (!blocks.length) return;
      var last = out[out.length - 1];
      if (last && last.role === role) last.content = last.content.concat(blocks);
      else out.push({ role: role, content: blocks });
    }
    messages.forEach(function (m) {
      if (m.role === "user") {
        if (m.text) push("user", [{ type: "text", text: m.text }]);
      } else if (m.role === "assistant") {
        var blocks = [];
        if (m.text) blocks.push({ type: "text", text: m.text });
        (m.toolCalls || []).forEach(function (tc) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args || {} });
        });
        push("assistant", blocks);
      } else if (m.role === "tool") {
        push("user", (m.results || []).map(function (r) {
          return { type: "tool_result", tool_use_id: r.id, content: r.content, is_error: !!r.isError };
        }));
      }
    });
    if (out.length && out[0].role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "Continue." }] });
    return out;
  }

  async function streamAnthropic(provider, opts) {
    var url = Providers.baseUrl(provider).replace(/\/+$/, "") + "/messages";
    var body = {
      model: opts.model,
      max_tokens: opts.maxTokens || 8192,
      system: opts.system || undefined,
      messages: anthropicMessages(opts.messages),
      stream: true
    };
    if (opts.tools && opts.tools.length && provider.supportsTools !== false) {
      body.tools = opts.tools.map(function (t) {
        return { name: t.name, description: t.description, input_schema: t.parameters };
      });
    }
    var res = await fetch(url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, Providers.headers(provider, opts.apiKey)),
      body: JSON.stringify(body),
      signal: opts.signal
    });
    await checkResponse(res, provider);
    var text = "", reasoning = "", finish = "", usage = null;
    var blocks = {};
    var toolCalls = [];

    function handleEvent(event) {
      var type = event.type;
      if (type === "error") throw AIError((event.error && event.error.message) || "The model returned an error.", 0, provider.name);
      if (type === "message_start" && event.message && event.message.usage) usage = usageOf(event.message.usage, "anthropic");
      if (type === "content_block_start" && event.content_block) {
        blocks[event.index] = { type: event.content_block.type, id: event.content_block.id, name: event.content_block.name, json: "", text: "" };
      }
      if (type === "content_block_delta" && event.delta) {
        var block = blocks[event.index];
        if (event.delta.type === "text_delta") {
          text += event.delta.text || "";
          opts.onText && opts.onText(event.delta.text || "", text);
        } else if (event.delta.type === "input_json_delta") {
          if (block) block.json += event.delta.partial_json || "";
        } else if (event.delta.type === "thinking_delta") {
          reasoning += event.delta.thinking || "";
          opts.onReasoning && opts.onReasoning(event.delta.thinking || "", reasoning);
        }
      }
      if (type === "content_block_stop") {
        var done = blocks[event.index];
        if (done && done.type === "tool_use") {
          toolCalls.push({ id: done.id || "call_" + toolCalls.length, name: done.name, args: parseArgs(done.json) });
        }
      }
      if (type === "message_delta") {
        if (event.delta && event.delta.stop_reason) finish = event.delta.stop_reason;
        if (event.usage) {
          usage = { input: usage ? usage.input : (event.usage.input_tokens || 0), output: event.usage.output_tokens || 0 };
          usage.total = usage.input + usage.output;
        }
      }
    }

    await readSSE(res, function (name, payload) {
      var event;
      try { event = JSON.parse(payload); } catch (e) { return; }
      handleEvent(event);
    });
    return { text: text, reasoning: reasoning, toolCalls: toolCalls, usage: usage, finish: finish || "stop" };
  }

  /* ------------------------------- Gemini ------------------------------- */
  function cleanSchema(schema) {
    if (!schema || typeof schema !== "object") return schema;
    if (Array.isArray(schema)) return schema.map(cleanSchema);
    var out = {};
    Object.keys(schema).forEach(function (k) {
      if (k === "additionalProperties" || k === "$schema" || k === "strict") return;
      out[k] = cleanSchema(schema[k]);
    });
    return out;
  }

  function geminiContents(messages) {
    var out = [];
    messages.forEach(function (m) {
      if (m.role === "user") {
        out.push({ role: "user", parts: [{ text: m.text }] });
      } else if (m.role === "assistant") {
        var parts = [];
        if (m.text) parts.push({ text: m.text });
        (m.toolCalls || []).forEach(function (tc) {
          parts.push({ functionCall: { name: tc.name, args: tc.args || {} } });
        });
        if (parts.length) out.push({ role: "model", parts: parts });
      } else if (m.role === "tool") {
        out.push({
          role: "user",
          parts: (m.results || []).map(function (r) {
            return { functionResponse: { name: r.name, response: { result: r.content } } };
          })
        });
      }
    });
    return out;
  }

  async function streamGemini(provider, opts) {
    var base = Providers.baseUrl(provider).replace(/\/+$/, "");
    var url = base + "/models/" + encodeURIComponent(opts.model) + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(opts.apiKey || "");
    var body = {
      systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
      contents: geminiContents(opts.messages),
      generationConfig: { maxOutputTokens: opts.maxTokens || 8192 }
    };
    if (opts.tools && opts.tools.length && provider.supportsTools !== false) {
      body.tools = [{
        functionDeclarations: opts.tools.map(function (t) {
          return { name: t.name, description: t.description, parameters: cleanSchema(t.parameters) };
        })
      }];
    }
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal
    });
    await checkResponse(res, provider);
    var text = "", reasoning = "", finish = "", usage = null;
    var toolCalls = [];
    var seen = {};

    function apply(data) {
      if (data.error) throw AIError(data.error.message || String(data.error), 0, provider.name);
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw AIError("The prompt was blocked by Gemini: " + data.promptFeedback.blockReason, 0, provider.name);
      }
      var candidate = (data.candidates || [])[0];
      if (!candidate) return;
      var parts = (candidate.content && candidate.content.parts) || [];
      parts.forEach(function (part) {
        if (part.thought) {
          reasoning += part.text || "";
          opts.onReasoning && opts.onReasoning(part.text || "", reasoning);
          return;
        }
        if (part.text) {
          text += part.text;
          opts.onText && opts.onText(part.text, text);
        }
        if (part.functionCall) {
          var key = part.functionCall.name + JSON.stringify(part.functionCall.args || {});
          if (!seen[key]) {
            seen[key] = 1;
            toolCalls.push({
              id: "call_" + toolCalls.length + "_" + Date.now().toString(36),
              name: part.functionCall.name,
              args: part.functionCall.args || {}
            });
          }
        }
      });
      if (candidate.finishReason) finish = String(candidate.finishReason).toLowerCase();
      if (data.usageMetadata) usage = usageOf(data.usageMetadata, "gemini");
    }

    await readSSE(res, function (name, payload) {
      var data;
      try { data = JSON.parse(payload); } catch (e) { return; }
      apply(data);
    });
    return { text: text, reasoning: reasoning, toolCalls: toolCalls, usage: usage, finish: finish || "stop" };
  }

  /* ----------------------------- public API ----------------------------- */
  async function stream(opts) {
    var provider = Providers.get(opts.providerId);
    if (!provider) throw AIError("Unknown provider: " + opts.providerId);
    if (!opts.model) throw AIError("Choose a model first.");
    if (!provider.keyless && !opts.apiKey) throw AIError("No API key is configured for " + provider.name + ".");
    if (provider.custom && !Providers.baseUrl(provider)) throw AIError("Set a base URL for your custom endpoint in Settings.");
    try {
      if (provider.kind === "anthropic") return await streamAnthropic(provider, opts);
      if (provider.kind === "gemini") return await streamGemini(provider, opts);
      return await streamOpenAI(provider, opts);
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      if (err && err.name === "AIError") throw err;
      if (err instanceof TypeError) {
        var hint = provider.id === "ollama"
          ? "Could not reach Ollama at " + Providers.baseUrl(provider) + ". Is it running, and started with OLLAMA_ORIGINS=*?"
          : "Could not reach " + provider.name + ". Check your connection, the API key, and CORS/proxy settings.";
        throw AIError(hint + (err.message ? " (" + err.message + ")" : ""), 0, provider.name);
      }
      throw AIError(err && err.message || "The request failed.", err && err.status || 0, provider.name);
    }
  }

  window.AI = {
    stream: stream
  };
})();
