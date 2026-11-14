const { withDangerousMod, withEntitlementsPlist } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const SETUP_NOTE = `# StressTwin Keyboard — iOS extension setup (manual step)

Expo config plugins can configure the HOST APP (entitlements, Info.plist,
build settings) automatically, but Apple's tooling has no supported way for
a config plugin to create a brand-new Xcode target (the keyboard extension
itself) inside the generated ios/ project. This is a real Xcode Extension
API constraint, not something skipped for convenience — the App Store also
requires each extension to be its own signed target.

After running \`npx expo prebuild\`, do this ONCE in Xcode:

1. Open ios/StressTwin.xcworkspace.
2. File → New → Target… → "Custom Keyboard Extension".
   - Product Name: StressTwinKeyboardExtension
   - Bundle ID: com.stresstwin.app.keyboard (must be nested under the app's ID)
3. Replace the generated KeyboardViewController.swift / Info.plist with the
   ones in modules/stresstwin-keyboard/ios/StressTwinKeyboardExtension/, and
   add modules/stresstwin-keyboard/ios/Shared/SharedSnapshotStore.swift to
   BOTH the extension target and the main app target's "Compile Sources".
4. Select the new extension target → Signing & Capabilities → "+ Capability"
   → App Groups → enable group.com.stresstwin.app.shared (already added to
   the main app's entitlements by this config plugin/app.json).
5. Build once from Xcode so the extension target is embedded in the app
   bundle; subsequent \`eas build\` / \`expo run:ios\` runs will pick it up
   from the checked-in ios/ project.

This file is regenerated on every \`expo prebuild --clean\`; the Xcode step
above will need to be redone after a clean prebuild (a known limitation of
mixing Expo managed workflow with custom Xcode extension targets — many
teams solve this by committing the generated ios/ folder and running
\`expo prebuild\` only when truly needed, rather than on every build).
`

module.exports = function withStressTwinKeyboardIOS(config) {
  config = withEntitlementsPlist(config, (config) => {
    const groups = new Set(config.modResults['com.apple.security.application-groups'] || [])
    groups.add('group.com.stresstwin.app.shared')
    config.modResults['com.apple.security.application-groups'] = Array.from(groups)
    return config
  })

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const iosDir = config.modRequest.platformProjectRoot
      fs.writeFileSync(path.join(iosDir, 'STRESSTWIN_KEYBOARD_SETUP.md'), SETUP_NOTE)
      return config
    },
  ])

  return config
}
