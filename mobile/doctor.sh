#!/usr/bin/env bash
# StressTwin mobile — environment doctor.
# Run this before opening the project in Android Studio: `bash doctor.sh`
# It only checks your machine; it does not modify anything.

set -uo pipefail
PASS="\033[32m✔\033[0m"
FAIL="\033[31m✘\033[0m"
WARN="\033[33m!\033[0m"
ok=0

check() {
  local label="$1"; local status="$2"; local detail="$3"
  if [ "$status" = "ok" ]; then echo -e " $PASS $label — $detail";
  elif [ "$status" = "warn" ]; then echo -e " $WARN $label — $detail";
  else echo -e " $FAIL $label — $detail"; ok=1; fi
}

echo "StressTwin mobile — environment check"
echo "======================================"

# Node
if command -v node >/dev/null 2>&1; then
  v=$(node -v)
  major=$(echo "$v" | sed 's/v//' | cut -d. -f1)
  if [ "$major" -ge 18 ]; then check "Node.js" ok "$v"; else check "Node.js" fail "$v found, need 18+"; fi
else
  check "Node.js" fail "not found — install from nodejs.org"
fi

# npm
if command -v npm >/dev/null 2>&1; then check "npm" ok "$(npm -v)"; else check "npm" fail "not found"; fi

# Java
if command -v java >/dev/null 2>&1; then
  jv=$(java -version 2>&1 | head -1)
  echo "$jv" | grep -qE '"(17|21)\.' && check "Java" ok "$jv" || check "Java" warn "$jv (Gradle wants 17; Android Studio's bundled JDK is safest — see below)"
else
  check "Java" warn "no system 'java' found — fine if you let Android Studio use its own bundled JDK"
fi

# ANDROID_HOME / local.properties
if [ -n "${ANDROID_HOME:-}" ] && [ -d "${ANDROID_HOME:-/nonexistent}" ]; then
  check "ANDROID_HOME" ok "$ANDROID_HOME"
elif [ -f "android/local.properties" ]; then
  check "local.properties" ok "found (android/local.properties)"
else
  check "Android SDK location" warn "neither \$ANDROID_HOME nor android/local.properties found yet — Android Studio will create this on first sync, or copy android/local.properties.example"
fi

# adb + connected devices
if command -v adb >/dev/null 2>&1; then
  check "adb" ok "$(adb --version | head -1)"
  n=$(adb devices | tail -n +2 | grep -c "device$" || true)
  if [ "$n" -ge 1 ]; then check "Device/emulator" ok "$n connected"; else check "Device/emulator" warn "none detected — plug in a phone (USB debugging on) or start an emulator"; fi
else
  check "adb" warn "not on PATH yet — normal before your first Android Studio SDK install"
fi

# node_modules present
if [ -d "node_modules" ]; then check "node_modules" ok "installed"; else check "node_modules" fail "missing — run: npm install --legacy-peer-deps"; fi

# local keyboard module linked correctly
if [ -L "node_modules/stresstwin-keyboard" ] || [ -d "node_modules/stresstwin-keyboard" ]; then
  check "stresstwin-keyboard module" ok "linked"
else
  check "stresstwin-keyboard module" fail "not linked — run: npm install --legacy-peer-deps"
fi

# android/ generated
if [ -f "android/gradlew" ]; then check "Native android/ project" ok "present"; else check "Native android/ project" warn "not generated — fine if you're only doing iOS right now; otherwise: npx expo prebuild --platform android"; fi
if [ -f "ios/Podfile" ]; then check "Native ios/ project" ok "present"; else check "Native ios/ project" warn "not generated — fine if you're only doing Android right now; otherwise: npx expo prebuild --platform ios"; fi
if [ ! -f "android/gradlew" ] && [ ! -f "ios/Podfile" ]; then
  check "Native project" fail "neither android/ nor ios/ exists — run 'bash setup.sh' or 'npx expo prebuild'"
fi

# .env present
if [ -f ".env" ]; then
  check ".env" ok "found"
  api_url=$(grep -E '^EXPO_PUBLIC_API_BASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '[:space:]')
  if [ -n "$api_url" ]; then
    if [[ "$api_url" == *"localhost"* || "$api_url" == *"127.0.0.1"* ]]; then
      check "Backend URL" warn "$api_url — 'localhost' means the phone/emulator itself, not your computer. Use your LAN IP (or 10.0.2.2 for the Android Emulator only). See .env.example."
    else
      if command -v curl >/dev/null 2>&1; then
        if curl -s -m 3 -o /dev/null -w '' "$api_url/docs" 2>/dev/null; then
          check "Backend reachable" ok "$api_url responded"
        else
          check "Backend reachable" warn "$api_url did not respond from this machine — make sure uvicorn is running with --host 0.0.0.0, and that your firewall allows it"
        fi
      else
        check "Backend reachable" warn "curl not available to test $api_url — check it manually"
      fi
    fi
  else
    check "Backend URL" warn "EXPO_PUBLIC_API_BASE_URL not set in .env"
  fi
else
  check ".env" warn "not created yet — copy .env.example to .env and set your backend's LAN IP"
fi

echo "======================================"
if [ "$ok" -eq 0 ]; then
  msg="Looks good."
  [ -f "android/gradlew" ] && msg="$msg Android: open the android/ folder in Android Studio, or run: npx expo run:android."
  [ -f "ios/Podfile" ] && msg="$msg iOS: open ios/StressTwin.xcworkspace in Xcode (after 'cd ios && pod install'), or run: npx expo run:ios."
  echo "$msg"
else
  echo "Fix the ✘ items above, then re-run this script."
fi
