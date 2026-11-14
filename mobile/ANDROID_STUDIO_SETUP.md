# Running StressTwin Mobile in Android Studio

This covers everything from a clean machine to a working build on a device
or emulator, plus how to actually test the custom keyboard once it's
installed. If anything here doesn't match what you see, run `bash doctor.sh`
first — it catches most of the issues below automatically.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Android Studio | Koala (2024.1) or newer | Comes bundled with a compatible JDK — see §3 |
| Node.js | 18 or newer | `node -v` to check |
| A physical Android phone (recommended) or an AVD emulator | Android 8.0 (API 26) or newer for realistic testing | Custom keyboards work on the emulator too, so a physical device isn't strictly required |
| The StressTwin backend running somewhere reachable | — | Local machine on the same Wi-Fi, or deployed (see the hosting notes from earlier) |

You do **not** need to separately install the Android SDK — Android Studio's
first-run wizard installs it, and Gradle will additionally auto-install any
specific SDK Platform / Build-Tools / NDK version this project needs the
first time you sync.

---

## 2. Install dependencies

```bash
cd stresstwin-mobile
npm install --legacy-peer-deps
```

The `--legacy-peer-deps` flag is required because of a pre-existing version
conflict between `victory-native` and `react-native-skia` in this project —
harmless, just an npm peer-dependency warning that predates the keyboard
work.

Run the environment check:
```bash
bash doctor.sh
```

---

## 3. Point Android Studio at the right JDK (important)

Gradle 8.8 (used by this project) wants **JDK 17**. Rather than relying on
whatever `java -version` prints on your system (this sandbox has JDK 21,
which usually works too, but Android Studio's bundled JDK is the safest,
best-tested option), tell Android Studio to use its own:

**Android Studio → Settings/Preferences → Build, Execution, Deployment →
Build Tools → Gradle → Gradle JDK → select "Embedded JDK" (or "jbr-17").**

This avoids the single most common first-sync failure
(`Unsupported class file major version...`).

---

## 4. Open the project

**File → Open** → select the `stresstwin-mobile/android` folder specifically
(not the `stresstwin-mobile` root — that's the JavaScript project; `android/`
is the native Gradle project Android Studio understands).

Let Gradle sync. First sync will:
- Download Gradle 8.8 itself (~200MB) if you don't have it cached
- Download the Android SDK Platform 34, Build-Tools 34.0.0, and NDK
  26.1.10909125 if missing
- Resolve all Expo/React Native native dependencies, including the local
  `stresstwin-keyboard` module (the custom IME)

This can take 5–15 minutes on a fresh machine. Subsequent syncs are fast.

If sync fails with **"SDK location not found"**: copy
`android/local.properties.example` to `android/local.properties` and set
`sdk.dir` to your actual SDK path (Android Studio normally writes this file
for you automatically — you only need to do it by hand if it didn't).

---

## 5. Point the app at your backend

The app reads `EXPO_PUBLIC_API_BASE_URL` at build time. Create a `.env` file:

```bash
cp .env.example .env
```

Then edit it — **use your computer's LAN IP, not `localhost`** (a phone or
emulator is a different device from your computer; `localhost` on the phone
means the phone itself). `.env.example` has copy-paste commands for finding
your LAN IP on macOS/Linux/Windows, and the `10.0.2.2` shortcut if you're
using the Android Emulator specifically (not a physical device).

Your backend also needs to accept connections from other devices on your
network — if you're running `uvicorn main:app --reload` locally, make sure
it's bound to `0.0.0.0`, not `127.0.0.1`:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
and that your firewall allows inbound connections on port 8000 from your
local network.

---

## 6. Run it

Either press **Run ▶** in Android Studio (top toolbar, green triangle) with
a device/emulator selected, or from the terminal:
```bash
npx expo run:android
```
Both do the same thing — build the native app and install it.

---

## 7. Enable and test the keyboard

Installing the app does **not** automatically make StressTwin Keyboard the
active keyboard — that's an OS-level opt-in, same as any third-party
keyboard app:

1. Open the StressTwin app → **Settings → Keyboard → Open Keyboard
   Settings**. This deep-links into Android's Input Method settings.
2. Toggle **StressTwin Keyboard** on. Android will show a warning dialog
   about keyboards being able to see what you type — this is standard
   boilerplate Android shows for *every* third-party keyboard, not something
   specific to this app. (This is exactly why the in-app Keyboard Settings
   screen spells out what is/isn't collected — see Section 5.2 of the
   design report.)
3. Open any app with a text field (e.g. Messages, or a Notes app), tap the
   field, then long-press the globe/keyboard-switch icon on the on-screen
   keyboard and pick **StressTwin Keyboard**.
4. Type a sentence or two. Behind the scenes this is producing 15-second
   behavioral snapshots (see `BehavioralFeatureCollector.kt`).
5. Go back to the StressTwin app → Settings → Keyboard. Status should show
   🟢 **Enabled** within about 15–30 seconds of typing.
6. Check the **Devices** section on the main dashboard — your phone should
   appear there once the first batch sync completes (every ~10 minutes, or
   immediately if you background/foreground the app).

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Gradle sync fails: `Unsupported class file major version 65` | Wrong JDK selected | Set Gradle JDK to the embedded one — see §3 |
| Gradle sync fails: `SDK location not found` | No `local.properties` | See §4 |
| Build fails resolving `stresstwin-keyboard` | `npm install` wasn't run, or was run before the module's `package.json` existed | `rm -rf node_modules && npm install --legacy-peer-deps`, then re-sync |
| App installs but shows a blank/loading dashboard forever | Backend unreachable from the device | Check `.env`'s IP is your LAN IP (not `localhost`), backend is bound to `0.0.0.0`, and phone + computer are on the same Wi-Fi network |
| StressTwin Keyboard doesn't appear in the keyboard picker | App wasn't reinstalled after the native `android/` project was regenerated | Uninstall the app from the device, then re-run `npx expo run:android` |
| Gradle daemon runs out of memory on a low-RAM machine | Default heap too small for your machine | Raise `org.gradle.jvmargs=-Xmx2048m` in `android/gradle.properties` to `-Xmx4096m` |
| `expo prebuild` complains about missing `assets/*.png` | Placeholder assets weren't committed to your fork | This zip already includes placeholder icons; if you regenerate from scratch, see `assets/` — replace them with real branded icons before shipping to a store |
| Emulator keyboard test doesn't reflect real typing feel | Expected | Emulators are fine for verifying the pipeline (snapshots → sync → dashboard) but a physical device gives a truer sense of typing latency |

---

## 9. What "done" looks like

- Gradle sync: green, no red errors in the Build panel
- App launches, dashboard loads (talking to your backend)
- Settings → Keyboard shows the keyboard as installable
- After enabling it in Android system settings and typing a bit, the
  in-app status flips to 🟢 Enabled
- The phone shows up under **My Devices** on the dashboard after the next
  sync

If you get through all of that, the same build is what `eas build` would
produce for distribution — see the earlier hosting notes for turning this
into something you can share without everyone needing Android Studio.
