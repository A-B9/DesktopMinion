# Desktop Buddy (DesktopMinion) — CLAUDE.md 

This file is the authoritative reference for Claude Code working in this repository.
Read it in full before making any changes.

---

## Project Overview

Desktop Buddy is a macOS desktop widget — a small floating pixel-art robot called **Byte** — that lives in the corner of the screen and acts as an AI-powered productivity coach. It watches the user's local markdown todo files and uses the Anthropic API to generate short, in-character messages that appear as speech bubbles.

- Byte floats bottom-right, above all windows, on all macOS Spaces.
- Byte reads markdown todo files from disk in real time via `fs.watch`.
- On a configurable timer, Byte speaks — nudging, flagging overdue tasks, or calling out procrastination — using LLM-generated text.
- The window is click-through by default; hovering re-enables interaction.
- Target platform: macOS (Apple Silicon and Intel). Personal use only — no distribution.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron v42 |
| Language | JavaScript (CommonJS) — no build step |
| AI model | Anthropic API — `claude-haiku-4-5` (upgrade path to Sonnet) |
| File watching | Node.js built-in `fs.watch` |
| Styling | Plain CSS |
| Package manager | npm |

No bundler (Webpack/Vite). Electron loads files directly.

---

## Architecture

Electron splits work across two processes. The API key and file system access must never touch the renderer — this is a security requirement, not a preference.

```
┌─────────────────────────────────────────────────────┐
│  MAIN PROCESS  (main.js)                            │
│                                                     │
│  - Creates and manages the BrowserWindow            │
│  - Loads and parses config.json                     │
│  - Reads todo files from disk (fs.readFileSync)     │
│  - Watches files for changes (fs.watch + debounce)  │
│  - Calls Anthropic API  (M3 ✅)                      │
│  - Runs check-in timer  (M4 ✅)                      │
│  - Holds the API key (never sent to renderer)       │
│                                                     │
│  IPC channels (ipcMain):                           │
│    RECEIVE  'set-ignore-mouse'  (bool)              │
│    RECEIVE  'request-todos'                         │
│    SEND     'todos-updated'     (TodoPayload)       │
│    SEND     'ai-message'        (string)             │
└────────────────┬────────────────────────────────────┘
                 │  contextBridge (preload.js)
                 │  Exposes only: setIgnoreMouse,
                 │               requestTodos,
                 │               onTodosUpdated,
                 │               onAiMessage
                 │
┌────────────────▼────────────────────────────────────┐
│  RENDERER PROCESS  (renderer/)                      │
│                                                     │
│  - Draws the pixel sprite on a <canvas>             │
│  - Shows / hides / animates the speech bubble       │
│  - Renders the status strip (file load state)       │
│  - Toggles click-through on mouseenter/mouseleave   │
│  - Stores latest todo data in memory                │
│  - Renders AI-generated text in bubble (M3 ✅)      │
│                                                     │
│  No file system access. No API key. No secrets.     │
└─────────────────────────────────────────────────────┘
```

### IPC Data Shapes

**`todos-updated`** (main → renderer, current):
```js
{
  files: [
    {
      name:      string,   // e.g. "todos.md"
      path:      string,   // resolved absolute path
      content:   string,   // full raw text (null if error)
      pending:   number,   // count of "- [ ]" items
      done:      number,   // count of "- [x]" items
      updatedAt: string,
      error:     string,   // null if ok
    }
  ],
  persona: string          // forwarded from config.json
}
```

**`ai-message`** (main → renderer):
```js
{
  text: string,   // the line Byte will say
  mood: string,   // "neutral" | "stern" | "happy" — drives sprite swap (M5)
}
```

---

## File Structure

```
DesktopMinion/
│
├── main.js              # Main process: window, file I/O, API calls, timers
├── preload.js           # Context bridge: exposes safe API surface to renderer
├── package.json         # Electron dependency and npm start script
├── config.json          # User-editable: paths, persona, timer interval
├── .gitignore
├── CLAUDE.md            # This file
│
└── renderer/
    ├── index.html       # Shell: bubble div, canvas, status strip
    ├── style.css        # Transparent window, bubble, pixel canvas, status dot
    └── renderer.js      # Sprite drawing, bubble logic, IPC listeners
```

### config.json Schema

```json
{
  "todoPaths": ["~/Desktop/todos.md"],
  "checkInIntervalMinutes": 30,
  "persona": "A friendly but firm productivity robot named Byte. ..."
}
```

