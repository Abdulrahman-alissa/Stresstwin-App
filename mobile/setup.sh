#!/usr/bin/env bash
# One-shot setup for StressTwin mobile. Safe to re-run any time.
#   bash setup.sh            → Android-ready (npm install + .env + prebuild)
#   bash setup.sh ios        → also runs `pod install` (macOS only)
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/4  Installing npm dependencies (this can take a minute) =="
npm install --legacy-peer-deps

echo "== 2/4  Setting up .env =="
if [ -f .env ]; then
  echo "   .env already exists — leaving it alone."
else
  cp .env.example .env
  echo "   Created .env from template. EDIT IT NOW and set your LAN IP:"
  echo "   $(pwd)/.env"
fi

echo "== 3/4  Generating native android/ project =="
if [ -f android/gradlew ]; then
  echo "   android/ already exists — skipping prebuild (delete the folder and re-run to regenerate)."
else
  npx expo prebuild --platform android --no-install
fi

if [ "${1:-}" = "ios" ]; then
  echo "== 3b/4  Generating native ios/ project =="
  if [ -f ios/Podfile ]; then
    echo "   ios/ already exists — skipping prebuild."
  else
    npx expo prebuild --platform ios --no-install
  fi
  if command -v pod >/dev/null 2>&1; then
    echo "   Running pod install..."
    (cd ios && pod install)
  else
    echo "   CocoaPods not found — install it (sudo gem install cocoapods) then run: cd ios && pod install"
  fi
fi

echo "== 4/4  Environment check =="
bash doctor.sh

echo
echo "Next steps:"
echo "  - Make sure .env has your computer's real LAN IP, not localhost"
echo "  - Android: open the android/ folder in Android Studio, or run: npx expo run:android"
echo "    (details: ANDROID_STUDIO_SETUP.md)"
if [ "${1:-}" = "ios" ]; then
  echo "  - iOS: open ios/StressTwin.xcworkspace in Xcode (details: XCODE_SETUP.md)"
fi
