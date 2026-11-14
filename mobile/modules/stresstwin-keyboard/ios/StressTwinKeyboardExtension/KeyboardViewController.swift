import UIKit

/// StressTwin's iOS keyboard extension: a full keyboard (letters, numbers,
/// symbols, emoji, shift/caps-lock) that automatically follows the system's
/// light/dark appearance, instrumented for behavioral timing statistics.
///
/// Respects iOS sandboxing throughout:
///  - Never calls `requestSupplementaryLexicon`, private APIs, or attempts to
///    read the host app's data outside the App Group container.
///  - Checks `textDocumentProxy.isSecureTextEntry` and, when true (password
///    fields), disables behavioral logging entirely for that field — iOS
///    already withholds most `UITextDocumentProxy` context in secure fields,
///    and StressTwin should not try to work around that.
///  - Does not request "Open Access" / Full Access for anything other than
///    what's declared to the user in the app (background sync convenience);
///    core behavioral logging works without it (see SharedSnapshotStore).
///  - Dark/light follows `traitCollection.userInterfaceStyle` — the same
///    signal any system view uses — rather than a custom in-keyboard toggle,
///    so it always matches whatever the rest of the phone is doing.
///
/// PRIVACY: exactly as before, `BehavioralFeatureCollector.recordKeyPress`
/// takes only a boolean (isBackspace) — every key added below (letters,
/// digits, symbols, emoji) funnels into the same one call with that same
/// signature. There is no new code path here that could carry a character
/// into the logging side.
///
/// LAYOUT NOTE: every key gets an explicit, absolute-point width/height
/// constraint (computed from the screen width, not from any sibling view).
/// This deliberately avoids the classic UIStackView bug where sizing a "wide"
/// key relative to "the row's first arranged subview" breaks the moment that
/// wide key *is* the first one added (shift, "123", "ABC" all are, in
/// different rows here) — that would produce a self-referential constraint
/// (a view's width defined as a multiple of its own width) and an
/// unsatisfiable/ambiguous layout. Fixed-point widths sidestep that class of
/// bug entirely, at the cost of not fluidly reflowing on rotation — an
/// acceptable trade for a keyboard extension, which is portrait-first.
final class KeyboardViewController: UIInputViewController {

    // MARK: - Layout / state

    enum LayoutMode { case letters, numbers, symbols, emoji }
    enum ShiftState { case off, once, locked }

    private let collector = BehavioralFeatureCollector()
    private var flushTimer: Timer?
    private var loggingSuspended = false

    private var mode: LayoutMode = .letters
    private var shift: ShiftState = .off
    private var lastShiftTapAt: TimeInterval = 0

    private var keyboardStack: UIStackView!
    private var backspaceRepeatTimer: Timer?

    // MARK: - Palette (light/dark)

    private struct Palette {
        let background: UIColor
        let keyBackground: UIColor
        let keyBackgroundPressed: UIColor
        let specialKeyBackground: UIColor
        let keyText: UIColor
    }

    private var isDark: Bool { traitCollection.userInterfaceStyle == .dark }

    private var palette: Palette {
        isDark
        ? Palette(
            background: UIColor(red: 0.12, green: 0.14, blue: 0.21, alpha: 1),
            keyBackground: UIColor(red: 0.16, green: 0.19, blue: 0.28, alpha: 1),
            keyBackgroundPressed: UIColor(red: 0.23, green: 0.25, blue: 0.38, alpha: 1),
            specialKeyBackground: UIColor(red: 0.09, green: 0.10, blue: 0.15, alpha: 1),
            keyText: UIColor(white: 0.93, alpha: 1)
          )
        : Palette(
            background: UIColor(red: 0.83, green: 0.85, blue: 0.88, alpha: 1),
            keyBackground: .white,
            keyBackgroundPressed: UIColor(red: 0.78, green: 0.80, blue: 0.84, alpha: 1),
            specialKeyBackground: UIColor(red: 0.68, green: 0.70, blue: 0.75, alpha: 1),
            keyText: UIColor(white: 0.10, alpha: 1)
          )
    }

    // MARK: - Sizing (fixed-point, screen-width-derived — see class note above)

