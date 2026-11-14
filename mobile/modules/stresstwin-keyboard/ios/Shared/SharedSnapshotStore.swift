import Foundation

/// Behavioral-only snapshot — mirrors the backend's KeyboardSnapshot schema
/// and the Android FeatureSnapshot. There is deliberately no field capable of
/// holding typed text; only timing/statistics ever populate this struct.
struct FeatureSnapshot: Codable {
    let clientSnapshotId: String
    let windowStartIso: String
    let typingSpeedCps: Double?
    let interKeyIntervalMs: Double?
    let backspaceRate: Double?
    let correctionRate: Double?
    let pauseFrequency: Double?
    let typingBursts: Int?
    let typingInterruptions: Int?
    let charCount: Int?
    let sessionDuration: Int

    var asDictionary: [String: Any?] {
        [
            "client_snapshot_id": clientSnapshotId,
            "window_start": windowStartIso,
            "typing_speed_cps": typingSpeedCps,
            "inter_key_interval_ms": interKeyIntervalMs,
            "backspace_rate": backspaceRate,
            "correction_rate": correctionRate,
            "pause_frequency": pauseFrequency,
            "typing_bursts": typingBursts,
            "typing_interruptions": typingInterruptions,
            "char_count": charCount,
            "session_duration": sessionDuration,
        ]
    }
}

/// Keyboard extensions run in their own sandboxed process and cannot talk to
/// the host app directly. An App Group shared container (UserDefaults suite)
/// is Apple's sanctioned way for an extension and its host app to exchange
/// data. The extension writes finished snapshots here; the host app's Expo
/// module (StressTwinKeyboardModule) drains them on the 15s bridge pull.
///
/// NOTE — platform limitation: writing to the App Group container from the
/// extension does NOT require the user granting "Allow Full Access" (that's
/// only needed for network access or non-App-Group resources). This design
/// deliberately keeps the extension itself network-free — all uploads happen
/// from the host app — so StressTwin's core keyboard behavioral logging works
/// even for users who decline Full Access, per Apple's guidance to offer a
/// graceful fallback rather than blocking functionality.
enum SharedSnapshotStore {
    static let appGroupId = "group.com.stresstwin.app.shared"
    private static let storageKey = "stresstwin.keyboard.snapshots"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    static func append(_ snapshot: FeatureSnapshot) {
        guard let defaults = defaults else { return }
        var all = readAll()
        all.append(snapshot)
        // Cap the buffer defensively — the host app should be draining this
        // every ~15s, so this only matters if the host app hasn't opened in a
        // long time; avoids unbounded growth in the shared container.
        if all.count > 4000 { all = Array(all.suffix(4000)) }
        if let data = try? JSONEncoder().encode(all) {
            defaults.set(data, forKey: storageKey)
        }
    }

    static func readAll() -> [FeatureSnapshot] {
        guard let defaults = defaults, let data = defaults.data(forKey: storageKey) else { return [] }
        return (try? JSONDecoder().decode([FeatureSnapshot].self, from: data)) ?? []
    }

    /// Called from the host app side only.
    static func drainAll() -> [FeatureSnapshot] {
        let all = readAll()
        defaults?.removeObject(forKey: storageKey)
        return all
    }
}
