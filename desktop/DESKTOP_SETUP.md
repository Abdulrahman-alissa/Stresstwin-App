# Running StressTwin Desktop

This covers development (`npm run dev`) and building a real installable app
on Windows, macOS, and Linux — with extra detail for macOS, since it has the
most platform-specific steps (Gatekeeper, Accessibility permission, code
signing). Run `bash doctor.sh` any time to sanity-check your setup.

Everything in this doc was verified against a real build in this session —
see the "What I actually tested" note at the bottom for exactly what that
means and its limits.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | `node -v` |
| npm | comes with Node | `npm -v` |
| macOS only: Xcode Command Line Tools | any recent | `xcode-select --install` — only needed if the prebuilt `uiohook-napi` binary doesn't match your Mac (Apple Silicon vs Intel, Node version), in which case npm rebuilds it from source |
| Windows only: nothing extra normally | — | `uiohook-napi` ships prebuilt Windows binaries |

---

## 2. Install and run in development

```bash
cd stresstwin-desktop
npm install
cp .env.example .env       # edit VITE_API_BASE_URL if your backend isn't on localhost:8000
bash doctor.sh
npm run dev
```

`npm run dev` runs Vite's dev server and Electron together (`concurrently`)
and opens a real window pointed at `http://localhost:5173`. Hot reload works
for the React UI; changes to `electron/main.js` or `electron/ipc.js` need an
app restart (Ctrl/Cmd+C, then `npm run dev` again).

---

## 3. Building a real installer

```bash
npm run build          # current platform, output → dist-electron/
npm run build:win      # Windows .exe (NSIS installer)
npm run build:mac      # macOS .dmg
```

These are cross-compilable to a degree (electron-builder can build a Windows
target from Linux/macOS, for instance), but **macOS builds must be built on
macOS** — Apple's tooling for code signing and DMG creation only runs there.

The first `npm run build` on a fresh machine downloads a matching Electron
binary from GitHub (~100MB) — that's expected, not an error.

---

## 4. macOS specifics

### Accessibility permission (required for real behavioral sensing)

The desktop sensor (`uiohook-napi`, wired up in `electron/ipc.js`) needs
**global** keystroke/mouse events — i.e., events even when StressTwin isn't
the focused window — which macOS only allows for apps granted
**Accessibility** access.

