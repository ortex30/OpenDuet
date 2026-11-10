#!/usr/bin/env bash
# Stop the Academic OS demo: the app, the API, and local intelligence.
# On a Mac, also stop Postgres when this demo started it.
set -euo pipefail
cd "$(dirname "$0")/.." || exit

stop_pid() {
  local file pid
  file="$1"
  if [ ! -f "$file" ]; then
    return 0
  fi
  pid="$(cat "$file")"
  if [ -n "$pid" ]; then
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

stop_pid openbot/.logs/app.pid
stop_pid openbot/.logs/server.pid
stop_pid openbot/.logs/intelligence.pid

if [ "$(uname -s)" = "Darwin" ] && [ -f openbot/.logs/postgres.owner ]; then
  owner="$(cat openbot/.logs/postgres.owner)"
  if [ "$owner" = "brew" ]; then
    brew services stop postgresql@16 >/dev/null 2>&1 || true
  else
    prefix="$(brew --prefix postgresql@16 2>/dev/null || true)"
    if [ -n "$prefix" ] && [ -x "$prefix/bin/pg_ctl" ]; then
      "$prefix/bin/pg_ctl" -D "$(brew --prefix)/var/postgresql@16" stop || true
    fi
  fi
  rm -f openbot/.logs/postgres.owner
fi

echo "Academic OS has stopped."
