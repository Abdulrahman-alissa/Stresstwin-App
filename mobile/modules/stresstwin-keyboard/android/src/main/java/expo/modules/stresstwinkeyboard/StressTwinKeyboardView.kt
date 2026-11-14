package expo.modules.stresstwinkeyboard

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View

import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * StressTwin's full on-screen keyboard UI: letters, numbers/symbols (two
 * pages, matching the standard iOS/Android convention), and an emoji panel,
 * with shift / caps-lock and automatic dark/light theming.
 *
 * This is a plain programmatic view (not the legacy Keyboard/KeyboardView
 * XML system) so every layout, the theme, and the emoji grid can share one
 * consistent codebase and be swapped instantly without re-inflating XML.
 *
 * PRIVACY: this view only ever reports *which control was pressed* to its
 * listener (a character, backspace, space, enter). It has no notion of
 * "behavioral logging" at all — that stays entirely in
 * BehavioralFeatureCollector, which the IME service feeds with only
 * (isBackspace, isCorrection) flags. Nothing here changes that boundary.
 */
class StressTwinKeyboardView(context: Context) : LinearLayout(context) {

    enum class Mode { LETTERS, SYMBOLS_1, SYMBOLS_2, EMOJI }
    enum class ShiftState { OFF, ONCE, LOCKED }

    interface Listener {
        fun onChar(text: String)
        fun onBackspace()
        fun onBackspaceLongPressRepeat()
        fun onSpace()
        fun onEnter()
        fun onSwitchToNextKeyboard()
    }

    var listener: Listener? = null

    private val KEY_HEIGHT_DP = 54

    private var mode = Mode.LETTERS
    private var shift = ShiftState.OFF
    private var lastShiftTapAt = 0L

    private val handler = Handler(Looper.getMainLooper())
    private var backspaceRepeatRunnable: Runnable? = null

    // ── Theme ────────────────────────────────────────────────────────────────
    private data class Palette(
        val background: Int, val keyBg: Int, val keyBgPressed: Int,
        val specialKeyBg: Int, val keyText: Int, val accent: Int,
    )

    private val darkPalette = Palette(
        background = Color.parseColor("#1E2335"),
        keyBg = Color.parseColor("#2A3047"),
        keyBgPressed = Color.parseColor("#3B4160"),
        specialKeyBg = Color.parseColor("#171B27"),
        keyText = Color.parseColor("#E8ECF4"),
        accent = Color.parseColor("#5C7CFA"),
    )
    private val lightPalette = Palette(
        background = Color.parseColor("#D3D8E0"),
        keyBg = Color.parseColor("#FFFFFF"),
        keyBgPressed = Color.parseColor("#C7CCD6"),
        specialKeyBg = Color.parseColor("#AEB4C0"),
        keyText = Color.parseColor("#1B1F2A"),
        accent = Color.parseColor("#3B5BDB"),
    )

    private fun isNightMode(): Boolean {
        val flags = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return flags == Configuration.UI_MODE_NIGHT_YES
    }

    private fun palette() = if (isNightMode()) darkPalette else lightPalette

    // ── Key layouts ──────────────────────────────────────────────────────────
    private val lettersRows = listOf(
        "qwertyuiop", "asdfghjkl", "zxcvbnm"
    )
    private val symbols1Rows = listOf(
        listOf("1","2","3","4","5","6","7","8","9","0"),
        listOf("-","/",":",";","(",")","$","&","@","\""),
        listOf("#SHIFT#",".",",","?","!","'","#DEL#")
    )
    private val symbols2Rows = listOf(
        listOf("[","]","{","}","#","%","^","*","+","="),
        listOf("_","\\","|","~","<",">","€","£","¥","•"),
        listOf("#SHIFT#",".",",","?","!","'","#DEL#")
    )
    private val emojiList = listOf(
        "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩",
        "😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨",
        "😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕",
        "🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","😟","🙁",
        "☹️","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣",
        "👍","👎","👏","🙌","🙏","💪","🤝","❤️","🔥","✨","🎉","👀","💯","✅","❌","⭐"
    )

    // ── Special key markers used inside symbol row lists ───────────────────
    private val SHIFT_MARK = "#SHIFT#"
    private val DEL_MARK = "#DEL#"

    init {
        orientation = VERTICAL
        setPadding(dp(4), dp(8), dp(4), dp(10))
        rebuild()
    }

