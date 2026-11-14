package expo.modules.stresstwinkeyboard

import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager

/**
 * StressTwin's system keyboard: a full-featured keyboard (letters, numbers,
 * symbols, emoji, shift/caps-lock, automatic dark/light theming) built on
 * StressTwinKeyboardView, instrumented for behavioral timing statistics.
 *
 * Responsibility split (deliberate, for the privacy invariant):
 *   - StressTwinKeyboardView handles the visible UI and tells this class
 *     *what the user pressed* (a character, backspace, space, enter).
 *   - This class turns that into real text input via InputConnection —
 *     exactly what any keyboard app does — AND, completely separately,
 *     tells BehavioralFeatureCollector only whether the key was a
 *     backspace/correction, never what the key was.
 *   - BehavioralFeatureCollector only ever receives (isBackspace,
 *     isCorrection) flags — never a character, never emoji, never the
 *     content of what was typed. Nothing about the richer keyboard UI here
 *     changes that boundary; it only changes what gets displayed and what
 *     gets committed to the focused text field.
 */
class StressTwinInputMethodService : InputMethodService(), StressTwinKeyboardView.Listener {

    private lateinit var keyboardView: StressTwinKeyboardView
    private lateinit var collector: BehavioralFeatureCollector
    private lateinit var store: LocalSnapshotStore

    private val flushHandler = Handler(Looper.getMainLooper())
    private val flushIntervalMs = 15_000L
    private val flushRunnable = object : Runnable {
        override fun run() {
            collector.flush()?.let { store.insert(it) }
            flushHandler.postDelayed(this, flushIntervalMs)
        }
    }

    override fun onCreate() {
        super.onCreate()
        collector = BehavioralFeatureCollector()
        store = LocalSnapshotStore(this)
    }

    override fun onCreateInputView(): View {
        keyboardView = StressTwinKeyboardView(this)
        keyboardView.listener = this
        return keyboardView
    }

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        // Pick up a theme change (e.g. user toggled system dark mode) each
        // time the keyboard is shown, and reset to the letters layout for a
        // fresh input session.
        keyboardView.refreshTheme()
        keyboardView.setMode(StressTwinKeyboardView.Mode.LETTERS)

        flushHandler.removeCallbacks(flushRunnable)
        flushHandler.postDelayed(flushRunnable, flushIntervalMs)
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::keyboardView.isInitialized) keyboardView.refreshTheme()
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        super.onFinishInputView(finishingInput)
        // Flush whatever's left in the current window rather than losing it,
        // then stop the periodic timer until typing resumes.
        collector.flush()?.let { store.insert(it) }
        flushHandler.removeCallbacks(flushRunnable)
    }

    // ── StressTwinKeyboardView.Listener ────────────────────────────────────────
    override fun onChar(text: String) {
        currentInputConnection?.commitText(text, 1)
        // Behavioral timing only — never the character itself.
        collector.onKeyPress(isBackspace = false, isCorrection = false)
    }

    override fun onBackspace() {
        currentInputConnection?.deleteSurroundingText(1, 0)
        collector.onKeyPress(isBackspace = true, isCorrection = true)
    }

    override fun onBackspaceLongPressRepeat() {
        // Repeated deletes from a long-press are still just backspaces to
        // the collector — same privacy-preserving flags as a single tap.
        currentInputConnection?.deleteSurroundingText(1, 0)
        collector.onKeyPress(isBackspace = true, isCorrection = true)
    }

    override fun onSpace() {
        currentInputConnection?.commitText(" ", 1)
        collector.onKeyPress(isBackspace = false, isCorrection = false)
    }

    override fun onEnter() {
        val ic = currentInputConnection ?: return
        val action = currentInputEditorInfo?.imeOptions?.and(EditorInfo.IME_MASK_ACTION)
        if (action != null && action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
            ic.performEditorAction(action)
        } else {
            ic.sendKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_ENTER))
            ic.sendKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_ENTER))
        }
        collector.onKeyPress(isBackspace = false, isCorrection = false)
    }

    override fun onSwitchToNextKeyboard() {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showInputMethodPicker()
    }

    companion object {
        /** True if StressTwin Keyboard is enabled AND currently the selected IME. */
        fun isCurrentInputMethod(context: android.content.Context): Boolean {
            val current = android.provider.Settings.Secure.getString(
                context.contentResolver, android.provider.Settings.Secure.DEFAULT_INPUT_METHOD
            )
            return current?.startsWith(context.packageName) == true
        }

        fun isEnabled(context: android.content.Context): Boolean {
            val imm = context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)
                as InputMethodManager
            return imm.enabledInputMethodList.any { it.packageName == context.packageName }
        }
    }
}
