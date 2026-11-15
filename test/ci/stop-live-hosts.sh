#!/usr/bin/env bash
#
# Stops the test sshd instances started by setup-live-hosts.sh.
#
# Usage:
#   sudo bash test/ci/stop-live-hosts.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "stop-live-hosts.sh must run as root (use sudo)." >&2
  exit 1
fi

for pidfile in /run/ssh2shell/sshd_*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
done

echo "Live test hosts stopped."