- `todoPaths` — Array of `~`-expanded paths to markdown todo files.
- `checkInIntervalMinutes` — How often Byte speaks unprompted. Drives `startCheckInTimer()` in `main.js`.
- `persona` — Injected verbatim as the system prompt prefix for every API call.

### Todo File Format

Plain markdown with GFM checkbox syntax:
```markdown
- [ ] Unchecked / pending task
- [x] Completed task
```
Section headers and plain text are forwarded as raw context to the API.

---

## Running the Project

Requirements: Node.js v20+, npm v10+, macOS.

```bash
npm install   # first time only
npm start
```

Stop: right-click Byte → Quit, or Ctrl+C in the terminal.

Log prefixes: `[config]`, `[todos]`, `[watch]`, `[api]`, `[timer]`.

To open DevTools temporarily, add after `win.loadFile(...)` in `main.js`:
```js
win.webContents.openDevTools({ mode: 'detach' });
```
Remove before committing.

---

## Milestone Status

### ✅ M1 — Transparent Floating Window + Pixel Character (COMPLETE)

- Electron `BrowserWindow`: `transparent`, `frame: false`, `hasShadow: false`.
- `setAlwaysOnTop(true, 'screen-saver')` — floats above full-screen apps.
- `setIgnoreMouseEvents(true, { forward: true })` — click-through by default; toggled off on `mouseenter`.
- `setVisibleOnAllWorkspaces(true)` — persists across all Spaces.
- `app.dock.hide()` — no dock icon.
- 16×16 pixel robot sprite on `<canvas>` using a character-grid palette. `image-rendering: pixelated`.
- Speech bubble with CSS pop-in animation and downward arrow.
- Right-click context menu (Quit).
- Window pinned to bottom-right via `WIN_W`, `WIN_H`, `MARGIN` constants in `createWindow()`.

### ✅ M2 — Local File Reading + Live Watching (COMPLETE)

- `loadConfig()` reads `config.json` at startup with safe fallback defaults.
- `resolvePath()` expands `~` to `os.homedir()`.
- `readTodoFiles()` reads all configured files, counts pending/done checkboxes, returns structured array.
- `startWatching()` attaches `fs.watch` per file with 300ms debounce.
- On file change, `sendTodosToRenderer()` re-reads all files and pushes the full IPC payload.
- Renderer displays multi-line summary in the bubble on load and on change.
- Status strip: green (all ok), amber (partial error), red (all failed), grey (unconfigured).
- `preload.js` exposes `requestTodos()` and `onTodosUpdated(callback)` via context bridge.
- Right-click context menu adds "Reload files now".

### ✅ M3 — Anthropic API Integration (COMPLETE)

- `dotenv` and `@anthropic-ai/sdk` installed as dependencies.
- `ANTHROPIC_API_KEY` loaded from `.env` via `require('dotenv').config()` at the top of `main.js`.
- Anthropic client initialised at module scope: `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`.
- `generateMessage(files, persona, minutesSince)` async function: builds system + user prompt, calls `anthropic.messages.create()` with model `claude-haiku-4-5-20251001`, returns trimmed text.
- `sendAiMessage()` calls `generateMessage`, stamps `lastCheckInAt`, sends `'ai-message'` IPC event.
- `preload.js` exposes `onAiMessage(callback)` via context bridge.
- `renderer/renderer.js` listens for `onAiMessage` and calls `showBubble(text)`.
- API key never leaves `main.js` — not passed through IPC or the context bridge.
- `.env` added to `.gitignore`.

### ✅ M4 — Check-in Timer (COMPLETE)

- `lastCheckInAt` (Date timestamp) and `checkInTimer` (interval handle) added as top-level variables in `main.js`.
- `generateMessage` accepts optional `minutesSince` third parameter; appends elapsed-time sentence to the user prompt when set. First call passes `null` so Byte does not say "0 minutes".
- `sendAiMessage` computes `minutesSince` from `lastCheckInAt` before each call, then updates `lastCheckInAt` after a successful send.
- `startCheckInTimer()` clears any existing interval and starts a new one driven by `config.checkInIntervalMinutes` (default 30).
- `did-finish-load` handler calls `startCheckInTimer()` so the interval begins as soon as the window is ready.
- To test quickly: set `"checkInIntervalMinutes": 0.2` (or any small value) in `config.json`, run `npm start`, verify `[timer]` and `[api]` logs appear on schedule. Remember to restore to `30` after testing.

### ⬜ M5 — Sprite Expressions (NOT STARTED)

Goal: Byte's face changes to match the AI message tone.

