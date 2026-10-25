# HugMoss Code

<p align="center"><img src="assets/img/hugmoss-128.png" width="96" height="96" alt="HugMoss logo"></p>

A browser-based agentic coding IDE. Open a real folder from your disk, edit real files, and talk to a real language model through your own API key — with an agent that reads, searches, plans, and writes files under your approval.

HugMoss runs in two modes:

- **Gateway mode** — the bundled Node server serves the app and relays provider traffic, which removes browser CORS limits and keeps Ollama on localhost. Recommended for local use and deployment.
- **Direct mode** — host `index.html` and `assets/` on any static server. The browser calls providers itself, exactly as it did before the gateway existed. HugMoss detects which mode it is in at startup.

There are no runtime dependencies, no framework, and no build step beyond copying static files.

---

## What is real

- **The workspace** is your folder. HugMoss uses the File System Access API to read and write files in place. File contents are never uploaded to a HugMoss service.
- **The agent** calls the selected provider with your key. In gateway mode the key is forwarded per request by your own server; in direct mode it goes straight from the tab to the provider. No key is stored server-side.
- **The changes view** compares your session edits against the folder contents from the moment you opened it, and against what is currently on disk.
- **The terminal** is a file shell over the open folder. It lists, reads, and searches files; it does not execute programs.

## What is honest

A browser tab cannot spawn processes, attach a debugger, run a language server, or execute `git`. HugMoss does not pretend otherwise. Builds, tests, git operations, and long-running servers belong in your own terminal; the UI tells you so where it matters.

## Highlights

- **Explorer** — real folder tree with file-type icons, dirty markers, outline and timeline, new file/folder, refresh and collapse.
- **Editor** — editable tabs, syntax highlighting for 11 languages, live breadcrumb trail, outline, canvas minimap, word wrap, configurable font size, and unsaved-change protection.
- **Search** — cross-file search with match case, whole word and regular-expression toggles, grouped results and hit counts.
- **Changes** — per-session diffs against the folder baseline, unified diff view, revert a file, save individual files or everything.
- **Terminal** — multi-session file shell with history, tab completion, syntax colouring and `open`/`download`/`tree` helpers.
- **Agent** — Ask / Agent / Plan modes, streamed prose, structured todos, expandable tool cards, per-edit approval with inline diffs, stop control, and session history.
- **NVIDIA Skills** — a searchable catalogue of the official NVIDIA Agent Skills for AI and machine learning. Activate up to six; their real `SKILL.md` instructions are fetched from `NVIDIA/skills` on GitHub and appended to the agent system prompt on the next request.
- **Workspace chrome** — command palette, menus, settings, provider manager, notifications, toasts, problems panel, status bar, resizable panes, dark and light themes, responsive drawers.

## Run it

Node.js 20 or newer is required for the gateway.

```bash
git clone https://github.com/senid-221/HugMoss-Code.git
cd HugMoss-Code

npm run build     # copies index.html and assets/ into dist/
npm start         # serves dist/ and the /api gateway on http://localhost:3000
```

For development without the copy step:

```bash
npm run dev       # serves index.html and assets/ directly, same gateway
```

Change the port with `PORT=8080 npm start` (macOS/Linux) or `$env:PORT=8080; npm start` (PowerShell). The first line of output confirms the web root, port, and Ollama upstream.

### Static-only mode

The app still works without Node. Serve the repository root (or `dist/`) with any static server:

```bash
python -m http.server 8080
# or
npx serve .
```

