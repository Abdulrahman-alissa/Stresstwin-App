package expo.modules.stresstwinkeyboard

import java.util.UUID
import kotlin.math.max
import kotlin.math.min

/**
 * Aggregates raw key events into a single 15-second behavioral snapshot.
 *
 * CRITICAL PRIVACY INVARIANT: this class never receives, stores, or
 * exposes the character/keycode that was pressed — only *timestamps* and a
 * *category* (`isBackspace` / `isCorrection`) needed to compute rates. There
 * is no field anywhere in this file capable of reconstructing typed text.
 * Do not add one.
 */
class BehavioralFeatureCollector(private val windowMs: Long = 15_000L) {

    /** category is intentionally the ONLY thing we know about a keystroke besides its timestamp. */
    private data class KeyEvent(val timestampMs: Long, val isBackspace: Boolean, val isCorrection: Boolean)

    private val events = mutableListOf<KeyEvent>()
    private var windowStartMs: Long = System.currentTimeMillis()
    private var lastEventMs: Long? = null
    private var burstCount = 0
    private var interruptionCount = 0
    private var inBurst = false

    private val burstGapMs = 400L          // consecutive keys within this gap count as one "burst"
    private val pauseThresholdMs = 2000L   // gap longer than this counts as a "pause"
    private val interruptionGapMs = 5000L  // a gap this long mid-typing counts as an interruption

    @Synchronized
    fun onKeyPress(isBackspace: Boolean, isCorrection: Boolean) {
        val now = System.currentTimeMillis()
        val gap = lastEventMs?.let { now - it }

        if (gap != null) {
            if (gap <= burstGapMs) {
                if (!inBurst) { burstCount++; inBurst = true }
            } else {
                inBurst = false
                if (gap >= interruptionGapMs) interruptionCount++
            }
        }

        events.add(KeyEvent(now, isBackspace, isCorrection))
        lastEventMs = now
    }

    /** Call every ~15s. Returns null if nothing happened in the window (no snapshot is emitted for idle windows). */
    @Synchronized
    fun flush(): FeatureSnapshot? {
        val now = System.currentTimeMillis()
        val windowEvents = events.toList()
        events.clear()
        val startedAt = windowStartMs
        windowStartMs = now
        burstCount = 0
        interruptionCount = 0
        inBurst = false

        if (windowEvents.isEmpty()) return null

        val n = windowEvents.size
        val durationSec = max((now - startedAt) / 1000.0, 1.0)
        val typingSpeed = n / durationSec

        val intervals = windowEvents.zipWithNext { a, b -> (b.timestampMs - a.timestampMs).toDouble() }
        val meanInterval = if (intervals.isNotEmpty()) intervals.average() else null

        val backspaceCount = windowEvents.count { it.isBackspace }
        val correctionCount = windowEvents.count { it.isCorrection }
        val backspaceRate = min(backspaceCount.toDouble() / n, 1.0)
        val correctionRate = min(correctionCount.toDouble() / n, 1.0)

        val pauses = intervals.count { it >= pauseThresholdMs }
        val pauseFrequency = pauses / (durationSec / 60.0) // pauses per minute

        return FeatureSnapshot(
            clientSnapshotId = UUID.randomUUID().toString(),
            windowStartIso = isoNow(startedAt),
            typingSpeedCps = typingSpeed,
            interKeyIntervalMs = meanInterval,
            backspaceRate = backspaceRate,
            correctionRate = correctionRate,
            pauseFrequency = pauseFrequency,
            typingBursts = burstCountSnapshot(windowEvents),
            typingInterruptions = interruptionCount,
            charCount = n, // a COUNT only — never the characters themselves
            sessionDuration = durationSec.toInt(),
        )
    }

    private fun burstCountSnapshot(windowEvents: List<KeyEvent>): Int {
        if (windowEvents.isEmpty()) return 0
        var bursts = 0
        var wasInBurst = false
        for (i in 1 until windowEvents.size) {
            val gap = windowEvents[i].timestampMs - windowEvents[i - 1].timestampMs
            if (gap <= burstGapMs) {
                if (!wasInBurst) { bursts++; wasInBurst = true }
            } else {
                wasInBurst = false
            }
        }
        return bursts
    }

    private fun isoNow(epochMs: Long): String =
        java.time.Instant.ofEpochMilli(epochMs).toString()
}

/** Behavioral-only snapshot — mirrors the backend's KeyboardSnapshot schema. No text content field exists. */
data class FeatureSnapshot(
    val clientSnapshotId: String,
    val windowStartIso: String,
    val typingSpeedCps: Double?,
    val interKeyIntervalMs: Double?,
    val backspaceRate: Double?,
    val correctionRate: Double?,
    val pauseFrequency: Double?,
    val typingBursts: Int?,
    val typingInterruptions: Int?,
    val charCount: Int?,
    val sessionDuration: Int,
)
