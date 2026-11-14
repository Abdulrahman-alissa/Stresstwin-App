# Running StressTwin Mobile in Xcode

The iOS side has one genuine manual step that Android doesn't: **Apple's
tooling has no supported way for a config plugin to create a brand-new
Xcode target.** Everything else — entitlements, the App Group, the host-app
Expo module — is automated the same way as Android. This doc covers both
the automated part and the one manual part, in order.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| macOS | — | Xcode does not run on Windows/Linux; this is an Apple platform requirement, not a project choice |
| Xcode | 15 or newer | Install from the Mac App Store |
| CocoaPods | any recent | `sudo gem install cocoapods` if you don't have it |
| Node.js | 18+ | `node -v` |
| An Apple ID (free is fine for simulator; a paid Apple Developer account is only needed to run on a physical device or ship to TestFlight) | — | Custom keyboard extensions **do** work in the iOS Simulator, so you can do all of steps 1–7 below without ever paying Apple anything |

---

## 2. Install dependencies

```bash
cd stresstwin-mobile
npm install --legacy-peer-deps
bash doctor.sh          # same environment checker used for Android
```

---

## 3. Point the app at your backend

Same as Android — see `.env.example`:
```bash
cp .env.example .env
```
Set `EXPO_PUBLIC_API_BASE_URL` to your computer's LAN IP (not `localhost` —
the Simulator shares your Mac's network stack so `localhost` *does*
technically work for the Simulator specifically, but use your LAN IP anyway
if you'll ever test on a physical iPhone, so you don't have two different
configs).

---

## 4. Install CocoaPods dependencies

```bash
cd ios
pod install
cd ..
```
This resolves the native iOS dependencies, including the local
`stresstwin-keyboard` module — you can confirm it's picked up beforehand
with:
```bash
node node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js resolve --platform ios --json
```
which should list a `stresstwin-keyboard` entry with a `StressTwinKeyboard`
pod and Swift module. If it's missing, run `npm install --legacy-peer-deps`
again first — `pod install` can only link what npm already resolved.

---

## 5. Open the project

**Open `ios/StressTwin.xcworkspace`** — not the `.xcodeproj` file. Opening
the `.xcodeproj` directly skips CocoaPods' integration and things will fail
to build in confusing ways.

At this point you have a normal Expo iOS app that builds and runs — the
keyboard extension target does not exist yet. Build and run it now
(⌘R, pick a Simulator) to confirm the baseline app works before adding the
extension.

---

## 6. Add the keyboard extension target (the one manual step)

This project auto-generates exact instructions for your checkout at
**`ios/STRESSTWIN_KEYBOARD_SETUP.md`** every time you run `expo prebuild` —
open that file, since it's guaranteed to match your actual bundle IDs. The
short version:

1. **File → New → Target…** → search "Custom Keyboard Extension"
   - Product Name: `StressTwinKeyboardExtension`
   - Bundle ID: `com.stresstwin.app.keyboard` (must be nested under the main
     app's bundle ID — Xcode does this automatically if you leave the
     suggested default)
   - Language: Swift
2. Xcode creates a stub `KeyboardViewController.swift` and `Info.plist` for
   the new target — **delete those** and instead add the real ones already
   in this repo:
   - `modules/stresstwin-keyboard/ios/StressTwinKeyboardExtension/KeyboardViewController.swift`
   - `modules/stresstwin-keyboard/ios/StressTwinKeyboardExtension/BehavioralFeatureCollector.swift`
   - `modules/stresstwin-keyboard/ios/StressTwinKeyboardExtension/Info.plist`
   - `modules/stresstwin-keyboard/ios/Shared/SharedSnapshotStore.swift` —
     add this one to **both** the new extension target *and* the main
     `StressTwin` target's "Compile Sources" (it's the file that lets the
     two processes hand data to each other — see §8)
3. Select the **StressTwinKeyboardExtension** target → **Signing &
   Capabilities** → **+ Capability** → **App Groups** → enable
   `group.com.stresstwin.app.shared` (this exact string must match what's
   already in the main app's entitlements — `expo prebuild` set that part
   up for you, confirm it in `ios/StressTwin/StressTwin.entitlements`).
