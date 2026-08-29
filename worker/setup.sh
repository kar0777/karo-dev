#!/bin/sh
# Karo one-command server enrolment.
#
# What it does, in order:
#   1. checks that Node.js 18+ is available;
#   2. downloads the agent into ~/.karo/bin/karo-worker.mjs;
#   3. exchanges the one-time install token for a worker token
#      (--register-only), so no secret remains in any command line;
#   4. installs a service that keeps the agent running and brings it back
#      after a reboot:
#        · Linux  — a systemd *user* unit (no root), falling back to
#                   nohup + a @reboot crontab entry without systemd;
#        · macOS  — a LaunchAgent with KeepAlive.
#
# Re-running it is safe: it refreshes the agent, re-registers with the token
# you pass and restarts the service.
#
# Usage:
#   curl -fsSL <karo-url>/api/worker/setup | sh -s -- --token <install-token>
#          [--url <karo-url>] [--name <label>]

set -eu

KARO_APP_URL='__KARO_APP_URL__'
KARO_DIR="$HOME/.karo"
AGENT="$KARO_DIR/bin/karo-worker.mjs"
LOG_DIR="$KARO_DIR/log"
SERVICE_NAME='karo-worker'

say()  { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

TOKEN=''
URL=''
NAME=''
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:?--token needs a value}"; shift 2 ;;
    --url)   URL="${2:?--url needs a value}"; shift 2 ;;
    --name)  NAME="${2:?--name needs a value}"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[ -n "$TOKEN" ] || die 'Missing --token. Copy the install command from Karo → Settings → Servers.'
URL="${URL:-$KARO_APP_URL}"
[ -n "$URL" ] || die 'Missing --url. Pass the address of your Karo install.'
say "Karo setup — $URL"

# 1. Node
command -v node >/dev/null 2>&1 ||
  die 'Node.js was not found. Install Node 18 or newer (https://nodejs.org), then run this command again.'
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$NODE_MAJOR" -ge 18 ] ||
  die "Node.js 18+ is required, found major version $NODE_MAJOR. Upgrade Node, then run this command again."

# 2. Agent
mkdir -p "$KARO_DIR/bin" "$LOG_DIR"
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die 'Neither curl nor wget was found — one of them is needed to download the agent.'
  fi
}
say 'Downloading the worker agent…'
fetch "$URL/api/worker/install" "$AGENT"

# 3. Register — a one-shot exchange, not the service's own run. The service
#    always starts without token arguments: a consumed install token left in a
#    service definition would turn every restart into a registration loop.
say 'Registering this machine with Karo…'
registration_failed() {
  die 'Registration failed. The install token is single-use and expires after one hour — press Rotate token on Karo → Settings → Servers and run the command it shows.'
}
if [ -n "$NAME" ]; then
  node "$AGENT" --register-only --token "$TOKEN" --url "$URL" --name "$NAME" || registration_failed
else
  node "$AGENT" --register-only --token "$TOKEN" --url "$URL" || registration_failed
fi

# Kill any agent started some other way (a previous nohup run, an old setup) —
# two agents polling with the same token would race for commands.
stop_stray_agent() {
  command -v pkill >/dev/null 2>&1 || return 0
  pkill -f 'karo-worker\.mjs' 2>/dev/null || true
  sleep 1
}

OS=$(uname -s)

if [ "$OS" = 'Linux' ] && command -v systemctl >/dev/null 2>&1 && systemctl --user >/dev/null 2>&1; then
  # 4a. systemd user unit — survives terminal close and reboots, no root.
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  UNIT="$UNIT_DIR/$SERVICE_NAME.service"
  mkdir -p "$UNIT_DIR"
  stop_stray_agent
  cat > "$UNIT" <<UNIT
[Unit]
Description=Karo worker agent ($URL)
After=network-online.target

[Service]
ExecStart=/usr/bin/env node $AGENT
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --quiet "$SERVICE_NAME"
  systemctl --user restart "$SERVICE_NAME"
  # Linger keeps the user manager — and with it the agent — alive after the
  # last session closes and across reboots. Some setups ask for interactive
  # authorisation when you grant it to yourself, so failing here is not fatal:
  # the agent still runs, it just starts with the first login after a reboot.
  if loginctl enable-linger "$(id -un)" >/dev/null 2>&1; then
    say 'Boot persistence: enabled (lingering user manager).'
  else
    warn 'Could not enable linger — the agent runs now and will start with your first login after a reboot.'
  fi
  say "Installed as a systemd user service. Follow the logs:  journalctl --user -u $SERVICE_NAME -f"
  say "Stop it with:  systemctl --user stop $SERVICE_NAME"
elif [ "$OS" = 'Darwin' ]; then
  # 4b. macOS LaunchAgent.
  PLIST_DIR="$HOME/Library/LaunchAgents"
  PLIST="$PLIST_DIR/dev.karo.worker.plist"
  mkdir -p "$PLIST_DIR" "$LOG_DIR"
  launchctl bootout "gui/$(id -u)/dev.karo.worker" >/dev/null 2>&1 || true
  stop_stray_agent
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.karo.worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>$AGENT</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/worker.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/worker.log</string>
</dict>
</plist>
PLIST
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then
    :
  else
    launchctl load -w "$PLIST" >/dev/null 2>&1 ||
      warn 'launchctl could not load the agent — start it manually with: node ~/.karo/bin/karo-worker.mjs'
  fi
  say 'Installed as a macOS LaunchAgent. Logs: ~/.karo/log/worker.log'
  say "Stop it with:  launchctl bootout gui/$(id -u)/dev.karo.worker"
else
  # 4c. No systemd (containers, WSL without systemd, minimal images): nohup
  #     for this boot, cron for the next one.
  say 'systemd not available — starting in the background and adding a @reboot cron entry.'
  stop_stray_agent
  BG="$KARO_DIR/bin/start-worker-background.sh"
  cat > "$BG" <<BG
#!/bin/sh
nohup node "$AGENT" >> "$LOG_DIR/worker.log" 2>&1 &
BG
  chmod +x "$BG"
  "$BG"
  if command -v crontab >/dev/null 2>&1; then
    # Replace any previous entry rather than accumulating them.
    if { crontab -l 2>/dev/null | grep -v 'start-worker-background\.sh' || true
         echo "@reboot $BG"; } | crontab - 2>/dev/null; then
      say 'Boot persistence: @reboot cron entry installed.'
    else
      warn 'Could not update the crontab — the agent runs now but will not come back after a reboot by itself.'
    fi
  else
    warn 'No crontab on this machine — the agent runs now but will not come back after a reboot by itself.'
  fi
  say "Agent started in the background. Logs: $LOG_DIR/worker.log"
  say 'Stop it with:  pkill -f karo-worker.mjs'
fi

say ''
say 'Done. The server appears in Karo → Settings → Servers within a few seconds.'
