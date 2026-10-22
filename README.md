# HugMoss Code

A browser-based agentic coding IDE. HugMoss Code is a from-scratch recreation of the Qoder workflow — explorer, editable multi-tab editor, source control with real diffs, integrated terminal, and an agent panel that plans, reads, edits and builds while you watch.

No build step, no package manager, no backend. Open `index.html` and it runs.

---

## Highlights

- **Explorer** — collapsible file tree with file-type icons, change indicators, outline and timeline sections, file creation and refresh/collapse actions.
- **Editor** — real typing with two-way scroll sync, syntax highlighting for 11 languages, dirty-state tabs, breadcrumbs with a live symbol trail, and a canvas minimap you can drag.
- **Search** — cross-file search with match case, whole word and regex toggles, line previews and highlighted hits.
- **Source control** — staged-change list, commit box, unified diffs computed with an LCS algorithm against the pre-edit file, HEAD → working-tree view.
- **Terminal** — multi-session shell with command history, inline syntax colouring and streaming output. Every command reads the actual virtual filesystem.
- **Agent panel** — Ask / Agent / Plan modes, animated todo cards, expandable tool-call cards (Read, Grep, Edit, Write, Bash) with inline diffs, streamed prose, follow-up chips, stop control, session history.
- **Workspace chrome** — command palette, dropdown menus, settings modal, notifications, toasts, problems panel, status bar, resizable panes, dark and light themes, responsive drawers for narrow screens.

## Run it

```bash
git clone https://github.com/senid-221/HugMoss-Code.git
cd HugMoss-Code
```

Then open `index.html` in any modern browser — double-clicking works, no server needed.

Works over `file://` because every asset is local. The only network request is Google Fonts (Inter, JetBrains Mono); the design falls back to system fonts offline.

## Try the agent

Open the Agent panel (`Alt+A`) and click **Add a real unread-alert count badge to the navbar bell**, or run **Agent: Run Demo Task** from the command palette (`Ctrl+Shift+P`).

The session is a scripted demo, but its effects are real: it creates `src/hooks/useAlerts.ts`, rewrites `Navbar.tsx`, appends a rule to `index.css`, runs `npm run build`, and raises an ESLint problem in the Problems panel — all against a working virtual filesystem, so the tree, SCM list, tabs and diffs update as it goes.

**Ask** mode answers questions about the project without touching files. **Plan** mode returns a numbered plan with **Approve & build** / **Exit Plan Mode** and writes nothing.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | `Ctrl+Shift+P` |
| Go to file | `Ctrl+K` or `Alt+P` |
| Save | `Ctrl+S` |
| Save all | `Alt+E` |
| Toggle terminal | `` Ctrl+` `` |
| Toggle sidebar | `Alt+B` |
| Toggle panel | `Alt+J` |
| Toggle agent chat | `Alt+A` |
| Toggle theme | `Alt+T` |
| Dismiss overlay / drawer | `Esc` |

Some chords use `Alt` because browsers reserve `Ctrl+B`, `Ctrl+J` and `Ctrl+P` and never pass them to the page.

**Editor:** `Tab` inserts two spaces; edits mark the tab dirty and flow straight into diffs, search and source control.

**Terminal:** `↑` / `↓` walk history, `Ctrl+C` aborts, `Ctrl+L` clears.

## Terminal commands

```
help                                  list available commands
ls [dir]                              list a directory
cat <file>                            print a file, syntax highlighted
find <term>                           search paths and file contents
clear                                 clear the terminal
pwd · whoami · date · echo            basic shell output
node -v                               runtime version
git status | log | diff | add | commit | branch
npm run dev | run build | test | install | run lint
```

`git status` and `git diff` reflect the live source-control state, and `npm run build` streams a build log.

## Project layout

```
index.html              application shell and UI structure
assets/css/main.css     design tokens, both themes, all component styles
assets/js/icons.js      inline SVG icon set and file-type icons
assets/js/workspace.js  virtual filesystem: 20 sample files, content + HEAD revisions
assets/js/highlight.js  regex tokenizer for 11 languages and the LCS line diff
assets/js/app.js        tabs, editor, minimap, explorer, search, SCM, palette, settings
assets/js/terminal.js   multi-session shell and command implementations
assets/js/agent.js      agent modes, scripted sessions, tool cards, markdown streaming
```

Everything is plain JavaScript in IIFEs — no framework, bundler or runtime dependency.

## Design

Graphite surfaces with a violet signal colour, Inter for UI text and JetBrains Mono for code. Both dark and light themes are driven by CSS custom properties, including re-tuned syntax colours for light mode. Panes resize by dragging their handles, and the layout collapses into drawers below 860px.

## Notes and limitations

- This is a front end. There is no server, no account system and no network calls beyond web fonts.
- The agent is a deterministic scripted session over the virtual filesystem, not a live language model.
- The workspace (`agrosmart-dashboard`) is fictional sample content created to demonstrate the IDE.
- Settings such as theme, font size, wrap and pane sizes persist in `localStorage`.

## Author

Built by **IRAGUHA Vincent** — [github.com/senid-221](https://github.com/senid-221).