**`renderer/renderer.js`:**
- Define `SPRITE_HAPPY`, `SPRITE_STERN`, `SPRITE_IDLE` alongside `SPRITE_NEUTRAL`.
- Add `setExpression(mood)` that calls `drawSprite(SPRITE_<MOOD>)`.
- Call `setExpression(mood)` when `'ai-message'` arrives.

**`main.js` → `generateMessage()`:**
- Ask the model to return JSON: `{ "mood": "happy|stern|neutral", "text": "..." }`.
- Parse JSON before sending to renderer; fall back to `mood: 'neutral'` on parse failure.

### ⬜ M6 — Launch at Login + Menu Bar Icon (NOT STARTED)

Goal: Byte starts at boot; menu bar icon for show/hide, reload, quit.

**`main.js`:**
```js
app.setLoginItemSettings({ openAtLogin: true });

const tray = new Tray(path.join(__dirname, 'assets/tray-icon.png'));
tray.setContextMenu(Menu.buildFromTemplate([
  { label: 'Show / Hide Byte',  click: toggleWindow },
  { label: 'Reload files',      click: sendTodosToRenderer },
  { label: 'Launch at login',   type: 'checkbox', checked: ..., click: toggleLoginItem },
  { type: 'separator' },
  { label: 'Quit',              click: () => app.quit() },
]));
```

Create `assets/tray-icon.png` at 22×22px (macOS menu bar size).

---

## Future Improvements (Post-MVP)

### F1 — User Reply / Two-way Conversation
Hidden `<input>` below the bubble. Renderer sends `ipcRenderer.send('user-reply', text)`. `main.js` accumulates a short conversation history (last N turns) sent as the `messages` array. History clears after a configurable idle period.

### F2 — AI Updates Todo Files (Tool Use)
Define an `edit_todo_file` tool `{ action, task, file }`. If the API response contains a `tool_use` block, `main.js` executes the edit (never the renderer) after sending a confirmation IPC event to the renderer. `fs.watch` picks up the write automatically.

### F3 — Procrastination Detection
Use Electron's `powerMonitor` for system idle time. Optionally read frontmost app name via AppleScript (`child_process.exec`). Add `procrastinationApps` blocklist to `config.json`. Trigger an off-schedule AI message when a blocked app is focused for more than N minutes. Requires Accessibility permission in System Settings.

### F4 — Multiple Personas / Modes
Add a `personas` array to `config.json` (each with `name`, `persona`, optional `palette`). Submenu in the Tray icon to switch. On switch, update `config.persona` in memory and trigger a new AI message.

### F5 — Animated Sprite (Idle Loop)
Blink animation: `SPRITE_NEUTRAL → SPRITE_BLINK → SPRITE_NEUTRAL` on a `setInterval` (e.g. every 4 seconds, blink for 150ms). Pause while an expression animation is playing.

### F6 — Persistent Stats / History
Track tasks completed per day in a local JSON file. Show a weekly summary on Mondays.

### F7 — Packaging
Package as `.app` with `electron-builder`. Code signing can be skipped for personal use (right-click → Open to bypass Gatekeeper once).

---

## Key Technical Decisions and Gotchas

**Click-through window behaviour**
Always pair `setIgnoreMouseEvents` calls with `{ forward: true }`. Without it, clicks on the desktop behind the widget silently fail. The renderer toggles this via the `set-ignore-mouse` IPC channel on `mouseenter`/`mouseleave`.

**`fs.watch` limitations on macOS**
Works for editors that save in place (VS Code, Vim). Can miss saves from apps using atomic rename (write-temp → rename), including some versions of Obsidian and iA Writer. Fix: replace `startWatching()` with `chokidar`:
```bash
npm install chokidar
```
Replace `fs.watch(path, callback)` with `chokidar.watch(path).on('change', callback)`.

**Window position on multiple displays**
`screen.getPrimaryDisplay()` targets the primary display only. For secondary displays, use `screen.getAllDisplays()` and offset `x`/`y` accordingly.

**Bubble clipping**
If bubble text exceeds `WIN_H`, it clips silently (transparent window, `overflow: hidden`). Increase `WIN_H` in `createWindow()`, or add `max-height` + `overflow-y: auto` to `#bubble` in `style.css`.

**Why Electron over Swift/SwiftUI?**
Transparent always-on-top windows, IPC, and API calls require minimal boilerplate in Electron. Trade-off: ~120MB RAM idle. A Swift rewrite using `NSPanel` + `WKWebView` could reuse the same HTML/CSS and reduce footprint significantly — viable migration path post-MVP.

---

*Current state: Milestones 1–4 complete. Next: Milestone 5 — Sprite Expressions.*