    /// Width of one "unit" key (a single letter key). Rows are laid out on a
    /// 10-unit grid, matching the widest row (the top QWERTY row).
    private var keyUnitWidth: CGFloat {
        let screenWidth = UIScreen.main.bounds.width
        let interKeySpacing: CGFloat = 5
        let rowInsets: CGFloat = 8 // leading + trailing inset on the row stack
        let totalSpacing = interKeySpacing * 9 + rowInsets
        return max((screenWidth - totalSpacing) / 10.0, 24)
    }
    private let keyHeight: CGFloat = 52

    // MARK: - Key data

    private let lettersRows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]

    private let numbersRows: [[String]] = [
        ["1","2","3","4","5","6","7","8","9","0"],
        ["-","/",":",";","(",")","$","&","@","\""],
        ["#SYM#",".",",","?","!","'","#DEL#"]
    ]
    private let symbolsRows: [[String]] = [
        ["[","]","{","}","#","%","^","*","+","="],
        ["_","\\","|","~","<",">","€","£","¥","•"],
        ["#NUM#",".",",","?","!","'","#DEL#"]
    ]
    private let emojiList = [
        "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩",
        "😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨",
        "😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕",
        "🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","😟","🙁",
        "☹️","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣",
        "👍","👎","👏","🙌","🙏","💪","🤝","❤️","🔥","✨","🎉","👀","💯","✅","❌","⭐"
    ]

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        rebuildKeyboardUI()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        loggingSuspended = textDocumentProxy.isSecureTextEntry == true
        mode = .letters
        shift = .off
        rebuildKeyboardUI()
        startFlushTimer()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        flushAndStore()
        flushTimer?.invalidate()
        backspaceRepeatTimer?.invalidate()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        // System light/dark mode changed while the keyboard is open — rebuild
        // with the new palette so it never looks stale/mismatched.
        if traitCollection.userInterfaceStyle != previousTraitCollection?.userInterfaceStyle {
            rebuildKeyboardUI()
        }
    }

    override func textDidChange(_ textInput: UITextInput?) {
        // Re-check on every text change too — some hosts only set
        // isSecureTextEntry once focus/context is fully established.
        loggingSuspended = textDocumentProxy.isSecureTextEntry == true
    }

    private func startFlushTimer() {
        flushTimer?.invalidate()
        flushTimer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: true) { [weak self] _ in
            self?.flushAndStore()
        }
    }

    private func flushAndStore() {
        guard let snapshot = collector.flush() else { return }
        SharedSnapshotStore.append(snapshot)
    }

    // MARK: - UI construction

    private func rebuildKeyboardUI() {
        keyboardStack?.removeFromSuperview()

        let p = palette
        view.backgroundColor = p.background

        let stack = UIStackView()
        stack.axis = .vertical
        // .fill (not .fillEqually): every row/scroll view below carries its
        // own explicit height, so we want the stack to respect those exact
        // sizes rather than forcing them all equal — forcing equality is
        // what would squash the emoji grid's scroll view down to a single
        // row's height.
        stack.distribution = .fill
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 4),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -4),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6),
        ])
        keyboardStack = stack

        switch mode {
        case .letters: buildLetters()
        case .numbers: buildSymbolPage(numbersRows)
        case .symbols: buildSymbolPage(symbolsRows)
        case .emoji: buildEmoji()
        }
    }

    private func makeRow() -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        // .equalCentering: every key already has a fixed width (see
        // keyUnitWidth), so this just centers a row's keys as a group when
        // that row has fewer than 10 units (e.g. "asdfghjkl" = 9 keys)
        // instead of leaving a lopsided gap on one side.
        row.distribution = .equalCentering
        row.spacing = 5
        row.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
        keyboardStack.addArrangedSubview(row)
        return row
    }

    @discardableResult
    private func makeKey(_ title: String, isSpecial: Bool = false, fontSize: CGFloat = 24,
                          widthWeight: CGFloat = 1, in row: UIStackView,
                          action: @escaping () -> Void) -> UIButton {
        let p = palette
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: fontSize, weight: isSpecial ? .medium : .regular)
        button.setTitleColor(p.keyText, for: .normal)
        button.backgroundColor = isSpecial ? p.specialKeyBackground : p.keyBackground
        button.layer.cornerRadius = 6
        button.translatesAutoresizingMaskIntoConstraints = false
        button.widthAnchor.constraint(equalToConstant: keyUnitWidth * widthWeight).isActive = true
        button.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true

        row.addArrangedSubview(button)
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        button.addAction(UIAction { _ in button.backgroundColor = p.keyBackgroundPressed }, for: .touchDown)
        button.addAction(UIAction { _ in
            button.backgroundColor = isSpecial ? p.specialKeyBackground : p.keyBackground
        }, for: [.touchUpInside, .touchUpOutside, .touchCancel])

        return button
    }

    // MARK: - Letters layout

    private func buildLetters() {
        let isUpper = shift != .off

        for (i, rowLetters) in lettersRows.enumerated() {
            let row = makeRow()
            if i == 2 {
                makeKey(shiftLabel(), isSpecial: true, widthWeight: 1.5, in: row) { [weak self] in
                    self?.onShiftTapped()
                }
            }
            for ch in rowLetters {
                let display = isUpper ? ch.uppercased() : String(ch)
                makeKey(display, in: row) { [weak self] in self?.onLetterTyped(display) }
            }
            if i == 2 {
                let del = makeKey("⌫", isSpecial: true, widthWeight: 1.5, in: row) { [weak self] in
                    self?.commitBackspace()
                }
                attachBackspaceRepeat(del)
            }
        }

        let bottom = makeRow()
        makeKey("123", isSpecial: true, fontSize: 15, widthWeight: 1.3, in: bottom) { [weak self] in
            self?.mode = .numbers; self?.rebuildKeyboardUI()
        }
        makeKey("🌐", isSpecial: true, widthWeight: 1, in: bottom) { [weak self] in
            self?.advanceToNextInputMode()
        }
        makeKey("😊", isSpecial: true, widthWeight: 1, in: bottom) { [weak self] in
            self?.mode = .emoji; self?.rebuildKeyboardUI()
        }
        makeKey("space", isSpecial: true, fontSize: 14, widthWeight: 3.4, in: bottom) { [weak self] in
            self?.commitSpace()
        }
        makeKey("return", isSpecial: true, fontSize: 13, widthWeight: 1.6, in: bottom) { [weak self] in
            self?.commitReturn()
        }
    }

    private func shiftLabel() -> String {
        switch shift {
        case .off: return "⇧"
        case .once: return "⇧"
        case .locked: return "⇪"
        }
    }

    private func onShiftTapped() {
        let now = Date().timeIntervalSince1970
        if now - lastShiftTapAt < 0.35 {
            shift = .locked
        } else {
            shift = (shift == .off) ? .once : .off
        }
        lastShiftTapAt = now
        rebuildKeyboardUI()
    }

    private func onLetterTyped(_ display: String) {
        textDocumentProxy.insertText(display)
        if !loggingSuspended { collector.recordKeyPress(isBackspace: false) }
        if shift == .once {
            shift = .off
            rebuildKeyboardUI()
        }
    }

    // MARK: - Numbers / symbols layout

    private func buildSymbolPage(_ rows: [[String]]) {
        for rowKeys in rows {
            let row = makeRow()
            for key in rowKeys {
                switch key {
                case "#SYM#":
                    makeKey("#+=", isSpecial: true, fontSize: 14, widthWeight: 1.5, in: row) { [weak self] in
                        self?.mode = .symbols; self?.rebuildKeyboardUI()
                    }
                case "#NUM#":
                    makeKey("123", isSpecial: true, fontSize: 14, widthWeight: 1.5, in: row) { [weak self] in
                        self?.mode = .numbers; self?.rebuildKeyboardUI()
                    }
                case "#DEL#":
                    let del = makeKey("⌫", isSpecial: true, widthWeight: 1.5, in: row) { [weak self] in
                        self?.commitBackspace()
                    }
                    attachBackspaceRepeat(del)
                default:
                    makeKey(key, in: row) { [weak self] in self?.onLetterTyped(key) }
                }
            }
        }

        let bottom = makeRow()
        makeKey("ABC", isSpecial: true, fontSize: 15, widthWeight: 1.3, in: bottom) { [weak self] in
            self?.mode = .letters; self?.rebuildKeyboardUI()
        }
        makeKey("🌐", isSpecial: true, widthWeight: 1, in: bottom) { [weak self] in
            self?.advanceToNextInputMode()
        }
        makeKey("😊", isSpecial: true, widthWeight: 1, in: bottom) { [weak self] in
            self?.mode = .emoji; self?.rebuildKeyboardUI()
        }
        makeKey("space", isSpecial: true, fontSize: 14, widthWeight: 3.4, in: bottom) { [weak self] in
            self?.commitSpace()
        }
        makeKey("return", isSpecial: true, fontSize: 13, widthWeight: 1.6, in: bottom) { [weak self] in
            self?.commitReturn()
        }
    }

    // MARK: - Emoji layout

    private func buildEmoji() {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.heightAnchor.constraint(equalToConstant: 216).isActive = true
        keyboardStack.addArrangedSubview(scroll)

        let grid = UIStackView()
        grid.axis = .vertical
        grid.spacing = 4
        grid.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(grid)
        NSLayoutConstraint.activate([
            grid.topAnchor.constraint(equalTo: scroll.topAnchor),
            grid.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            grid.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            grid.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            grid.widthAnchor.constraint(equalTo: scroll.widthAnchor),
        ])

        let perRow = 8
        for chunkStart in stride(from: 0, to: emojiList.count, by: perRow) {
            let chunk = Array(emojiList[chunkStart..<min(chunkStart + perRow, emojiList.count)])
            let row = UIStackView()
            row.axis = .horizontal
            row.distribution = .fillEqually
            row.heightAnchor.constraint(equalToConstant: 48).isActive = true
            for emoji in chunk {
                let label = UIButton(type: .system)
                label.setTitle(emoji, for: .normal)
                label.titleLabel?.font = .systemFont(ofSize: 30)
                label.addAction(UIAction { [weak self] _ in self?.onEmojiTapped(emoji) }, for: .touchUpInside)
                row.addArrangedSubview(label)
            }
            // Pad short trailing rows with empty spacers so keys stay
            // the same size as a full row instead of stretching wider.
            for _ in chunk.count..<perRow {
                row.addArrangedSubview(UIView())
            }
            grid.addArrangedSubview(row)
        }

        let bottom = makeRow()
        makeKey("ABC", isSpecial: true, fontSize: 15, widthWeight: 1.5, in: bottom) { [weak self] in
            self?.mode = .letters; self?.rebuildKeyboardUI()
        }
        let del = makeKey("⌫", isSpecial: true, widthWeight: 1.5, in: bottom) { [weak self] in
            self?.commitBackspace()
        }
        attachBackspaceRepeat(del)
    }

    private func onEmojiTapped(_ emoji: String) {
        textDocumentProxy.insertText(emoji)
        // Behavioral timing only — emoji are content just like any other
        // character, so the same "never log what was typed" rule applies.
        if !loggingSuspended { collector.recordKeyPress(isBackspace: false) }
    }

    // MARK: - Shared commit actions

    private func commitSpace() {
        textDocumentProxy.insertText(" ")
        if !loggingSuspended { collector.recordKeyPress(isBackspace: false) }
    }

    private func commitReturn() {
        textDocumentProxy.insertText("\n")
        if !loggingSuspended { collector.recordKeyPress(isBackspace: false) }
    }

    private func commitBackspace() {
        textDocumentProxy.deleteBackward()
        if !loggingSuspended { collector.recordKeyPress(isBackspace: true) }
    }

    private func attachBackspaceRepeat(_ button: UIButton) {
        button.addAction(UIAction { [weak self] _ in
            self?.backspaceRepeatTimer?.invalidate()
            self?.backspaceRepeatTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { _ in
                self?.backspaceRepeatTimer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { _ in
                    self?.commitBackspace()
                }
            }
        }, for: .touchDown)
        let stop: (UIAction) -> Void = { [weak self] _ in
            self?.backspaceRepeatTimer?.invalidate()
            self?.backspaceRepeatTimer = nil
        }
        button.addAction(UIAction(handler: stop), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    }
}
