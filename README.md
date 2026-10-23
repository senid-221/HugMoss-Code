# HugMoss Code

A browser-based agentic coding IDE. Open a real folder from your disk, edit real files, and talk to a real language model through your own API key — with an agent that reads, searches, plans, and writes files under your approval.

No build step, no package manager, no backend. HugMoss is plain HTML, CSS and JavaScript.

---

## What is real

- **The workspace** is your folder. HugMoss uses the File System Access API to read and write files in place. Nothing is uploaded to a HugMoss server.
- **The agent** calls provider APIs directly from the tab using your key. There is no relay, no proxy, and no bundled model.
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
- **Workspace chrome** — command palette, menus, settings, provider manager, notifications, toasts, problems panel, status bar, resizable panes, dark and light themes, responsive drawers.

## Run it

```bash
git clone https://github.com/senid-221/HugMoss-Code.git
cd HugMoss-Code
```

Open `index.html` directly, or serve the folder over localhost (recommended for provider calls and Ollama):

```bash
python -m http.server 8080
# or
npx serve .
```

Then visit `http://localhost:8080`.

Chrome or Edge is required for folder write access. Firefox and Safari fall back to read-only file picking, drag-and-drop, and the editor without disk writes.

## Connect an AI provider

1. Open **Settings** (gear icon) → **AI providers**.
2. Expand a provider, paste your key, and press **Save**. **Test connection** verifies the key against the provider's model list.
3. Open the model picker in the agent composer and choose a model. Models are fetched live from the provider; a curated fallback list appears when the catalog is unavailable.
4. Ask a question, or switch to **Agent** mode and describe a task.

Keys and preferences live in this browser's `localStorage` only. They are never sent anywhere except the provider you selected. Use **Remove key** to delete one.

### Supported providers

| Provider | API | Auth |
| --- | --- | --- |
| OpenAI | `api.openai.com/v1` | Bearer key |
| Anthropic | `api.anthropic.com/v1` | `x-api-key` + direct-browser header |
| Google Gemini | `generativelanguage.googleapis.com/v1beta` | Key in query string |
| xAI | `api.x.ai/v1` | Bearer key |
| Mistral AI | `api.mistral.ai/v1` | Bearer key |
| DeepSeek | `api.deepseek.com/v1` | Bearer key |
| Groq | `api.groq.com/openai/v1` | Bearer key |
| OpenRouter | `openrouter.ai/api/v1` | Bearer key |
| Perplexity | `api.perplexity.ai` | Bearer key (chat only, no tools) |
| Together AI | `api.together.xyz/v1` | Bearer key |
| Ollama | `localhost:11434/v1` | No key (local) |
| Custom endpoint | Any OpenAI-compatible base URL | Optional bearer token |

Streaming is implemented for all three wire formats: OpenAI-compatible SSE, Anthropic Messages SSE, and Gemini `streamGenerateContent` SSE.

Provider and model-family marks are official SVG logos inlined in `assets/js/brands.js` (Simple Icons and LobeHub sources), rendered in `currentColor`.

### CORS notes

Provider calls originate in your browser, so the provider must allow browser requests.

- **Ollama**: start it with `OLLAMA_ORIGINS=*` so this page can reach `localhost`.
- **Anthropic**: HugMoss sends `anthropic-dangerous-direct-browser-access: true`, which Anthropic requires for browser calls.
- **OpenAI, Gemini, xAI, Mistral, DeepSeek, Groq, OpenRouter, Together**: blocked by CORS on some networks. Serve HugMoss from `localhost` and check the browser console if a request is refused. Custom endpoints can sit behind your own proxy if a provider does not allow browsers.

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
assets/js/providers.js  provider registry, key storage and model catalogues
assets/js/fs.js         File System Access workspace, fallbacks, diff baselines
assets/js/ai.js         SSE transport for OpenAI-compatible, Anthropic and Gemini APIs
assets/js/icons.js      interface and file-type icons
assets/js/highlight.js  syntax tokenizer and LCS line diff
assets/js/app.js        tabs, editor, minimap, explorer, search, changes, palette, settings
assets/js/terminal.js   file shell and command implementations
assets/js/agent.js      agent loop, tools, approvals, todos and message rendering
```

Everything is plain JavaScript in IIFEs — no framework, bundler or runtime dependency. The only external asset is Google Fonts (Inter, JetBrains Mono); the design falls back to system fonts offline.

## Local storage keys

| Key | Contents |
| --- | --- |
| `hugmoss.keys.v1` | Provider API keys |
| `hugmoss.model.v1` | Selected provider and model |
| `hugmoss.models.v1` | Cached model catalogues (6-hour TTL) |
| `hugmoss.custom.v1` | Custom endpoint URL and model list |
| `hugmoss.sessions.v1` | Recent agent sessions |
| `hugmoss.ide.settings.v2` | Theme, layout, font, wrap and mode preferences |

The last folder handle is stored in IndexedDB (`hugmoss-workspace`) so it can be restored after a reload.

## Security

- Keys stay in `localStorage` and in memory for requests to the chosen provider. There is no HugMoss backend and no telemetry.
- Anyone with access to this browser profile can read those keys. Use a dedicated key with a spending limit, and remove it when you are done.
- The agent never reads env or credential files. Writes always require explicit approval.
- Do not commit `localStorage` exports, `.env` files, or keys into this repository.

## Design

Graphite surfaces with a violet signal colour, Inter for interface text and JetBrains Mono for code. Both themes are driven by CSS custom properties, including re-tuned syntax colours for light mode. Panes resize by dragging, and the layout becomes drawers below 1180px (agent) and 860px (sidebar).

## Known limitations

- No process execution, debugger, language server, git client, or extension host.
- Read-only mode without Chrome/Edge: editing works in memory, but saves download as files instead of writing to disk.
- Model availability and tool support depend on the provider; Perplexity is chat-only, and some models reject tool calls.
- Browser CORS policy can block requests to providers that do not allow web origins.
- Very large folders are truncated at the documented limits rather than partially indexed.

## Author

Built by **IRAGUHA Vincent** — [github.com/senid-221](https://github.com/senid-221).
