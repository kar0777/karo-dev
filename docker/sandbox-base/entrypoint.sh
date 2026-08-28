#!/bin/sh
# ==================================================================== #
#  karo/sandbox-base entrypoint
#
#  Deliberately minimal. This runs as PID 2 under tini inside a sandbox
#  that holds untrusted agent output, so it does exactly three things:
#  install signal traps, print a banner for interactive sessions, and
#  exec the requested command. It never parses, rewrites or evaluates
#  anything it is handed.
#
#  POSIX sh — /bin/sh is dash on Debian, so no bashisms.
# ==================================================================== #
set -eu

readonly KARO_WORKSPACE="${KARO_WORKSPACE:-/workspace}"

# ---------------------------------------------------------------- #
#  Signals
#
#  tini forwards SIGTERM/SIGINT here; these traps only cover the short
#  window before `exec` replaces this process, but without them a stop
#  during startup would leave the container to be SIGKILLed after the
#  10s grace period instead of exiting cleanly.
#  128 + signal number is the conventional shell exit status.
# ---------------------------------------------------------------- #
on_term() { exit 143; }
on_int() { exit 130; }
on_hup() { exit 129; }

trap on_term TERM
trap on_int INT
trap on_hup HUP

# ---------------------------------------------------------------- #
#  Banner
#
#  Only for interactive sessions. Agent tool calls run non-interactively
#  and their stdout is fed back to the model verbatim — printing a banner
#  there would waste tokens and, worse, put attacker-visible decoration
#  inside tool output. KARO_NO_BANNER=1 forces it off.
# ---------------------------------------------------------------- #
print_banner() {
    if [ "${KARO_NO_BANNER:-0}" = "1" ]; then
        return 0
    fi
    if [ ! -t 1 ]; then
        return 0
    fi

    cat <<'BANNER'

     /\
    /  \      K A R O
   / /\ \     sandbox
  /  \/  \
  \  /\  /    A real computer, held inside a boundary.
   \ \/ /     No network egress. No host access. Yours until it sleeps.
    \  /
     \/

BANNER

    printf '  workspace  %s\n' "${KARO_WORKSPACE}"
    printf '  user       %s (uid %s)\n' "$(id -un)" "$(id -u)"
    printf '  node       %s\n' "$(node --version 2>/dev/null || echo 'not installed')"
    printf '  python     %s\n' "$(python3 --version 2>/dev/null || echo 'not installed')"
    printf '  git        %s\n' "$(git --version 2>/dev/null || echo 'not installed')"
    printf '\n'
}

# ---------------------------------------------------------------- #
#  Main
# ---------------------------------------------------------------- #

# The workspace is a mounted volume; if the mount failed we want to fail
# loudly here rather than let the agent silently write into the image's
# ephemeral layer and lose the work on the next restart.
if [ ! -d "${KARO_WORKSPACE}" ]; then
    printf 'karo: workspace directory %s is missing — refusing to start.\n' \
        "${KARO_WORKSPACE}" >&2
    exit 1
fi

cd "${KARO_WORKSPACE}"

print_banner

# No arguments means the image CMD was overridden with nothing; fall back
# to an interactive shell so `docker exec`-style attaches still work.
if [ "$#" -eq 0 ]; then
    set -- bash
fi

exec "$@"
