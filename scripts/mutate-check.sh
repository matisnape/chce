#!/usr/bin/env bash
# Prove a test can fail: replace <old> with <new> in <file>, run the suite, expect red, restore.
# Restores from a copy, never from git, so uncommitted work in <file> survives.
# Usage: scripts/mutate-check.sh <file> <old> <new> [test command, default "npm test"]
set -uo pipefail
FILE="$1"; OLD="$2"; NEW="$3"; TEST_CMD="${4:-npm test}"
BAK="$(mktemp)"; cp "$FILE" "$BAK"
trap 'cp "$BAK" "$FILE"; rm -f "$BAK"' EXIT
python3 - "$FILE" "$OLD" "$NEW" <<'PY'
import sys; p, old, new = sys.argv[1:]; s = open(p).read()
if old not in s: sys.exit(f"mutate-check: '{old}' not found in {p}")
open(p, "w").write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 2
LOG="$(mktemp)"
sh -c "$TEST_CMD" >"$LOG" 2>&1; status=$?
summary="$(grep -E '[0-9]+ (passed|failed)|^ℹ (pass|fail) ' "$LOG" | xargs)"
rm -f "$LOG"
if [ $status -ne 0 ]; then echo "KILLED: suite failed with the mutant ($summary)"; exit 0; fi
echo "SURVIVED: suite stayed green with the mutant ($summary)"; exit 1
