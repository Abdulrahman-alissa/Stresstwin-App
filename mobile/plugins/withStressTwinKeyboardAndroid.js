const { withAndroidManifest } = require('@expo/config-plugins')

/**
 * The StressTwin Keyboard IME service, its settings activity, and the
 * BIND_INPUT_METHOD-permission <service> entry are all declared in
 * modules/stresstwin-keyboard/android/src/main/AndroidManifest.xml.
 * Because that module is a standard Android library module, Gradle's
 * manifest merger folds those entries into the app's final manifest
 * automatically during `expo prebuild` / a native build — no manual
 * manifest editing is required.
 *
 * This plugin does one extra thing only Gradle manifest merging can't:
 * makes sure RECEIVE_BOOT_COMPLETED is present at the app level too, since
 * some OEM Android builds are stricter about permissions declared only in
 * library manifests.
 */
module.exports = function withStressTwinKeyboardAndroid(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest
    manifest['uses-permission'] = manifest['uses-permission'] || []

    const has = manifest['uses-permission'].some(
      (p) => p.$?.['android:name'] === 'android.permission.RECEIVE_BOOT_COMPLETED'
    )
    if (!has) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.RECEIVE_BOOT_COMPLETED' },
      })
    }

    return config
  })
}
