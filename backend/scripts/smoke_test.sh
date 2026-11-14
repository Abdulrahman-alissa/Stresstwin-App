#!/usr/bin/env bash
# Smoke-tests a running StressTwin backend: register → login → authenticated
# call → device registration. Useful right after standing up the backend
# (locally or on Render) to confirm Supabase migrations + env vars are wired
# correctly, before ever opening the mobile/desktop app.
#
# Usage:
#   bash smoke_test.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:8000
#
# Requires: curl, python3 (for JSON parsing — no jq dependency needed)

set -uo pipefail
BASE_URL="${1:-http://localhost:8000}"
EMAIL="smoketest+$(date +%s)@example.com"
PASSWORD="smoketest123"
FAIL=0

pass() { echo "  ✔ $1"; }
fail() { echo "  ✘ $1"; FAIL=1; }

json_get() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }

echo "StressTwin backend smoke test — $BASE_URL"
echo "=========================================="

echo "[1/5] Health check (GET /docs)"
if curl -s -m 5 -o /dev/null -w '' "$BASE_URL/docs"; then
  pass "backend is reachable"
else
  fail "backend did not respond at all — is uvicorn running? is the URL right?"
  echo "=========================================="
  exit 1
fi

echo "[2/5] Register a throwaway account ($EMAIL)"
register_resp=$(curl -s -m 10 -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"full_name\":\"Smoke Test\"}")
token=$(echo "$register_resp" | json_get access_token)
if [ -n "$token" ]; then
  pass "registration returned an access_token"
else
  fail "registration failed — response: $register_resp"
  echo "   Common causes: Supabase env vars missing/wrong in .env, or migrations 001/002 not run yet."
  echo "=========================================="
  exit 1
fi

echo "[3/5] Log in with the same credentials"
login_resp=$(curl -s -m 10 -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
login_token=$(echo "$login_resp" | json_get access_token)
if [ -n "$login_token" ]; then
  pass "login returned an access_token"
else
  fail "login failed — response: $login_resp"
fi

echo "[4/5] Call an authenticated endpoint (GET /api/devices)"
devices_resp=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE_URL/api/devices" \
  -H "Authorization: Bearer $token")
if [ "$devices_resp" = "200" ]; then
  pass "authenticated request succeeded (200)"
else
  fail "expected HTTP 200, got $devices_resp — check the bearer-token auth wiring"
fi

echo "[5/5] Register a device (POST /api/devices/register)"
device_resp=$(curl -s -m 10 -X POST "$BASE_URL/api/devices/register" \
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
  -d '{"device_id":"smoke-test-device","platform":"desktop","display_name":"Smoke Test Runner"}')
device_status=$(echo "$device_resp" | json_get status)
if [ -n "$device_status" ]; then
  pass "device registered, dashboard status: $device_status"
else
  fail "device registration failed — response: $device_resp"
  echo "   Common cause: migration 002 (devices table) not run yet."
fi

echo "=========================================="
if [ "$FAIL" -eq 0 ]; then
  echo "All checks passed. Backend + database are wired correctly."
  echo "Test account created: $EMAIL / $PASSWORD (harmless to leave, or delete it from Supabase)."
else
  echo "One or more checks failed — see ✘ lines above."
fi
exit $FAIL