4. Build (⌘B) with the **StressTwinKeyboardExtension** scheme selected at
   least once, then switch back to the **StressTwin** scheme and Run (⌘R)
   — this embeds the extension inside the app bundle.

**This step needs to be redone after `expo prebuild --clean`,** since a
clean prebuild regenerates `ios/` from scratch and wipes any target you
added by hand in Xcode. If you're not actively changing `app.json` or the
config plugins, avoid `--clean` and you won't need to repeat this.

---

## 7. Enable and test the keyboard (Simulator or device)

1. Run the app (with the extension embedded, per step 6).
2. On the Simulator/device: **Settings → General → Keyboard → Keyboards →
   Add New Keyboard…** → StressTwin Keyboard.
3. Tap it again in that same list to **enable it** — adding and enabling
   are two separate taps in iOS's UI, easy to miss the second one.
4. Deciding on **"Allow Full Access"**: you can say no. This project
   deliberately doesn't need it for the core behavioral logging (see
   `SharedSnapshotStore.swift`'s comments) — only the host app talks to the
   network, not the extension. Full Access would only matter for a future
   feature that needed the extension itself to make network calls.
5. Open any text field, tap the globe icon to switch keyboards, pick
   StressTwin Keyboard, and type.
6. Back in the StressTwin app → Settings → Keyboard. Unlike Android, **iOS
   gives no API for the host app to confirm the keyboard is the active
   one** — this isn't a bug, it's Apple withholding that information from
   third-party apps. The UI accounts for this: it shows "installed" based on
   whether the extension has ever written a snapshot, and asks you to
   confirm by typing rather than claiming false certainty.

---

## 8. How the extension and the app actually talk (context for step 6)

An iOS keyboard extension runs as a separate, sandboxed process — it cannot
call into the host app directly. `SharedSnapshotStore.swift` is the bridge:
the extension appends finished 15-second snapshots to a shared **App Group**
container (`UserDefaults(suiteName: "group.com.stresstwin.app.shared")`),
and the host app's Expo module (`StressTwinKeyboardModule.swift`) drains
that container on its own schedule. This is Apple's sanctioned mechanism for
extension ↔ host-app data exchange — there's no faster/simpler option, and
it's why the App Group entitlement has to match exactly on both targets.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `pod install` fails resolving `StressTwinKeyboard` | npm dependencies weren't installed first | `cd .. && npm install --legacy-peer-deps && cd ios && pod install` |
| Build fails: "No such module 'ExpoModulesCore'" in the extension target | The extension target's "Compile Sources" wasn't given the shared Swift files, or the target's minimum iOS version is set below the main app's | Recheck step 6.2; align the extension's Deployment Target with the main app's in Build Settings |
| Keyboard doesn't show up under Settings → Keyboards at all | Extension isn't embedded — you built the extension scheme but never rebuilt the main app afterward | Re-run ⌘R on the **StressTwin** (main app) scheme |
| Typing does nothing / extension crashes immediately | `Info.plist`'s `NSExtensionPrincipalClass` doesn't match the actual Swift class name/module | Confirm it reads `$(PRODUCT_MODULE_NAME).KeyboardViewController` exactly as shipped in this repo |
| Snapshots never appear on the dashboard | App Group ID mismatch between the two targets' entitlements | Both must be the literal string `group.com.stresstwin.app.shared` — copy-paste, don't retype |
| `expo prebuild --clean` "undid" my Xcode target | Expected — see the note at the end of step 6 | Redo step 6, or avoid `--clean` when you don't need it |

---

## 10. What "done" looks like

- Main app builds and runs from Xcode without the extension (step 5) ✔
- Extension target added, App Group capability enabled, builds without
  errors (step 6) ✔
- Keyboard appears under Settings → Keyboards, can be added and enabled
  (step 7) ✔
- Typing in another app, then reopening StressTwin, eventually shows the
  device under **My Devices** on the dashboard after a sync cycle

I can't verify any of the Xcode-specific steps by actually running Xcode in
this environment — there's no macOS/Xcode available here, only Linux with
Node — so §6–8 are written from the underlying Swift code and Apple's
documented extension model, not from having clicked through this myself.
If Xcode's UI has moved since (Apple does this periodically), the target
names and menu paths are the most likely thing to drift.
