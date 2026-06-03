const { app, BrowserWindow, screen, ipcMain, Menu, dialog } = require('electron');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

let win;
let settingsWin   = null;
let config        = {};
let fileWatchers  = [];
let lastCheckInAt = null;
let checkInTimer  = null;
let apiKey        = null;
let anthropic     = null;

// ── userData helpers ──────────────────────────────────────────────────────────
function getUserDataPath(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

function ensureUserDataDir() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
}

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  const configPath = getUserDataPath('config.json');

  if (!fs.existsSync(configPath)) {
    const legacyPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(legacyPath)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
        ensureUserDataDir();
        fs.writeFileSync(configPath, JSON.stringify(legacy, null, 2));
        console.log('[config] Migrated config.json to userData');
        return legacy;
      } catch (err) {
        console.warn('[config] Migration failed:', err.message);
      }
    }
    return {
      todoPaths: [],
      checkInIntervalMinutes: 30,
      persona: 'A friendly but firm productivity robot named Byte. You are concise, occasionally dry, but genuinely care about helping the user stay on track.',
    };
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error('[config] Failed to load config.json:', err.message);
    return { todoPaths: [], checkInIntervalMinutes: 30, persona: 'A helpful productivity assistant.' };
  }
}

function saveConfig(newConfig) {
  ensureUserDataDir();
  fs.writeFileSync(getUserDataPath('config.json'), JSON.stringify(newConfig, null, 2));
  console.log('[config] Saved');
}

// ── API key ───────────────────────────────────────────────────────────────────
function loadApiKey() {
  const credPath = getUserDataPath('credentials.json');

  if (!fs.existsSync(credPath)) {
    // Migrate from .env if present
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        const match   = content.match(/ANTHROPIC_API_KEY\s*=\s*(.+)/);
        if (match) {
          const key = match[1].trim().replace(/^['"]|['"]$/g, '');
          saveApiKey(key);
          console.log('[config] Migrated API key from .env to userData');
          return key;
        }
      } catch (err) {
        console.warn('[config] .env migration failed:', err.message);
      }
    }
    return null;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    return creds.apiKey || null;
  } catch (err) {
    console.error('[config] Failed to load credentials:', err.message);
    return null;
  }
}

function saveApiKey(key) {
  ensureUserDataDir();
  fs.writeFileSync(getUserDataPath('credentials.json'), JSON.stringify({ apiKey: key }, null, 2));
}

function initAnthropicClient(key) {
  anthropic = key ? new Anthropic({ apiKey: key }) : null;
  if (key) console.log('[api] Anthropic client initialized');
}

// ── File helpers ──────────────────────────────────────────────────────────────
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

// ── IPC: push latest todos to the renderer ────────────────────────────────────
function sendTodosToRenderer() {
  if (!win || win.isDestroyed()) return;
  const files = readTodoFiles();
  console.log('[todos] Sending', files.length, 'file(s) to renderer');
  win.webContents.send('todos-updated', { files, persona: config.persona || '' });
}

// ── AI message generation ─────────────────────────────────────────────────────
async function generateMessage(files, persona, minutesSince = null) {
  if (!anthropic) {
    console.warn('[api] No API key — open Settings to add one');
    return null;
  }

  const todoContext = files.filter(f => !f.error && f.content)
    .map(f => `### ${f.name}\n${f.content}`)
    .join('\n\n');

  if (!todoContext) {
    console.warn('[api] No todo content available');
    return null;
  }

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     `${persona}\n\nReply with a JSON object only — no markdown, no extra text: {"mood": "happy|stern|neutral", "text": "your 1–2 sentence message"}. Use happy for encouragement or progress, stern for overdue tasks or procrastination, neutral otherwise.`,
      messages: [
        {
          role:    'user',
          content: `It is ${dateStr} at ${timeStr}.${minutesSince !== null ? ` It has been ${minutesSince} minutes since my last check-in.` : ''} Here are my current tasks:\n\n${todoContext}\n\nGive me a brief productivity nudge.`,
        },
      ],
    });

    const raw = response.content[0].text.trim();
    console.log('[api] Raw response:', raw);
    let text, mood;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed    = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      text = parsed.text ? String(parsed.text).trim() : raw;
      mood = ['happy', 'stern', 'neutral'].includes(parsed.mood) ? parsed.mood : 'neutral';
    } catch {
      text = raw;
      mood = 'neutral';
    }
    console.log('[api] Generated:', text, '| mood:', mood);
    return { text, mood };
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

  const result = await generateMessage(files, config.persona || '', minutesSince);
  if (!result || !win || win.isDestroyed()) return;

  lastCheckInAt = Date.now();
  win.webContents.send('ai-message', { text: result.text, mood: result.mood });
}