- First run: macOS should prompt you automatically.
- If you dismissed it or it didn't appear: **System Settings → Privacy &
  Security → Accessibility** → enable StressTwin (or, during `npm run dev`,
  you may need to grant it to your terminal app / Electron itself, since
  you're running from source rather than a signed installed app).
- **Without this permission, the app doesn't crash or refuse to run** — the
  existing code already has a graceful fallback: if `uiohook-napi` can't
  start, it substitutes simulated behavioral data (`electron/ipc.js`,
  `start-monitor` handler's `catch` branch) so the rest of the app is still
  usable/demoable. Real users need the permission for real data.

### Gatekeeper ("StressTwin can't be opened because it is from an
unidentified developer")

Unless you have a paid Apple Developer account and code-sign + notarize the
build, macOS will show this warning for anyone you send the `.dmg` to
(including yourself on a different Mac). For local testing on your own
machine:
- **Right-click the app → Open** (instead of double-clicking) → Open anyway.
  This bypasses Gatekeeper for that one app, once.
- Or from Terminal: `xattr -cr /Applications/StressTwin.app` to strip the
  quarantine flag.

For actually distributing this to other people, you need:
1. An Apple Developer Program membership ($99/year)
2. A **Developer ID Application** certificate
3. `electron-builder`'s notarization step configured (it supports this via
   `afterSign` hooks + `@electron/notarize` — not set up in this project by
   default, since it requires your own Apple credentials)

This is a real limitation to plan for, not a bug — every unsigned Electron
app hits this on macOS.

### Code signing entitlements

`build/entitlements.mac.plist` is already wired into `package.json`'s `mac`
config (`entitlements` / `entitlementsInherit`). If you do set up signing,
you generally don't need to touch this file unless you add a capability
that needs its own entitlement.

---

## 5. Windows specifics

- `npm run build:win` produces an NSIS installer (`.exe`) that lets the user
  pick an install directory (`allowToChangeInstallationDirectory: true` in
  `package.json`).
- Unsigned Windows builds trigger a SmartScreen warning ("Windows protected
  your PC") similar in spirit to Gatekeeper — same story: fine for local
  testing, needs a code-signing certificate for real distribution.
- Global keystroke/mouse sensing via `uiohook-napi` works out of the box on
  Windows with the prebuilt binary; no extra permission step like macOS.

---

## 6. Linux specifics

- `npm run build` (no platform flag) on Linux produces an AppImage
  (`dist-electron/*.AppImage`) — a single portable executable, no
  installation step; just `chmod +x` it and run it.
- No special permission step for global input sensing (varies by
  distro/desktop environment — X11 generally works out of the box; Wayland
  sessions may restrict global input hooks similarly to how macOS restricts
  them, depending on your compositor).

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Window opens but shows a blank dark screen | This project used to have a real bug here — the packaged app checked `process.env.NODE_ENV`, which electron-builder never sets, so even installed builds tried to load the dev server at `localhost:5173` and failed silently. **Already fixed** in this codebase (`electron/main.js` now uses `!app.isPackaged` instead) — if you still see this, confirm your checkout has that fix. | Check `electron/main.js` line ~4 reads `const isDev = !app.isPackaged` |
| `npm run build` produces a window that can't load its own JS/CSS (`ERR_FILE_NOT_FOUND` in devtools) | Built assets used absolute paths (`/assets/...`), which break under Electron's `file://` protocol. Root cause: `vite.config.ts` conditionally sets a relative base path only when `process.env.ELECTRON==='true'`, but nothing set that variable during the actual build. **Already fixed** — build scripts now use `cross-env ELECTRON=true vite build`. | Confirm `package.json`'s `build`/`build:win`/`build:mac` scripts include `cross-env ELECTRON=true` |
| Every `.tsx` file fails `tsc` with "JSX element implicitly has type 'any'" | `@types/react` / `@types/react-dom` were missing from `package.json` entirely. **Already fixed.** | Confirm they're present in `devDependencies` |
| `import.meta.env.X` / `*.module.css` imports fail type-checking (though they work at runtime) | No `vite-env.d.ts` referencing `vite/client` types — standard Vite scaffolding that was missing. **Already fixed** (`src/vite-env.d.ts`). | Confirm that file exists |
| Global keystroke sensing silently does nothing / dashboard shows randomly-varying numbers that don't match your actual typing | `uiohook-napi` failed to initialize (see `bash doctor.sh` output) and the app fell back to simulated data — by design, not a crash | On macOS: grant Accessibility (§4). Elsewhere: try `npm rebuild uiohook-napi`, or check for a Node version mismatch |
| macOS: "can't be opened because it is from an unidentified developer" | No code signing (expected for a local/dev build) | See §4's Gatekeeper section |
| Dashboard never shows real data even after fixing sensing | Backend unreachable | Check `.env`'s `VITE_API_BASE_URL`, confirm the backend is actually running and reachable |

---

## 8. What I actually tested (and the limits of that)

Everything above marked "already fixed" was verified by actually running the
code in this session, not just read and assumed correct:
- Ran `tsc --noEmit` before and after the type-declaration fixes (300+
  errors → 0)
- Ran a real `vite build` and inspected the output HTML's asset paths
  before/after the `cross-env ELECTRON=true` fix (absolute → relative)
- Ran the real `electron-builder` pipeline end-to-end, producing an actual
  Linux AppImage
- Launched the actual built binary headlessly (Xvfb) and used Chrome
  DevTools Protocol to inspect the live DOM — confirmed the app was
  rendering nothing (`#root` empty) before the `isDev`/`app.isPackaged` fix,
  and rendering the real sign-in screen correctly after it
- Confirmed `uiohook-napi` (the native global-input module) loads
  successfully on Linux in this sandbox

**What I could not test here:** an actual macOS or Windows build — this
sandbox is Linux-only, no Xcode/macOS, no Windows. The Accessibility
permission flow, Gatekeeper behavior, and `.dmg`/`.exe` packaging specifics
in §4–5 are written from Apple's/Microsoft's documented behavior and
`electron-builder`'s documented config surface, not from having clicked
through them myself. If Apple's Accessibility settings UI has moved (they
do this periodically), the menu path is the most likely thing to drift.
