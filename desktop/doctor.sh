#!/usr/bin/env bash
# StressTwin desktop — environment doctor. Run before `npm run dev`.
set -uo pipefail
PASS="\033[32m✔\033[0m"; FAIL="\033[31m✘\033[0m"; WARN="\033[33m!\033[0m"
ok=0
check() {
  local label="$1"; local status="$2"; local detail="$3"
  if [ "$status" = "ok" ]; then echo -e " $PASS $label — $detail";
  elif [ "$status" = "warn" ]; then echo -e " $WARN $label — $detail";
  else echo -e " $FAIL $label — $detail"; ok=1; fi
}

echo "StressTwin desktop — environment check"
echo "========================================"
OS="$(uname -s)"

if command -v node >/dev/null 2>&1; then
  v=$(node -v); major=$(echo "$v" | sed 's/v//' | cut -d. -f1)
  if [ "$major" -ge 18 ]; then check "Node.js" ok "$v"; else check "Node.js" fail "$v found, need 18+"; fi
else
  check "Node.js" fail "not found — install from nodejs.org"
fi

command -v npm >/dev/null 2>&1 && check "npm" ok "$(npm -v)" || check "npm" fail "not found"

# uiohook-napi needs native build tools if no prebuilt binary matches your
# platform/arch/Node ABI. Xcode Command Line Tools cover this on macOS.
if [ "$OS" = "Darwin" ]; then
  if xcode-select -p >/dev/null 2>&1; then
    check "Xcode Command Line Tools" ok "installed (needed if uiohook-napi has to build from source)"
  else
    check "Xcode Command Line Tools" warn "not found — run 'xcode-select --install' if dependency install fails on uiohook-napi"
  fi
fi

if [ -d node_modules ]; then
  check "node_modules" ok "installed"
  uiohook_err=$(node -e "require('uiohook-napi')" 2>&1)
  if [ -z "$uiohook_err" ]; then
    check "uiohook-napi (global keystroke/mouse sensing)" ok "loads and initializes correctly"
  elif echo "$uiohook_err" | grep -qi "display"; then
    check "uiohook-napi (global keystroke/mouse sensing)" warn "module loads fine, but needs an active GUI session/display to fully initialize — normal to see this from a headless shell; irrelevant once you run the actual app on your desktop"
  else
    check "uiohook-napi (global keystroke/mouse sensing)" warn "failed to load ($uiohook_err) — app still runs, but falls back to SIMULATED behavioral data (see electron/ipc.js). Usually means no prebuilt binary matches your OS/arch/Node version — try 'npm rebuild uiohook-napi'."
  fi
else
  check "node_modules" fail "missing — run: npm install"
fi

if [ -f .env ]; then
  check ".env" ok "found"
else
  check ".env" warn "not created yet — copy .env.example to .env"
fi

if [ "$OS" = "Darwin" ]; then
  echo ""
  echo "macOS-specific:"
  echo "  Global keystroke/mouse sensing requires Accessibility permission."
  echo "  You'll be prompted the first time you run the app; if you dismissed"
  echo "  it, grant it manually: System Settings -> Privacy & Security ->"
  echo "  Accessibility -> enable StressTwin (or your terminal, during 'npm run dev')."
fi

echo "========================================"
if [ "$ok" -eq 0 ]; then echo "Looks good — run: npm run dev"; else echo "Fix the ✘ items above, then re-run this script."; fi
