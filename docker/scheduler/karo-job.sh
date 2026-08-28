#!/bin/sh
# ==================================================================== #
#  karo/scheduler — one maintenance call, one log line
#
#  Usage: karo-job <label> <path>
#
#  The request shape matches what each route documents: POST, no body,
#  `Authorization: Bearer $CRON_SECRET`. All three handlers are
#  idempotent, so a retry on the next tick is always preferable to
#  retrying in a loop here — a failing endpoint under retry pressure is
#  how a small outage becomes a large one.
#
#  POSIX sh — /bin/sh is busybox ash on Alpine, so no bashisms.
# ==================================================================== #
set -u

# shellcheck source=/dev/null
. /tmp/karo-scheduler.env

label=${1:?usage: karo-job <label> <path>}
path=${2:?usage: karo-job <label> <path>}

body=$(mktemp)
err=$(mktemp)
# shellcheck disable=SC2064  # expanded now on purpose: these paths are fixed
trap "rm -f '$body' '$err'" EXIT

# `--write-out` puts the status code on stdout, so a transport-level
# failure — which prints nothing at all — needs a sentinel of its own.
code=$(
  curl --silent --show-error \
    --request POST \
    --max-time "$KARO_JOB_TIMEOUT" \
    --header "Authorization: Bearer $CRON_SECRET" \
    --output "$body" \
    --write-out '%{http_code}' \
    "$KARO_INTERNAL_URL$path" 2>"$err"
) || code=000

now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Truncated and flattened to keep one job to one line. These responses
# carry team and sandbox ids, counts and timestamps — no credentials.
summary=$(head -c 400 "$body" | tr -d '\n\r')

case "$code" in
  2??)
    printf '%s scheduler %s ok status=%s %s\n' "$now" "$label" "$code" "$summary"
    ;;
  401 | 403)
    printf '%s scheduler %s REJECTED status=%s — CRON_SECRET does not match the app. %s\n' \
      "$now" "$label" "$code" "$summary" >&2
    exit 1
    ;;
  000)
    printf '%s scheduler %s UNREACHABLE %s\n' \
      "$now" "$label" "$(head -c 200 "$err" | tr -d '\n\r')" >&2
    exit 1
    ;;
  *)
    printf '%s scheduler %s FAILED status=%s %s\n' "$now" "$label" "$code" "$summary" >&2
    exit 1
    ;;
esac
