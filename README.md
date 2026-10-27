# HugMoss Code

<p align="center"><img src="assets/img/hugmoss-128.png" width="96" height="96" alt="HugMoss logo"></p>

A browser-based agentic coding workspace. It opens with a task rail, an agent conversation, and a live browser pane; the editor appears when you open a file. Open a real folder from your disk, edit real files, and talk to a real language model — with your own API key, or with keys a deployment supplies — and an agent that reads, searches, plans, and writes files under your approval.

HugMoss runs in two modes:

- **Gateway mode** — the bundled Node server serves the app and relays provider traffic, which removes browser CORS limits and keeps Ollama on localhost. Recommended for local use and deployment.
- **Direct mode** — host `index.html` and `assets/` on any static server. The browser calls providers itself, exactly as it did before the gateway existed. HugMoss detects which mode it is in at startup.

There are no runtime dependencies, no framework, and no build step beyond copying static files.

---

## What is real

- **The workspace** is your folder. HugMoss uses the File System Access API to read and write files in place. File contents are never uploaded to a HugMoss service.
- **The agent** calls the selected provider with your key, or with a key the gateway holds in its environment. A key sent from the browser always takes precedence. No key is stored server-side by the request path, and a hosted key is never exposed to visitors.
- **The changes view** compares your session edits against the folder contents from the moment you opened it, and against what is currently on disk.
- **The terminal** is a file shell over the open folder. It lists, reads, and searches files; it does not execute programs.

## What is honest

A browser tab cannot spawn processes, attach a debugger, run a language server, or execute `git`. HugMoss does not pretend otherwise. Builds, tests, git operations, and long-running servers belong in your own terminal; the UI tells you so where it matters. The Browser pane is an iframe, so sites that send `X-Frame-Options` or a restrictive `frame-ancestors` policy refuse to render; local previews and embeddable sites work.

## Highlights

- **Task rail** — Coding home, New Task, recent-task history with search, workspace switcher, and direct access to Knowledge Center, Sites, Automations, and Extensions.
- **Agent workspace** — Ask / Agent / Plan modes, streamed prose, structured todos, expandable tool cards, per-edit approval with inline diffs, stop control, session history, and Markdown export.
- **Browser pane** — a real resizable preview with its own tab strip, back/forward history, URL bar, device frame, open-in-tab and copy-link actions, plus a start page for the local app and the repository.
- **Editor** — opens full-screen over the workspace from any file open, with editable tabs, syntax highlighting for 11 languages, breadcrumbs, outline, canvas minimap, word wrap, configurable font size, and unsaved-change protection.
- **On-demand panels** — Explorer, cross-file Search, session Changes, and the multi-session file shell stay one command away and open in a drawer or the editor instead of occupying the default layout.
- **NVIDIA Skills** — a searchable catalogue of the official NVIDIA Agent Skills for AI and machine learning. Open it from Knowledge Center, or run **Skills: Open NVIDIA Skills**. Activate up to six; their real `SKILL.md` instructions are fetched from `NVIDIA/skills` on GitHub and appended to the agent system prompt on the next request.
- **Workspace chrome** — command palette, menus, settings, provider manager, notifications, toasts, problems panel, dark and light themes, and responsive drawers.

## Navigation and links

Every surface has a real URL, so views can be bookmarked, shared, and reached with the browser's back and forward buttons. The app is a single page with a hash router; changing the hash applies the matching view, and an unknown address falls back to `#/task`.

| Route | Opens |
| --- | --- |
| `#/task` | The active task, or a new session when none is open |
| `#/task/<session-id>` | A saved session from this browser's history |
| `#/editor?path=<file>` | The full-screen editor for a workspace file |
| `#/terminal` | The editor surface with the Terminal panel selected |
| `#/browser` | The browser pane; add `?url=<address>` to load a page |
| `#/explorer` | Explorer in the drawer |
| `#/search` | Cross-file search in the drawer |
| `#/changes` | Session changes in the drawer |
| `#/knowledge` | Knowledge Center in the drawer |
| `#/extensions` | Extensions in the drawer |
| `#/settings` | Settings |
| `#/help` | Keyboard shortcuts |
| `#/about` | About HugMoss Code |
| `#/automations` | Automations explanation |

Programmatic navigation replaces or pushes the same hash, so opening a file in the editor, switching drawer views, and typing a browser address all keep the URL in sync. While you browse inside the preview pane, its address replaces the current history entry rather than adding one per page.

Workspace files are read through the File System Access API, and a browser cannot restore that permission on its own. An `#/editor` deep link opens the editor shell immediately and fills in the file as soon as you open the folder.

The title-bar window controls map to browser behaviour: minimize enters focus mode (the agent and browser panes collapse, `Esc` restores them), maximize requests fullscreen for the page, and close explains that a tab can only be closed by the browser itself.

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

