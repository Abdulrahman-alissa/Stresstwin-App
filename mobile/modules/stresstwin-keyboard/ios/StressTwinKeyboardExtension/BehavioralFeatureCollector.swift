import Foundation

/// Aggregates raw key events into one 15s behavioral snapshot.
///
/// CRITICAL PRIVACY INVARIANT: `recordKeyPress` takes only a timestamp and
/// two booleans (isBackspace / isCorrection) — never the character typed.
/// There is no code path here that can reconstruct typed text.
final class BehavioralFeatureCollector {
    private struct KeyEvent { let timestamp: TimeInterval; let isBackspace: Bool }

    private var events: [KeyEvent] = []
    private var windowStart = Date().timeIntervalSince1970

    private let burstGap: TimeInterval = 0.4
    private let pauseThreshold: TimeInterval = 2.0
    private let interruptionGap: TimeInterval = 5.0

    func recordKeyPress(isBackspace: Bool) {
        events.append(KeyEvent(timestamp: Date().timeIntervalSince1970, isBackspace: isBackspace))
    }

    /// Call every ~15s. Returns nil for an idle window (nothing typed).
    func flush() -> FeatureSnapshot? {
        let now = Date().timeIntervalSince1970
        let windowEvents = events
        events.removeAll()
        let startedAt = windowStart
        windowStart = now

        guard !windowEvents.isEmpty else { return nil }

        let n = windowEvents.count
        let durationSec = max(now - startedAt, 1.0)
        let typingSpeed = Double(n) / durationSec

        var intervals: [TimeInterval] = []
        for i in 1..<windowEvents.count {
            intervals.append((windowEvents[i].timestamp - windowEvents[i - 1].timestamp) * 1000) // ms
        }
        let meanIntervalMs = intervals.isEmpty ? nil : intervals.reduce(0, +) / Double(intervals.count)

        let backspaceCount = windowEvents.filter { $0.isBackspace }.count
        let backspaceRate = min(Double(backspaceCount) / Double(n), 1.0)
        // On iOS we treat backspaces as the correction signal too (same
        // conservative, content-free definition used on Android).
        let correctionRate = backspaceRate

        let pauses = intervals.filter { $0 / 1000.0 >= pauseThreshold }.count
        let pauseFrequency = Double(pauses) / (durationSec / 60.0)

        var bursts = 0
        var inBurst = false
        for i in 1..<max(windowEvents.count, 1) where i < windowEvents.count {
            let gap = windowEvents[i].timestamp - windowEvents[i - 1].timestamp
            if gap <= burstGap {
                if !inBurst { bursts += 1; inBurst = true }
            } else {
                inBurst = false
            }
        }

        let interruptions = intervals.filter { $0 / 1000.0 >= interruptionGap }.count

        let formatter = ISO8601DateFormatter()
        return FeatureSnapshot(
            clientSnapshotId: UUID().uuidString,
            windowStartIso: formatter.string(from: Date(timeIntervalSince1970: startedAt)),
            typingSpeedCps: typingSpeed,
            interKeyIntervalMs: meanIntervalMs,
            backspaceRate: backspaceRate,
            correctionRate: correctionRate,
            pauseFrequency: pauseFrequency,
            typingBursts: bursts,
            typingInterruptions: interruptions,
            charCount: n, // a COUNT only — never the characters themselves
            sessionDuration: Int(durationSec)
        )
    }
}