function startCheckInTimer() {
  if (checkInTimer) clearInterval(checkInTimer);
  const ms = (config.checkInIntervalMinutes || 30) * 60 * 1000;
  checkInTimer = setInterval(sendAiMessage, ms);
  console.log(`[timer] Check-in every ${config.checkInIntervalMinutes || 30} minutes`);
}

// ── File watching ─────────────────────────────────────────────────────────────
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
        }, 300);
      });
      fileWatchers.push(watcher);
      console.log('[watch] Watching:', resolved);
    } catch (err) {
      console.warn('[watch] Cannot watch:', resolved);
    }
  });
}

// ── Settings window ───────────────────────────────────────────────────────────
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width:       480,
    height:      580,
    title:       'Byte — Settings',
    resizable:   false,
    minimizable: false,
    webPreferences: {
      preload:          path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  settingsWin.loadFile(path.join(__dirname, 'settings', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ── Main window ───────────────────────────────────────────────────────────────
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const WIN_W  = 210;
  const WIN_H  = 380;
  const MARGIN = 12;

  win = new BrowserWindow({
    width:       WIN_W,
    height:      WIN_H,
    x:           MARGIN,
    y:           height - WIN_H - MARGIN,
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

  win.webContents.on('did-finish-load', () => {
    sendTodosToRenderer();
    setTimeout(sendAiMessage, 1500);
    startCheckInTimer();
  });

  win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: 'Settings…',          click: openSettings },
      { label: 'Reload files now',   click: sendTodosToRenderer },
      { type: 'separator' },
      { label: 'Quit Desktop Buddy', click: () => app.quit() },
    ]).popup({ window: win });
  });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('request-todos', () => sendTodosToRenderer());

ipcMain.handle('get-config', () => ({
  apiKey:                 apiKey || '',
  todoPaths:              config.todoPaths || [],
  checkInIntervalMinutes: config.checkInIntervalMinutes || 30,
  persona:                config.persona || '',
}));

ipcMain.handle('save-config', (_e, data) => {
  if (data.apiKey !== undefined) {
    apiKey = data.apiKey;
    saveApiKey(data.apiKey);
    initAnthropicClient(data.apiKey);
  }
  config.todoPaths              = data.todoPaths;
  config.checkInIntervalMinutes = data.checkInIntervalMinutes;
  config.persona                = data.persona;
  saveConfig(config);
  startWatching();
  startCheckInTimer();
  sendTodosToRenderer();
  return { success: true };
});

ipcMain.handle('test-api-key', async (_e, key) => {
  try {
    const client = new Anthropic({ apiKey: key });
    await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages:   [{ role: 'user', content: 'Hi' }],
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog(settingsWin, {
    properties: ['openFile'],
    filters:    [{ name: 'Markdown / Text', extensions: ['md', 'txt'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.on('close-settings', () => {
  if (settingsWin) settingsWin.close();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  config   = loadConfig();
  apiKey   = loadApiKey();
  initAnthropicClient(apiKey);
  createWindow();
  startWatching();
});

app.on('window-all-closed', () => app.quit());
