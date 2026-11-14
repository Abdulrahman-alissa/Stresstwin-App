const { app, BrowserWindow, Tray, Menu, nativeImage, shell,
        ipcMain, Notification, session } = require('electron')
const path = require('path')
// `app.isPackaged` is Electron's own, reliable signal for "am I a built app
// or running from source" — it's set correctly by Electron itself in every
// packaged build on every platform. NODE_ENV, by contrast, is NOT set by
// electron-builder/AppImage/dmg packaging at all, so a previous version of
// this check (`process.env.NODE_ENV !== 'production'`) meant every real,
// installed build still evaluated isDev = true and tried to load the Vite
// dev server at localhost:5173 — which doesn't exist outside a developer's
// machine — producing a blank window for every actual user. This is the fix.
const isDev = !app.isPackaged

let mainWindow = null
let tray = null

// ── Deep-link (stressTwin://) for OAuth callbacks ────────────────────────────
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('stressTwin', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('stressTwin')
}

// ── Single instance ───────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // Handle deep link on Windows
    const url = argv.find(arg => arg.startsWith('stresstwin://'))
    if (url) handleDeepLink(url)
  })
}

function handleDeepLink(url) {
  if (mainWindow) {
    mainWindow.webContents.send('deep-link', url)
  }
}

const APP_ICON = path.join(__dirname, isDev ? '../public/icon.png' : '../dist/icon.png')

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0A0B0F',
    icon: APP_ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.on('close', (e) => {
    if (process.platform !== 'darwin') {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // macOS deep link
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })
}

// ── System Tray ───────────────────────────────────────────────────────────────
function createTray() {
  let icon = nativeImage.createFromPath(APP_ICON)
  icon = icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 18, height: 18 })
  tray = new Tray(icon)

  const updateMenu = (score = null) => {
    const label = score !== null ? `Stress Index: ${score}/100` : 'StressTwin'
    tray.setToolTip(label)
    const menu = Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => { mainWindow.show(); mainWindow.focus() } },
      { type: 'separator' },
      { label: 'Quit StressTwin', click: () => { app.isQuiting = true; app.quit() } },
    ])
    tray.setContextMenu(menu)
  }

  updateMenu()
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus() })

  ipcMain.on('update-tray-score', (_, score) => updateMenu(score))
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
const { setupIpcHandlers } = require('./ipc')

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  createTray()
  setupIpcHandlers(ipcMain, mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { app.isQuiting = true })