    /** Call when the system theme (light/dark) may have changed. */
    fun refreshTheme() = rebuild()

    fun setMode(newMode: Mode) {
        mode = newMode
        rebuild()
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun rebuild() {
        removeAllViews()
        setBackgroundColor(palette().background)
        when (mode) {
            Mode.LETTERS -> buildLetters()
            Mode.SYMBOLS_1 -> buildSymbols(symbols1Rows)
            Mode.SYMBOLS_2 -> buildSymbols(symbols2Rows)
            Mode.EMOJI -> buildEmoji()
        }
    }

    // ── Row helpers ──────────────────────────────────────────────────────────
    private fun newRow(): LinearLayout {
        val row = LinearLayout(context)
        row.orientation = HORIZONTAL
        row.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(6)
        }
        addView(row)
        return row
    }

    private fun makeKey(
        label: String, weight: Float = 1f, isSpecial: Boolean = false,
        textSize: Float = 24f, onClick: () -> Unit,
    ): Button {
        val p = palette()
        val btn = Button(context)
        btn.text = label
        btn.isAllCaps = false
        btn.setTextColor(p.keyText)
        btn.textSize = textSize
        // Default Button styles add ~8-16dp side padding plus a minimum width/height.
        // With 10 weighted keys per row on a phone that padding swallows the whole key
        // and the label (letters, emoji) disappears. Strip it so labels always show.
        btn.setPadding(0, 0, 0, 0)
        btn.minWidth = 0; btn.minimumWidth = 0
        btn.minHeight = 0; btn.minimumHeight = 0
        btn.includeFontPadding = false
        btn.gravity = Gravity.CENTER
        btn.maxLines = 1
        btn.stateListAnimator = null
        btn.elevation = 0f

        val normalBg = GradientDrawable().apply {
            setColor(if (isSpecial) p.specialKeyBg else p.keyBg)
            cornerRadius = dp(6).toFloat()
        }
        val pressedBg = GradientDrawable().apply {
            setColor(p.keyBgPressed)
            cornerRadius = dp(6).toFloat()
        }
        val states = android.graphics.drawable.StateListDrawable()
        states.addState(intArrayOf(android.R.attr.state_pressed), pressedBg)
        states.addState(intArrayOf(), normalBg)
        btn.background = states

        btn.layoutParams = LayoutParams(0, dp(KEY_HEIGHT_DP), weight).apply {
            marginStart = dp(2); marginEnd = dp(2)
        }
        btn.setOnClickListener { onClick() }
        return btn
    }

    // ── Letters layout ───────────────────────────────────────────────────────
    private fun buildLetters() {
        val isUpper = shift != ShiftState.OFF

        lettersRows.forEachIndexed { i, letters ->
            val row = newRow()
            if (i == 2) {
                row.addView(makeKey(shiftLabel(), weight = 1.5f, isSpecial = true, onClick = { onShiftTapped() }))
            }
            for (ch in letters) {
                val display = if (isUpper) ch.uppercaseChar().toString() else ch.toString()
                row.addView(makeKey(display, onClick = { onLetterTyped(display) }))
            }
            if (i == 2) {
                row.addView(makeKey("⌫", weight = 1.5f, isSpecial = true, onClick = { listener?.onBackspace() }).also {
                    attachBackspaceRepeat(it)
                })
            }
        }

        val bottom = newRow()
        bottom.addView(makeKey("123", weight = 1.3f, isSpecial = true, textSize = 17f, onClick = { setMode(Mode.SYMBOLS_1) }))
        bottom.addView(makeKey("😊", weight = 1f, isSpecial = true, onClick = { setMode(Mode.EMOJI) }))
        bottom.addView(makeKey("🌐", weight = 1f, isSpecial = true, onClick = { listener?.onSwitchToNextKeyboard() }))
        bottom.addView(makeKey("space", weight = 4f, isSpecial = true, textSize = 16f, onClick = { onSpaceTyped() }))
        bottom.addView(makeKey("⏎", weight = 1.3f, isSpecial = true, onClick = { listener?.onEnter() }))
    }

    private fun shiftLabel() = when (shift) {
        ShiftState.OFF -> "⇧"
        ShiftState.ONCE -> "⇧"
        ShiftState.LOCKED -> "⇪"
    }

