package expo.modules.stresstwinkeyboard

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class StressTwinKeyboardModule : Module() {

    private val store by lazy { LocalSnapshotStore(appContext.reactContext ?: throw IllegalStateException("No context")) }

    override fun definition() = ModuleDefinition {
        Name("StressTwinKeyboard")

        AsyncFunction("getStatus") { promise: Promise ->
            val ctx = appContext.reactContext ?: return@AsyncFunction promise.resolve(
                mapOf("installed" to false, "isActive" to false)
            )
            promise.resolve(
                mapOf(
                    "installed" to StressTwinInputMethodService.isEnabled(ctx),
                    "isActive" to StressTwinInputMethodService.isCurrentInputMethod(ctx),
                )
            )
        }

        AsyncFunction("openSystemKeyboardSettings") { promise: Promise ->
            val ctx = appContext.reactContext
            if (ctx == null) {
                promise.reject("NO_CONTEXT", "No React context available", null)
                return@AsyncFunction
            }
            val intent = Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            promise.resolve(null)
        }

        AsyncFunction("drainSnapshots") { promise: Promise ->
            val snapshots = store.drainAll().map {
                mapOf(
                    "client_snapshot_id" to it.clientSnapshotId,
                    "window_start" to it.windowStartIso,
                    "typing_speed_cps" to it.typingSpeedCps,
                    "inter_key_interval_ms" to it.interKeyIntervalMs,
                    "backspace_rate" to it.backspaceRate,
                    "correction_rate" to it.correctionRate,
                    "pause_frequency" to it.pauseFrequency,
                    "typing_bursts" to it.typingBursts,
                    "typing_interruptions" to it.typingInterruptions,
                    "char_count" to it.charCount,
                    "session_duration" to it.sessionDuration,
                )
            }
            promise.resolve(snapshots)
        }
    }
}