Then visit `http://localhost:8080`. At startup the app probes `/api/health`; when no gateway answers, it falls back to direct browser calls. Direct mode requires provider CORS support — see [CORS](#cors-and-direct-mode). Hosted keys are a gateway feature, so a static-only deployment is bring-your-own-key.

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

#### Hosted keys

A deployment can hold provider keys in its environment so visitors only choose a provider and a model. When a request arrives without `x-hugmoss-key`, the gateway uses the matching environment variable. A key entered in the app still wins, per visitor. `/api/health` reports one boolean per provider and never a key value.

| Variable | Provider |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Google Gemini |
| `XAI_API_KEY` | xAI |
| `MISTRAL_API_KEY` | Mistral AI |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq |
| `OPENROUTER_API_KEY` | OpenRouter |
| `TOGETHER_API_KEY` | Together AI |
| `NVIDIA_API_KEY` or `NVIDIA_NIM_API_KEY` | NVIDIA NIM |
| `PERPLEXITY_API_KEY` | Perplexity |

Only configure the ones you want to share. Anyone who can reach the deployment can spend these keys, so keep `RATE_LIMIT` low on a public site and protect it when it is not meant to be open.

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

#### Vercel

Vercel never runs a long-lived `npm start`, so this repository ships `vercel.json` and a Node function at `api/[...path].js`. The app is served as static output and `/api/*` runs as one serverless function.

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | default (`npm install`) |
| Start command | none — Vercel calls `api/[...path].js` |

Import the repository in the Vercel dashboard and keep the detected build settings, or deploy from the CLI:

```bash
npx vercel        # preview deployment
npx vercel --prod # production deployment
```

Set these in **Project → Settings → Environment Variables** for Production and Preview:

| Variable | Value | Effect |
| --- | --- | --- |
| `TRUST_PROXY` | `1` | Without it every request carries the function's own address and the rate limiter treats all visitors as one client |
| `BODY_LIMIT` | `4000000` | Vercel rejects bodies over 4.5 MB before the function runs; keep this below that |
| `RATE_LIMIT` | `120` | Requests per minute per IP. On serverless this is per instance, so treat it as best effort |
| `ALLOWED_ORIGINS` | optional | Only needed when a different origin, such as a locally served copy, must call this deployment's `/api` |
| `OLLAMA_URL` | optional | Address of a reachable Ollama host. On Vercel `127.0.0.1` is the function itself, so a local Ollama stays unreachable |

**Provider keys are optional.** Add any of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `NVIDIA_API_KEY` or `PERPLEXITY_API_KEY` to the same Environment Variables screen. With a key present, visitors just pick that provider and a model — no key prompt. A key a visitor enters in Settings overrides the hosted one for that browser only. Leave them unset for bring-your-own-key.

Because a hosted key is spent by anyone who can reach the site, set `RATE_LIMIT=20` or lower, and enable Deployment Protection unless the deployment is meant to be public. Keys are attached inside the function and never appear in `/api/health` or in any response.

Behaviour worth knowing:

- **Ollama needs the local gateway.** A deployed site cannot reach `localhost:11434` on your machine. Run `npm start` locally for Ollama, or set `OLLAMA_URL` to a publicly reachable Ollama host.
- **Streaming is preserved.** The function pipes provider SSE through without buffering, and allows up to 300 seconds per request, which is the Hobby plan maximum.
- **localStorage is per origin.** Keys, model choice and active skills saved on `localhost` do not appear on the deployment; add them once there.
- **Serverless state.** Nothing needs to persist server-side, so instance recycling is harmless. Rate-limit buckets are in memory and reset with the instance.
- **Public access.** The app has no accounts and rate limiting is per instance. Use Vercel's Deployment Protection, or keep the deployment private, if you do not want the relay reachable by others.

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

- Open Knowledge Center in the task rail, or run **Skills: Open NVIDIA Skills** from the command palette.
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
| Open terminal | `` Ctrl+` `` |
| Toggle task rail | `Ctrl+B` or `Alt+B` |
| Toggle browser pane | `Ctrl+Shift+B` |
| Focus browser address | `Ctrl+L` |
| Open changes | `Alt+Z` |
| Toggle theme | `Alt+T` |
| Focus agent chat | `Alt+A` |
| Toggle editor panel | `Alt+J` |
| Search in files | `Ctrl+Shift+F` |
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
assets/js/shell.js      three-pane shell: task rail, history, drawer, editor overlay, browser toggle
assets/js/browser.js    browser pane: tabs, address bar, history, device frame, actions
assets/js/app.js        editor, explorer, search, changes, palette, settings, keyboard map
assets/js/terminal.js   file shell and command implementations
assets/js/agent.js      agent loop, tools, approvals, todos and message rendering
server/index.js         local Node server: static assets plus the API router
server/app.js           API router, provider and Ollama proxy
server/providers.js     upstream allowlist and auth-header construction
api/[...path].js        Vercel serverless entry point for /api/*
vercel.json             Vercel build, function duration and response headers
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

The default view follows the agent-workspace pattern: a light task rail on the left, the conversation in the middle, and the browser on the right, under a compact 60px title bar. The editor is a full-screen surface that keeps the same title bar; drawers carry Explorer, Search, Changes, Extensions, and Knowledge Center. Graphite type, Inter for interface text and JetBrains Mono for code, with a blue selection signal and a yellow workspace accent. Both themes are driven by CSS custom properties, including re-tuned syntax colours for light mode. The pane layout collapses to two columns at 1180px, the task rail becomes a drawer at 900px, and the browser bar wraps at 620px.

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
