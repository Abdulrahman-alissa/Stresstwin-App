const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stressTwin', {
  // Auth token storage (via main process safeStorage)
  storeToken:  (token) => ipcRenderer.invoke('store-token', token),
  loadToken:   ()      => ipcRenderer.invoke('load-token'),
  clearToken:  ()      => ipcRenderer.invoke('clear-token'),

  // Behavioral monitoring
  startMonitor: ()     => ipcRenderer.invoke('start-monitor'),
  stopMonitor:  ()     => ipcRenderer.invoke('stop-monitor'),
  onBatch:      (cb)   => ipcRenderer.on('behavioral-batch', (_, data) => cb(data)),
  onLiveStats:  (cb)   => ipcRenderer.on('live-stats', (_, data) => cb(data)),

  // Tray score update
  updateTrayScore: (score) => ipcRenderer.send('update-tray-score', score),

  // Deep-link (OAuth callback)
  onDeepLink: (cb) => ipcRenderer.on('deep-link', (_, url) => cb(url)),

  // Open external URL in browser (for OAuth)
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // System notification
  notify: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),

  // Platform
  platform: process.platform,
})
