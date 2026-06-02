const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Mouse passthrough toggle (unchanged from M1) ──────────────────────
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),

  // ── Todos ──────────────────────────────────────────────────────────────
  // Ask main to push the current file contents immediately
  requestTodos: () => ipcRenderer.send('request-todos'),

  // Register a callback that fires whenever files are loaded or change
  onTodosUpdated: (callback) => {
    ipcRenderer.on('todos-updated', (_event, payload) => callback(payload));
  },

  onAiMessage: (callback) => {
    ipcRenderer.on('ai-message', (_event, payload) => callback(payload));
  }
});