Then visit `http://localhost:8080`. At startup the app probes `/api/health`; when no gateway answers, it falls back to direct browser calls. Direct mode requires provider CORS support — see [CORS](#cors-and-direct-mode).

Chrome or Edge is required for folder write access. Firefox and Safari fall back to read-only file picking, drag-and-drop, and the editor without disk writes.

## Gateway

The gateway is a small zero-dependency HTTP server in `server/`. It does three jobs:

1. Serves the built app from `dist/` (or the source tree with `npm run dev`).
2. Proxies model discovery and chat traffic for every provider in the registry, adding auth headers server-side.
3. Proxies Ollama's native `/api/tags` and `/api/pull` endpoints, so Ollama can stay bound to `127.0.0.1` with no CORS flags.

At startup the frontend calls `GET /api/health`. If it returns `{"ok":true,"service":"hugmoss-gateway"}`, the app routes provider and Ollama requests through the same origin. Otherwise it uses direct mode. The switch is automatic and visible in **Settings → AI providers**.

### Routes

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Capability probe used by the frontend |
| `GET/POST /api/ai/:provider/*` | Streamed provider proxy; `:provider` must be in the allowlist |
| `GET /api/ollama/tags` | Installed Ollama models |
| `POST /api/ollama/pull` | Download an Ollama model (NDJSON progress stream) |

Supported provider IDs: `openai`, `anthropic`, `google`, `xai`, `mistral`, `deepseek`, `groq`, `openrouter`, `together`, `perplexity`, `ollama`.

### How keys flow

Keys stay in the browser's `localStorage`, as before. For a gateway request, the browser sends the key in the `x-hugmoss-key` header. The gateway uses it once, injects the provider-specific auth header (`Authorization`, `x-api-key` + `anthropic-version`, or `x-goog-api-key`), and forwards the request. The key is never written to disk, placed in a URL, or logged. The gateway is stateless.

Custom OpenAI-compatible endpoints deliberately stay in direct mode. Proxying arbitrary user-supplied URLs would turn the gateway into an SSRF vector.

### Configuration

All variables are optional.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama upstream the gateway calls |
| `ALLOWED_ORIGINS` | _(none)_ | Extra comma-separated origins allowed to call `/api`; same-origin is always allowed |
| `RATE_LIMIT` | `120` | Requests per minute per client IP |
| `BODY_LIMIT` | `8388608` | Maximum request body in bytes |
| `TRUST_PROXY` | `0` | Set to `1` only behind a trusted reverse proxy that sets `x-forwarded-for` |

Cross-origin API calls are rejected unless their origin is listed in `ALLOWED_ORIGINS`; the gateway's own origin always works. Keep the list empty when the gateway serves the app, and add entries only when a separately hosted frontend must reach the API.

### Deploying

The gateway is a standard Node HTTP server, so any Node 20+ host works. Use:

- **Build command:** `npm run build`
- **Start command:** `npm start`
- **Health check:** `/api/health`

On Render, Railway, Fly.io, or a VPS, set `PORT` if the platform requires it. `HOST=0.0.0.0` is the default so container routing works. For Ollama on a platform, point `OLLAMA_URL` at a reachable Ollama host — `localhost` inside a container is not your laptop.

The gateway has no user accounts. If you expose it publicly, put it behind your platform's access control or an authenticating reverse proxy. It is designed for single-user or trusted-team use.

## Connect an AI provider

1. Open **Settings** (gear icon) → **AI providers**.
2. Expand a provider, paste your key, and press **Save**. **Test connection** verifies the key against the provider's model list.
3. Open the model picker in the agent composer and choose a model. Models are fetched live from the provider; a curated fallback list appears when the catalog is unavailable.
4. Ask a question, or switch to **Agent** mode and describe a task.

Keys and preferences live in this browser's `localStorage` only. In gateway mode they are forwarded per request by your server and not stored; in direct mode they go straight to the provider. Use **Remove key** to delete one.

### Supported providers

| Provider | API | Auth |
| --- | --- | --- |
| OpenAI | `api.openai.com/v1` | Bearer key |
| Anthropic | `api.anthropic.com/v1` | `x-api-key`; direct mode adds the direct-browser header |
| Google Gemini | `generativelanguage.googleapis.com/v1beta` | Query key in direct mode, `x-goog-api-key` through the gateway |
| xAI | `api.x.ai/v1` | Bearer key |
| Mistral AI | `api.mistral.ai/v1` | Bearer key |
| DeepSeek | `api.deepseek.com/v1` | Bearer key |
| Groq | `api.groq.com/openai/v1` | Bearer key |
| OpenRouter | `openrouter.ai/api/v1` | Bearer key |
| Perplexity | `api.perplexity.ai` | Bearer key (chat only, no tools) |
| Together AI | `api.together.xyz/v1` | Bearer key |
| NVIDIA NIM | `integrate.api.nvidia.com/v1` | Bearer key (`nvapi-…`); use the gateway, NVIDIA blocks browser origins |
| Ollama | `localhost:11434` native API (also `/v1`) | No key (local) |
| Custom endpoint | Any OpenAI-compatible base URL | Optional bearer token (direct mode) |

Streaming is implemented for all three wire formats: OpenAI-compatible SSE, Anthropic Messages SSE, and Gemini `streamGenerateContent` SSE. The gateway streams responses through without buffering.

### Ollama, without a key

HugMoss uses Ollama's native API. With the daemon running, the model picker's Ollama group lists every installed model from `GET /api/tags`, with parameter size and disk size. If none are installed, it offers three recommended models and a download field. Downloads stream from `POST /api/pull` with live progress, can be cancelled, and become selectable as soon as they finish. Nothing leaves your machine.

1. Install Ollama from [ollama.com/download](https://ollama.com/download) and start it.
2. Start HugMoss with the gateway (`npm start`), or allow this page's origin in direct mode (below).
3. Reload HugMoss and open the model picker. The Ollama group reports `N installed`, `no models`, or `offline`.
4. Choose an installed model, or type a name such as `qwen2.5-coder:7b` and press **Download**.

In gateway mode, Ollama can stay on `127.0.0.1` with no extra flags because the server calls it directly. Set `OLLAMA_URL` if Ollama runs elsewhere.

In direct mode, allow this page's origin and retry:

```bash
# macOS / Linux
OLLAMA_ORIGINS=* ollama serve
```

```powershell
# Windows — then restart Ollama
setx OLLAMA_ORIGINS "*"
```

The integration uses Ollama's official local API and brand marks. HugMoss is an independent client and is not endorsed by Ollama.

Provider and model-family marks are official SVG logos inlined in `assets/js/brands.js` (Simple Icons and LobeHub sources), rendered in `currentColor`.

### CORS and direct mode

In direct mode, provider calls originate in your browser, so the provider must allow browser requests. The gateway exists to remove this constraint.

- **Ollama**: start it with `OLLAMA_ORIGINS=*` so this page can reach `localhost`, or use the gateway.
- **Anthropic**: direct mode sends `anthropic-dangerous-direct-browser-access: true`, which Anthropic requires for browser calls. The gateway sends the standard server-side auth instead.
- **NVIDIA NIM**: hosted `integrate.api.nvidia.com` endpoints reject browser origins, so keep the gateway running. A local NIM container can be reached through a custom endpoint instead.
- **OpenAI, Gemini, xAI, Mistral, DeepSeek, Groq, OpenRouter, Together**: some networks and providers reject browser origins. Run the gateway when a request is blocked.

## NVIDIA Agent Skills

HugMoss ships a browser for the official NVIDIA Agent Skills for AI and machine learning. The catalogue mirrors the AI/ML filter on [build.nvidia.com/skills](https://build.nvidia.com/skills?filters=domain%3Adomain_ai_and_machine_learning): 226 skills across Agentic AI, Training AI, Inference AI, Vision AI, Conversational AI, and Simulation and Modeling.

- Open the graduation-cap icon in the activity bar, or run **Skills: Open NVIDIA Skills** from the command palette.
- Search by name or description, filter by group or by active skills, and expand a row for its summary, install command, and source link.
- Activate up to six skills. HugMoss fetches that skill's real `SKILL.md` from the public `NVIDIA/skills` GitHub repository, strips the YAML frontmatter, and caches the body in `localStorage`.
- On the next agent request, active instruction bodies are appended to the system prompt inside an `<nvidia_skills>` block, capped at 14,000 characters per skill and 24,000 characters in total. If a fetch fails, the skill's catalogue description is sent instead and the row offers **Retry**.
- The agent still obeys HugMoss's own rules: it cannot run shell commands, and every file write needs your approval, even when a skill describes a CLI workflow.

Skills are published by NVIDIA under `CC-BY-4.0 AND Apache-2.0`. HugMoss is an independent client; use of the catalogue does not imply endorsement by NVIDIA or a partnership. The install buttons copy the upstream command:

```bash
npx skills add NVIDIA/skills --skill <skill-name>
```

The catalogue data lives in `assets/js/nvidia-skills.js`; loading, activation, caching, and prompt assembly live in `assets/js/skills.js`.

## The agent

| Mode | Reads files | Edits files | Use it for |
| --- | --- | --- | --- |
| **Ask** | Yes | No | Questions about the open folder |
| **Agent** | Yes | Yes, with approval | Implementing changes end to end |
| **Plan** | Yes | No | Producing a step-by-step plan and todos |

Agent tools: `list_files`, `read_file`, `search`, `update_todos`, `write_file`, `delete_file`.

Every `write_file` and `delete_file` opens an approval card with the exact diff. Nothing is written to disk until you approve and save. Files that look like secrets (`.env`, key files, credential stores) are not exposed to the agent, and binary or oversized files are skipped by the workspace reader.

The agent runs until it answers, calls a tool, or you press Stop. A session keeps its transcript and tool history until you start a new chat; history is available from the panel header.

## Workspace model

- **Open Folder** uses `showDirectoryPicker()` and remembers the handle in IndexedDB, so reopening the page can restore the last folder after one confirmation click.
- Read-only fallback: pick individual files or drop a folder onto the window.
- Each file keeps its current content, a folder-open baseline, and its last saved disk content. Changes compare session edits against the baseline; saves write through the handle.
- Limits: 4,000 files, 768 KB per file, 24 directory levels. Ignored folders include `node_modules`, `.git`, `dist`, `build`, and similar.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | `Ctrl+Shift+P` |
| Go to file | `Ctrl+K` or `Alt+P` |
| Save file | `Ctrl+S` |
| Save all | `Ctrl+Shift+S` or `Alt+E` |
| Open folder | `Ctrl+O` |
| Toggle terminal | `` Ctrl+` `` |
| Toggle sidebar | `Alt+B` |
| Toggle panel | `Alt+J` |
| Toggle agent chat | `Alt+A` |
| Toggle theme | `Alt+T` |
| Search in files | `Ctrl+Shift+F` |
| Changes view | `Alt+Z` |
| Dismiss overlay / drawer | `Esc` |

Some chords use `Alt` because browsers reserve `Ctrl+B`, `Ctrl+J` and `Ctrl+P`.

## Terminal commands

```
help                                  list available commands
ls [dir]                              list a directory
cd <dir>                              change directory (cd ~ for root)
pwd                                   print the current folder
cat <file>                            print a file, syntax highlighted
head <file> [n] · tail <file> [n]     first / last lines
wc <file>                             line, word and character counts
find <text>                           search names and contents
tree [dir]                            show the folder as a tree
open <file>                           open in the editor
download <file>                       save a copy through the browser
history · clear · date · echo         shell utilities
```

`npm`, `node`, `git` and other programs are intentionally not implemented. The prompt says so when you try.

## Project layout

```
index.html              application shell and UI structure
assets/css/main.css     design tokens, both themes, all component styles
assets/js/brands.js     official provider and model marks as inline SVG
assets/img/             HugMoss brand mark, favicons and touch icon
assets/js/providers.js  provider registry, key storage, model catalogues, gateway routing
assets/js/nvidia-skills.js  official NVIDIA AI/ML Agent Skills catalogue
assets/js/skills.js     skills browser, instruction cache, prompt assembly
assets/js/fs.js         File System Access workspace, fallbacks, diff baselines
assets/js/ai.js         SSE transport for OpenAI-compatible, Anthropic and Gemini APIs
assets/js/icons.js      interface and file-type icons
assets/js/highlight.js  syntax tokenizer and LCS line diff
assets/js/app.js        tabs, editor, minimap, explorer, search, changes, palette, settings
assets/js/terminal.js   file shell and command implementations
assets/js/agent.js      agent loop, tools, approvals, todos and message rendering
server/index.js         HTTP server, static assets, provider and Ollama proxy
server/providers.js     upstream allowlist and auth-header construction
scripts/build.js        copies index.html and assets/ into dist/
package.json            build, dev and start scripts; no dependencies
```

Everything is plain JavaScript. The gateway uses only Node built-ins. `npm run build` copies static files; there is no bundler. The only external asset is Google Fonts (Inter, JetBrains Mono); the design falls back to system fonts offline.

## Local storage keys

| Key | Contents |
| --- | --- |
| `hugmoss.keys.v1` | Provider API keys |
| `hugmoss.model.v1` | Selected provider and model |
| `hugmoss.models.v1` | Cached model catalogues (6-hour TTL) |
| `hugmoss.custom.v1` | Custom endpoint URL and model list |
| `hugmoss.sessions.v1` | Recent agent sessions |
| `hugmoss.skills.v1` | Active NVIDIA skills and cached `SKILL.md` bodies |
| `hugmoss.ide.settings.v2` | Theme, layout, font, wrap and mode preferences |

The last folder handle is stored in IndexedDB (`hugmoss-workspace`) so it can be restored after a reload. Gateway mode is detected at runtime and is not persisted.

## Security

- Keys stay in `localStorage` and in request memory. The gateway forwards them per request and never stores or logs them.
- Provider targets are a fixed allowlist; arbitrary upstream URLs, path traversal, and encoded dot segments are rejected.
- The gateway enforces same-origin API access by default, a per-IP rate limit, request body limits, and a fixed static-file root.
- Anyone with access to this browser profile can read stored keys. Use a dedicated key with a spending limit, and remove it when you are done.
- The agent never reads env or credential files. Writes always require explicit approval.
- Do not commit `localStorage` exports, `.env` files, or keys into this repository.

## Design

Graphite surfaces with a violet signal colour, Inter for interface text and JetBrains Mono for code. Both themes are driven by CSS custom properties, including re-tuned syntax colours for light mode. Panes resize by dragging, and the layout becomes drawers below 1180px (agent) and 860px (sidebar).

## Known limitations

- No process execution, debugger, language server, git client, or extension host.
- Read-only mode without Chrome/Edge: editing works in memory, but saves download as files instead of writing to disk.
- Model availability and tool support depend on the provider; Perplexity is chat-only, and some models reject tool calls.
- Custom OpenAI-compatible endpoints bypass the gateway by design, so they remain subject to browser CORS and mixed-content rules.
- The gateway is single-user software without accounts; add access control before exposing it publicly.
- A browser tab cannot install or start Ollama; HugMoss detects a running daemon and can download models through it.
- Very large folders are truncated at the documented limits rather than partially indexed.

## Author

Built by **IRAGUHA Vincent** — [github.com/senid-221](https://github.com/senid-221).
