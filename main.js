require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const { app, BrowserWindow, screen, ipcMain, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

let win;
let config        = {};
let fileWatchers  = [];
let lastCheckInAt = null;
let checkInTimer  = null;

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
})

// ── Config ──────────────────────────────────────────────────────────────────
function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error('[config] Failed to load config.json:', err.message);
    return { todoPaths: [], checkInIntervalMinutes: 30, persona: 'A helpful productivity assistant.' };
  }
}

// ── File helpers ────────────────────────────────────────────────────────────
function resolvePath(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
}

function readTodoFiles() {
  const paths = config.todoPaths || [];
  if (paths.length === 0) return [];

  return paths.map(p => {
    const resolved = resolvePath(p);
    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      return {
        name:      path.basename(resolved),
        path:      resolved,
        content,
        pending:   (content.match(/- \[ \]/g)  || []).length,
        done:      (content.match(/- \[x\]/gi) || []).length,
        updatedAt: new Date().toLocaleTimeString(),
        error:     null,
      };
    } catch (err) {
      return {
        name:      path.basename(resolved),
        path:      resolved,
        content:   null,
        pending:   0,
        done:      0,
        updatedAt: new Date().toLocaleTimeString(),
        error:     err.code === 'ENOENT' ? 'File not found' : err.message,
      };
    }
  });
}

// ── IPC: push latest todos to the renderer ───────────────────────────────
function sendTodosToRenderer() {
  if (!win || win.isDestroyed()) return;
  const files = readTodoFiles();
  console.log('[todos] Sending', files.length, 'file(s) to renderer');
  win.webContents.send('todos-updated', { files, persona: config.persona || '' });
}

// ── AI message generation ────────────────────────────────────────────────────
async function generateMessage(files, persona, minutesSince = null) {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.warn('[api] ANTHROPIC_API_KEY not set, skipping AI message generation');
        return null;
    }

    const todoContext = files.filter(f => !f.error && f.content)
    .map(f => `### ${f.name}\n${f.content}`)
    .join('\n\n');

    if (!todoContext) {
        console.warn('[api] Cannot read any todo content, skipping AI message generation');
        return null;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    try {
        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            system: `${persona}\n\nReply in 1–2 short sentences only. Be direct and in-character. No markdown.`,
            messages: [
        {
          role:    'user',
          content: `It is ${dateStr} at ${timeStr}.${minutesSince !== null ? ` It has been ${minutesSince} minutes since my last check-in.` : ''} Here are my current tasks:\n\n${todoContext}\n\nGive me a brief productivity nudge.`,
        },
      ],
    });

    const text = response.content[0].text.trim();
    console.log('[api] Generated:', text);
    return text;
  } catch (err) {
    console.error('[api] Anthropic error:', err.message);
    return null;
  }
    
}

async function sendAiMessage() {
  const files        = readTodoFiles();
  const minutesSince = lastCheckInAt
    ? Math.round((Date.now() - lastCheckInAt) / 60000)
    : null;

  const text = await generateMessage(files, config.persona || '', minutesSince);
  if (!text || !win || win.isDestroyed()) return;

  lastCheckInAt = Date.now();
  win.webContents.send('ai-message', { text, mood: 'neutral' });
}

function startCheckInTimer() {
  if (checkInTimer) clearInterval(checkInTimer);
  const ms = (config.checkInIntervalMinutes || 30) * 60 * 1000;
  checkInTimer = setInterval(sendAiMessage, ms);
  console.log(`[timer] Check-in every ${config.checkInIntervalMinutes || 30} minutes`);
}


// ── File watching ───────────────────────────────────────────────────────────
const debounceTimers = {};

function startWatching() {
  fileWatchers.forEach(w => { try { w.close(); } catch {} });
  fileWatchers = [];

  (config.todoPaths || []).forEach(p => {
    const resolved = resolvePath(p);
    try {
      const watcher = fs.watch(resolved, eventType => {
        if (eventType !== 'change') return;
        clearTimeout(debounceTimers[resolved]);
        debounceTimers[resolved] = setTimeout(() => {
          console.log('[watch] Changed:', resolved);
          sendTodosToRenderer();
        }, 300); // debounce 300ms so rapid saves don't spam
      });
      fileWatchers.push(watcher);
      console.log('[watch] Watching:', resolved);
    } catch (err) {
      // File doesn't exist yet — that's okay, we'll report it in the UI
      console.warn('[watch] Cannot watch (file may not exist yet):', resolved);
    }
  });
}

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const WIN_W  = 210;
  const WIN_H  = 340; // taller than M1 to fit multi-line todo summary
  const MARGIN = 20;

  win = new BrowserWindow({
    width:       WIN_W,
    height:      WIN_H,
    x:           width  - WIN_W  - MARGIN,
    y:           height - WIN_H  - MARGIN,
    transparent: true,
    frame:       false,
    hasShadow:   false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   false,
    movable:     false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Send todos once the page is fully loaded
  win.webContents.on('did-finish-load', () => {
    sendTodosToRenderer();
    setTimeout(sendAiMessage, 1500);
    startCheckInTimer();
  });

  win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: 'Reload files now',  click: sendTodosToRenderer },
      { type: 'separator' },
      { label: 'Quit Desktop Buddy', click: () => app.quit() },
    ]).popup({ window: win });
  });
}

// ── IPC handlers ────────────────────────────────────────────────────────────
ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

// Renderer can request a fresh read at any time (e.g. on click)
ipcMain.on('request-todos', () => sendTodosToRenderer());

// ── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  config = loadConfig();
  createWindow();
  startWatching();
});

app.on('window-all-closed', () => app.quit());
