#!/usr/bin/env bash
# Runs a CI command and, if it fails, re-emits its errors as GitHub annotations.
# Job logs on GitHub need a signed-in account to read; annotations are public on the
# run page, so errors can be read (and fixed) without access to the account.
#
# Usage: scripts/ci-run.sh "<label>" <command> [args...]
set -uo pipefail

label="$1"
shift

log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}

if [ "$status" -ne 0 ]; then
  errors="$log.errors"
  grep -E "(error|fatal error):|✘|FAILED|failed with|Fatal|Testing failed" "$log" \
    | sed -E "s|${GITHUB_WORKSPACE:-$PWD}/||g" \
    | awk '!seen[$0]++' \
    | head -80 > "$errors" || true
  # Nothing recognisable: fall back to the end of the log.
  if [ ! -s "$errors" ]; then tail -40 "$log" > "$errors"; fi

  split -l 10 "$errors" "$log.chunk."
  n=0
  for chunk in "$log.chunk."*; do
    n=$((n + 1))
    [ "$n" -gt 9 ] && break
    message=$(sed -e 's/%/%25/g' -e 's/\r/%0D/g' "$chunk" | awk 'BEGIN { ORS = "%0A" } { print }')
    echo "::error title=${label} (${n})::${message}"
  done
fi

exit "$status"
