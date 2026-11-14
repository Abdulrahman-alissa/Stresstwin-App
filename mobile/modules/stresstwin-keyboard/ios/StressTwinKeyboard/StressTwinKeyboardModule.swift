import ExpoModulesCore
import UIKit

public class StressTwinKeyboardModule: Module {
    public func definition() -> ModuleDefinition {
        Name("StressTwinKeyboard")

        AsyncFunction("getStatus") { () -> [String: Bool] in
            let installed = Self.isKeyboardInstalled()
            // iOS provides no public API for an app to ask "is my keyboard the
            // currently active one" — Apple treats that as user-private info.
            // We report `isActive` as false always and rely on `installed`
            // plus the "type something to confirm" flow the settings screen
            // shows. This is a real, documented platform limitation.
            return ["installed": installed, "isActive": false]
        }

        AsyncFunction("openSystemKeyboardSettings") { (promise: Promise) in
            // Apple does not allow deep-linking directly into
            // Settings > General > Keyboard > Keyboards. The best a third
            // party app can do is open the app's own Settings page and instruct
            // the user from there (handled in the RN UI copy).
            DispatchQueue.main.async {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url, options: [:]) { _ in promise.resolve(nil) }
                } else {
                    promise.resolve(nil)
                }
            }
        }

        AsyncFunction("drainSnapshots") { () -> [[String: Any?]] in
            let snapshots = SharedSnapshotStore.drainAll()
            return snapshots.map { $0.asDictionary }
        }
    }

    /// Checking "is a given custom keyboard extension enabled" from the host
    /// app has no dedicated public API either; the closest sanctioned signal
    /// is enumerating `UITextInputMode.activeInputModes`, which is not
    /// reliable pre-focus. As a pragmatic proxy, this checks whether the
    /// extension has ever written to the shared App Group container — if it
    /// has, the user has used it at least once, which is the strongest signal
    /// available without private API usage.
    private static func isKeyboardInstalled() -> Bool {
        UserDefaults(suiteName: SharedSnapshotStore.appGroupId) != nil
            && !SharedSnapshotStore.readAll().isEmpty
    }
}
