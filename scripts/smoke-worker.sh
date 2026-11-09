#!/usr/bin/env bash
# Smoke the deployed Worker: no token -> 401, CORS preflight only for allowed origins.
# Usage: scripts/smoke-worker.sh [worker-url]
set -uo pipefail
URL="${1:-https://chce.anks14.workers.dev}/extract"
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$3', got '$2'"; fail=1; fi; }

check "POST without token is 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"url":"https://example.com"}' "$URL")" 401
check "preflight from anks.pl allows that origin" \
  "$(curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://anks.pl' -H 'Access-Control-Request-Method: POST' "$URL" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')" "https://anks.pl"
check "preflight from evil.example has no allow header" \
  "$(curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' "$URL" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')" ""
exit $fail
