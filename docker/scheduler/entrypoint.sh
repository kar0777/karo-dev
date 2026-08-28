#!/bin/sh
# ==================================================================== #
#  karo/scheduler entrypoint
#
#  Validates configuration, waits for the app, then hands over to crond.
#
#  Fails fast rather than starting a scheduler that cannot authenticate:
#  without CRON_SECRET every request falls through to the admin-session
#  path in `authorizeCronOrAdmin` and comes back 401. A container that
#  looks healthy while every job it runs is rejected is worse than one
#  that refuses to start.
#
#  POSIX sh — /bin/sh is busybox ash on Alpine, so no bashisms.
# ==================================================================== #
set -eu

: "${KARO_INTERNAL_URL:=http://app:3000}"
: "${KARO_JOB_TIMEOUT:=120}"
: "${KARO_STARTUP_WAIT:=60}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "scheduler: CRON_SECRET is unset — the app rejects every job with 401." >&2
  echo "scheduler: generate one with 'openssl rand -base64 32' and set it for" >&2
  echo "scheduler: both this service and the app, then start again." >&2
  exit 1
fi

# ---------------------------------------------------------------- #
#  Job configuration
#
#  Jobs run as short-lived children of crond, which does not reliably
#  pass its own environment through. Handing the values over in a file
#  keeps that independent of busybox's behaviour. Mode 0600 on a tmpfs,
#  so the secret is no more exposed than it already is in
#  /proc/self/environ.
# ---------------------------------------------------------------- #
umask 077
{
  printf 'CRON_SECRET=%s\n' "$CRON_SECRET"
  printf 'KARO_INTERNAL_URL=%s\n' "$KARO_INTERNAL_URL"
  printf 'KARO_JOB_TIMEOUT=%s\n' "$KARO_JOB_TIMEOUT"
} >/tmp/karo-scheduler.env

echo "scheduler: target $KARO_INTERNAL_URL, timeout ${KARO_JOB_TIMEOUT}s, TZ ${TZ:-UTC}"

# ---------------------------------------------------------------- #
#  Startup wait
#
#  Compose already gates start on the app being healthy, but a plain
#  `docker run` does not, and the first job may be minutes away anyway.
#  Waiting turns a confusing "connection refused" into one clear line.
# ---------------------------------------------------------------- #
waited=0
while [ "$waited" -lt "$KARO_STARTUP_WAIT" ]; do
  if curl --silent --fail --max-time 5 --output /dev/null "$KARO_INTERNAL_URL/api/health"; then
    echo "scheduler: app reachable after ${waited}s"
    break
  fi
  waited=$((waited + 5))
  sleep 5
done

if [ "$waited" -ge "$KARO_STARTUP_WAIT" ]; then
  echo "scheduler: app unreachable after ${KARO_STARTUP_WAIT}s — starting anyway," >&2
  echo "scheduler: individual jobs will report their own failures." >&2
fi

# -f              foreground, so tini stays PID 1 and signals work
# -l 8            log everything crond itself has to say
# -L /dev/stderr  crond's log to the container stream, not syslog
# -c              crontab directory; the file there is named after this user
exec crond -f -l 8 -L /dev/stderr -c /etc/crontabs
