const { safeStorage, shell, Notification } = require('electron')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const TOKEN_PATH = path.join(app.getPath('userData'), 'auth.enc')

function setupIpcHandlers(ipcMain, mainWindow) {
  // ── Token storage (safeStorage = OS keychain on Mac, DPAPI on Win) ──────────
  ipcMain.handle('store-token', async (_, token) => {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const enc = safeStorage.encryptString(token)
        fs.writeFileSync(TOKEN_PATH, enc)
      } else {
        fs.writeFileSync(TOKEN_PATH, Buffer.from(token, 'utf8'))
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('load-token', async () => {
    try {
      if (!fs.existsSync(TOKEN_PATH)) return null
      const buf = fs.readFileSync(TOKEN_PATH)
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(buf)
      }
      return buf.toString('utf8')
    } catch {
      return null
    }
  })

  ipcMain.handle('clear-token', async () => {
    try {
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ── External browser (OAuth) ──────────────────────────────────────────────
  ipcMain.handle('open-external', async (_, url) => {
    await shell.openExternal(url)
    return { ok: true }
  })

  // ── System notification ───────────────────────────────────────────────────
  ipcMain.handle('show-notification', async (_, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
    return { ok: true }
  })

  // ── Behavioral monitor ────────────────────────────────────────────────────
  let monitor = null
  let monitorInterval = null
  let liveInterval = null

  // ── Live stats (local display only) ────────────────────────────────────────
  // PRIVACY INVARIANT: these are AGGREGATES over a 5-second window — counts and
  // timings. We never record WHICH key was pressed (only whether it was
  // Backspace), no text, no window titles, no pointer coordinates over time.
  const LIVE_MS = 5000
  const newLive = () => ({ keys: 0, back: 0, gaps: [], mouse: [], clicks: 0, pauses: 0 })
  let live = newLive()
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  const flushLive = (simulated) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const l = live
    live = newLive()
    mainWindow.webContents.send('live-stats', {
      t: Date.now(),
      keys: l.keys,
      cps: l.keys / (LIVE_MS / 1000),
      interKeyMs: mean(l.gaps),
      errorRate: l.keys > 0 ? Math.min(l.back / l.keys, 1) : null,
      mouseSpeed: mean(l.mouse),
      clicks: l.clicks,
      pauses: l.pauses,
      simulated: !!simulated,
    })
  }

  ipcMain.handle('start-monitor', async () => {
    if (monitor) return { ok: true, already: true }
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi')
      let keyEvents = [], mouseEvents = []
      let backspaces = 0, totalKeys = 0
      let lastKeyTime = null

      uIOhook.on('keydown', (e) => {
        const now = Date.now()
        if (lastKeyTime) {
          keyEvents.push(now - lastKeyTime)
          if (now - lastKeyTime <= 2000) live.gaps.push(now - lastKeyTime)
          else live.pauses++
        }
        const isBack = e.keycode === UiohookKey.Backspace
        if (isBack) { backspaces++; live.back++ }
        totalKeys++
        live.keys++
        lastKeyTime = now
      })

      uIOhook.on('mousedown', () => { live.clicks++ })

      let lastMouse = null, mouseSpeeds = []
      uIOhook.on('mousemove', (e) => {
        const now = Date.now()
        if (lastMouse) {
          const dx = e.x - lastMouse.x, dy = e.y - lastMouse.y
          const dist = Math.sqrt(dx*dx + dy*dy)
          const dt = (now - lastMouse.t) / 1000
          if (dt > 0) { mouseSpeeds.push(dist / dt); live.mouse.push(dist / dt) }
        }
        lastMouse = { x: e.x, y: e.y, t: now }
      })

      uIOhook.start()
      monitor = uIOhook
      liveInterval = setInterval(() => flushLive(false), LIVE_MS)

      // Send batch every 30s
      monitorInterval = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        const batch = {
          keystroke_mean: keyEvents.length ? keyEvents.reduce((a,b) => a+b,0)/keyEvents.length : null,
          keystroke_std:  keyEvents.length > 1 ? Math.sqrt(keyEvents.map(k => Math.pow(k - keyEvents.reduce((a,b)=>a+b,0)/keyEvents.length,2)).reduce((a,b)=>a+b,0)/keyEvents.length) : null,
          error_rate: totalKeys > 0 ? Math.min(backspaces/totalKeys, 1) : null,
          mouse_velocity: mouseSpeeds.length ? mouseSpeeds.reduce((a,b)=>a+b,0)/mouseSpeeds.length : null,
          platform: 'desktop',
          window_start: new Date().toISOString(),
          session_duration: 30,
        }
        mainWindow.webContents.send('behavioral-batch', batch)
        // Reset
        keyEvents = []; backspaces = 0; totalKeys = 0; mouseSpeeds = []
      }, 30000)

      return { ok: true }
    } catch (e) {
      // uiohook not available — simulate for development
      let drift = 0, phase = 0
      liveInterval = setInterval(() => {
        // Gentle random walk + a slow "stress wave" so charts have something to show.
        phase += 0.12
        drift = Math.max(-1, Math.min(1.5, drift + (Math.random() - 0.45) * 0.25))
        const stress = Math.max(0, Math.sin(phase) * 0.6 + drift * 0.5)
        const typing = Math.random() > 0.15
        const keys = typing ? Math.round(10 + Math.random() * 18 + stress * 14) : 0
        live = {
          keys,
          back: Math.round(keys * (0.03 + stress * 0.09 + Math.random() * 0.02)),
          gaps: keys ? [Math.max(40, 150 - stress * 55 + (Math.random() - 0.5) * 50)] : [],
          mouse: [120 + Math.random() * 90 + stress * 160],
          clicks: Math.round(Math.random() * 3 + stress * 3),
          pauses: typing ? (Math.random() < 0.2 + stress * 0.2 ? 1 : 0) : 1,
        }
        flushLive(true)
      }, LIVE_MS)
      // Simulated numbers are for the on-screen preview only. They are NEVER sent as 'behavioral-batch',
      // so fake data can't be uploaded and mixed into the all-device average.
      return { ok: true, simulated: true }
    }
  })

  ipcMain.handle('stop-monitor', async () => {
    if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null }
    if (liveInterval) { clearInterval(liveInterval); liveInterval = null }
    if (monitor) {
      try { monitor.stop() } catch {}
      monitor = null
    }
    return { ok: true }
  })
}

module.exports = { setupIpcHandlers }