    private fun onShiftTapped() {
        val now = System.currentTimeMillis()
        shift = when {
            now - lastShiftTapAt < 350 -> ShiftState.LOCKED
            shift == ShiftState.OFF -> ShiftState.ONCE
            else -> ShiftState.OFF
        }
        lastShiftTapAt = now
        rebuild()
    }

    private fun onLetterTyped(display: String) {
        listener?.onChar(display)
        if (shift == ShiftState.ONCE) {
            shift = ShiftState.OFF
            rebuild()
        }
    }

    private fun onSpaceTyped() = listener?.onSpace()

    // ── Symbols layout (two pages) ───────────────────────────────────────────
    private fun buildSymbols(rows: List<List<String>>) {
        rows.forEach { row ->
            val r = newRow()
            row.forEach { key ->
                when (key) {
                    SHIFT_MARK -> r.addView(
                        makeKey(if (mode == Mode.SYMBOLS_1) "#+=" else "123", weight = 1.5f, isSpecial = true, textSize = 16f,
                            onClick = { setMode(if (mode == Mode.SYMBOLS_1) Mode.SYMBOLS_2 else Mode.SYMBOLS_1) })
                    )
                    DEL_MARK -> r.addView(
                        makeKey("⌫", weight = 1.5f, isSpecial = true, onClick = { listener?.onBackspace() }).also {
                            attachBackspaceRepeat(it)
                        }
                    )
                    else -> r.addView(makeKey(key, onClick = { listener?.onChar(key) }))
                }
            }
        }
        val bottom = newRow()
        bottom.addView(makeKey("ABC", weight = 1.3f, isSpecial = true, textSize = 17f, onClick = { setMode(Mode.LETTERS) }))
        bottom.addView(makeKey("😊", weight = 1f, isSpecial = true, onClick = { setMode(Mode.EMOJI) }))
        bottom.addView(makeKey("🌐", weight = 1f, isSpecial = true, onClick = { listener?.onSwitchToNextKeyboard() }))
        bottom.addView(makeKey("space", weight = 4f, isSpecial = true, textSize = 16f, onClick = { onSpaceTyped() }))
        bottom.addView(makeKey("⏎", weight = 1.3f, isSpecial = true, onClick = { listener?.onEnter() }))
    }

    // ── Emoji layout ─────────────────────────────────────────────────────────
    private fun buildEmoji() {
        val scroll = ScrollView(context)
        scroll.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, dp(216))
        val grid = LinearLayout(context)
        grid.orientation = VERTICAL
        scroll.addView(grid)
        addView(scroll)

        val perRow = 8
        emojiList.chunked(perRow).forEach { chunk ->
            val row = LinearLayout(context)
            row.orientation = HORIZONTAL
            row.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            chunk.forEach { emoji ->
                val tv = TextView(context)
                tv.text = emoji
                tv.textSize = 28f
                tv.gravity = Gravity.CENTER
                tv.layoutParams = LinearLayout.LayoutParams(0, dp(52), 1f)
                tv.setOnClickListener { listener?.onChar(emoji) }
                row.addView(tv)
            }
            // pad the last row so short rows don't stretch oddly
            repeat(perRow - chunk.size) {
                row.addView(View(context).apply { layoutParams = LinearLayout.LayoutParams(0, dp(52), 1f) })
            }
            grid.addView(row)
        }

        val bottom = newRow()
        bottom.addView(makeKey("ABC", weight = 1.5f, isSpecial = true, textSize = 17f, onClick = { setMode(Mode.LETTERS) }))
        bottom.addView(makeKey("⌫", weight = 1.5f, isSpecial = true, onClick = { listener?.onBackspace() }).also {
            attachBackspaceRepeat(it)
        })
    }

    // ── Backspace long-press repeat ──────────────────────────────────────────
    private fun attachBackspaceRepeat(button: Button) {
        button.setOnLongClickListener {
            val runnable = object : Runnable {
                override fun run() {
                    listener?.onBackspaceLongPressRepeat()
                    handler.postDelayed(this, 60)
                }
            }
            backspaceRepeatRunnable = runnable
            handler.postDelayed(runnable, 300)
            true
        }
        button.setOnTouchListener { _, event ->
            if (event.action == android.view.MotionEvent.ACTION_UP || event.action == android.view.MotionEvent.ACTION_CANCEL) {
                backspaceRepeatRunnable?.let { handler.removeCallbacks(it) }
                backspaceRepeatRunnable = null
            }
            false // let the click/long-click listeners still fire
        }
    }
}
