#!/usr/bin/env bash
# One command for the Academic OS demo: Postgres, API, and the app.
# A school pack in data/private/ is used when it is there. Otherwise Jordan's sample week is.
set -euo pipefail
cd "$(dirname "$0")/.." || exit
# shellcheck source=env.sh
. scripts/env.sh

if [ "${ACADEMIC_OS_PLATFORM_CHECK:-}" = "1" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "postgres:brew-or-pg_ctl"
    echo "databases:current-user"
    echo "browser:open"
  else
    echo "postgres:pg_ctlcluster"
    echo "databases:sudo-postgres"
    echo "browser:no"
  fi
  exit 0
fi

APP_PORT="${APP_PORT:-3010}"
SERVER_PORT="${SERVER_PORT:-3001}"
mkdir -p openbot/.logs

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is not installed. Run: bash scripts/cloud-install.sh" >&2
  exit 1
fi

postgres_ready() {
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1
}

wait_for_postgres() {
  local _
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    postgres_ready && return 0
    sleep 0.5
  done
  echo "Postgres did not accept connections on 127.0.0.1:5432." >&2
  exit 1
}

# Homebrew postgresql@16, as the current user. No sudo. brew services when it
# can start the server, otherwise pg_ctl on the formula's data directory.
start_postgres_macos() {
  local prefix datadir
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required. Run: bash scripts/cloud-install.sh" >&2
    exit 1
  fi
  prefix="$(brew --prefix postgresql@16 2>/dev/null || true)"
  if [ -z "$prefix" ] || [ ! -x "$prefix/bin/pg_isready" ]; then
    echo "Postgres is not installed. Run: bash scripts/cloud-install.sh" >&2
    exit 1
  fi
  export PATH="$prefix/bin:$PATH"
  if postgres_ready; then
    return 0
  fi
  datadir="$(brew --prefix)/var/postgresql@16"
  if [ ! -s "$datadir/PG_VERSION" ]; then
    mkdir -p "$datadir"
    initdb -D "$datadir" --username="$(id -un)" --auth=trust --encoding=UTF8 --locale=C
  fi
  if brew services start postgresql@16 >/dev/null 2>&1; then
    echo brew >openbot/.logs/postgres.owner
    wait_for_postgres
    return 0
  fi
  pg_ctl -D "$datadir" -l openbot/.logs/postgres.log start
  echo pg_ctl >openbot/.logs/postgres.owner
  wait_for_postgres
}

ensure_databases_macos() {
  local db
  if ! psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='openbot'" | grep -q 1; then
    psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE USER openbot WITH PASSWORD 'openbot' SUPERUSER LOGIN;"
  fi
  for db in openbot openbot_test; do
    if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
      psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${db} OWNER openbot;"
    fi
    psql -d "$db" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
  done
}

start_postgres() {
  if [ "$(uname -s)" = "Darwin" ]; then
    start_postgres_macos
    return 0
  fi
  if postgres_ready; then
    return 0
  fi
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    sudo pg_ctlcluster 16 main start
  else
    echo "Postgres is not running, and pg_ctlcluster is not installed." >&2
    exit 1
  fi
  wait_for_postgres
}

ensure_databases() {
  if [ "$(uname -s)" = "Darwin" ]; then
    ensure_databases_macos
    return 0
  fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_roles WHERE rolname='openbot'" \
    | grep -q 1 || sudo -u postgres psql -c "CREATE USER openbot WITH PASSWORD 'openbot' SUPERUSER;"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='openbot'" \
    | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE openbot OWNER openbot;"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='openbot_test'" \
    | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE openbot_test OWNER openbot;"
  sudo -u postgres psql -d openbot -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
  sudo -u postgres psql -d openbot_test -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
}

ensure_env() {
  if [ ! -e openbot/.env ]; then
    cp .env.example openbot/.env
  fi
  link_env
  python3 - <<'PY'
import os
import secrets
from pathlib import Path
path = Path("openbot/.env")
text = path.read_text()
lines = text.splitlines()
values = {}
order = []
for line in lines:
    if line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key not in values:
        order.append(key)
    values[key] = value

def empty(key):
    return values.get(key, "").strip() == ""

updates = {}
key = values.get("INTELLIGENCE_API_KEY", "").strip()
placeholder = key in ("", "local-demo-not-a-real-key")
cloud = "intelligence.copilotkit.ai" in values.get("INTELLIGENCE_API_URL", "") or "intelligence.copilotkit.ai" in values.get("INTELLIGENCE_GATEWAY_WS_URL", "")
if placeholder or key.startswith("local-") or cloud and placeholder:
    if placeholder:
        updates["INTELLIGENCE_API_KEY"] = "local-" + secrets.token_hex(16)
    if placeholder or cloud or empty("INTELLIGENCE_API_URL"):
        updates["INTELLIGENCE_API_URL"] = "http://127.0.0.1:7091"
    if placeholder or cloud or empty("INTELLIGENCE_GATEWAY_WS_URL"):
        updates["INTELLIGENCE_GATEWAY_WS_URL"] = "ws://127.0.0.1:7091"
else:
    if empty("INTELLIGENCE_API_URL"):
        updates["INTELLIGENCE_API_URL"] = "https://api.intelligence.copilotkit.ai"
    if empty("INTELLIGENCE_GATEWAY_WS_URL"):
        updates["INTELLIGENCE_GATEWAY_WS_URL"] = "wss://realtime.intelligence.copilotkit.ai"
openai = os.environ.get("OPENAI_API_KEY", "").strip()
if openai and empty("OPENAI_API_KEY"):
    updates["OPENAI_API_KEY"] = openai
# The example points at a Bot computer this demo does not start.
if values.get("AGENT_COMPUTER_URL", "").strip() == "http://localhost:4100":
    updates["AGENT_COMPUTER_URL"] = ""

pack = any(
    Path(p).is_file()
    for p in (
        "data/private/classes.json",
        "data/private/academic-os-data/classes.json",
        "data/private/school-pack/classes.json",
    )
)
if pack and empty("ACADEMIC_OS_PRIVATE_DEMO"):
    updates["ACADEMIC_OS_PRIVATE_DEMO"] = "1"
# The student's name is whatever the operator set. The script does not invent one.
named = os.environ.get("ACADEMIC_OS_STUDENT_NAME", "").strip()
if named and empty("ACADEMIC_OS_STUDENT_NAME"):
    updates["ACADEMIC_OS_STUDENT_NAME"] = named
if empty("DO_NOT_TRACK"):
    updates["DO_NOT_TRACK"] = "1"

if not updates:
    raise SystemExit
out = []
seen = set()
for line in lines:
    if "=" in line and not line.startswith("#"):
        key = line.split("=", 1)[0]
        if key in updates and key not in seen:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
            continue
    out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY
}

listening() {
  curl -fsS --max-time 2 "http://127.0.0.1:$1$2" >/dev/null 2>&1
}

env_stamp() {
  python3 - <<'PY'
from pathlib import Path
vals = {}
for line in Path("openbot/.env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    vals[key] = value.strip()
openai = "yes" if vals.get("OPENAI_API_KEY") else "no"
kind = "local" if vals.get("INTELLIGENCE_API_KEY", "").startswith("local-") else "other"
print("|".join([
    vals.get("INTELLIGENCE_API_URL", ""),
    vals.get("INTELLIGENCE_GATEWAY_WS_URL", ""),
    kind,
    vals.get("ACADEMIC_OS_STUDENT_NAME", ""),
    openai,
]))
PY
}

start_intelligence() {
  if ! grep -q '^INTELLIGENCE_API_KEY=local-' openbot/.env; then
    return 0
  fi
  if curl -fsS --max-time 2 http://127.0.0.1:7091/health >/dev/null 2>&1; then
    return 0
  fi
  nohup bash -c "cd openbot/server && LOCAL_INTELLIGENCE_STORE='$(pwd)/data/private/local-threads.json' exec bun --env-file=../.env scripts/local-intelligence.ts" \
    >openbot/.logs/intelligence.log 2>&1 &
  echo $! >openbot/.logs/intelligence.pid
  for _ in $(seq 1 30); do
    curl -fsS --max-time 1 http://127.0.0.1:7091/health >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "Local intelligence did not start. See openbot/.logs/intelligence.log" >&2
  tail -n 40 openbot/.logs/intelligence.log >&2 || true
  exit 1
}

start_postgres
ensure_databases
ensure_env
start_intelligence

STAMP="$(env_stamp)"
OLD=""
if [ -f openbot/.logs/env-stamp ]; then
  OLD="$(cat openbot/.logs/env-stamp)"
fi
if [ "$STAMP" != "$OLD" ] && [ -f openbot/.logs/server.pid ]; then
  kill "$(cat openbot/.logs/server.pid)" 2>/dev/null || true
  for _ in $(seq 1 20); do
    listening "$SERVER_PORT" "/api/me" || break
    sleep 0.2
  done
fi
printf '%s\n' "$STAMP" >openbot/.logs/env-stamp

if ! (cd openbot/server && bun --env-file=../.env scripts/migrate.ts); then
  echo "Migrations failed." >&2
  exit 1
fi
# The test suite refuses to use the app database. Same schema, separate database.
if ! (cd openbot/server && DATABASE_URL='postgres://openbot:openbot@127.0.0.1:5432/openbot_test' bun --env-file=../.env scripts/migrate.ts); then
  echo "Test database migrations failed." >&2
  exit 1
fi

if ! listening "$SERVER_PORT" "/api/me"; then
  nohup bash -c 'cd openbot/server && exec bun --env-file=../.env src/production-entry.ts' \
    >openbot/.logs/server.log 2>&1 &
  echo $! >openbot/.logs/server.pid
fi
if ! listening "$APP_PORT" "/"; then
  nohup bash -c "cd openbot/app && bun run dev --port $APP_PORT --strictPort --host 127.0.0.1" \
    >openbot/.logs/app.log 2>&1 &
  echo "$!" >openbot/.logs/app.pid
fi

for _ in $(seq 1 90); do
  listening "$SERVER_PORT" "/api/me" && listening "$APP_PORT" "/" && break
  sleep 1
done
if ! listening "$SERVER_PORT" "/api/me"; then
  echo "The API did not answer. See openbot/.logs/server.log" >&2
  tail -n 40 openbot/.logs/server.log >&2 || true
  exit 1
fi

curl -fsS -X POST "http://127.0.0.1:$SERVER_PORT/api/me/onboarding" \
  -H 'content-type: application/json' \
  --data '{"completed":true}' >/dev/null || true

if [ ! -f openbot/.logs/demo-seeded ]; then
  if grep -q '^ACADEMIC_OS_PRIVATE_DEMO=1' openbot/.env; then
    (cd openbot/server && bun --env-file=../.env scripts/seed-study-demo.ts --pack --reset)
  else
    (cd openbot/server && bun --env-file=../.env scripts/seed-study-demo.ts --reset)
  fi
  touch openbot/.logs/demo-seeded
fi

echo "Academic OS is at http://127.0.0.1:$APP_PORT"
if [ "$(uname -s)" = "Darwin" ]; then
  open "http://127.0.0.1:$APP_PORT" >/dev/null 2>&1 || true
fi
if grep -q '^ACADEMIC_OS_PRIVATE_DEMO=1' openbot/.env; then
  echo "School pack: on. Spring 2026 rows are not deadlines."
else
  echo "School pack: not found. Using the generic demo student."
fi
if grep -q '^INTELLIGENCE_API_KEY=local-' openbot/.env; then
  echo "Threads: local. No CopilotKit Intelligence key is required."
fi
if ! grep -q '^OPENAI_API_KEY=.\+' openbot/.env; then
  echo "OPENAI_API_KEY is not in openbot/.env, so chat and study guides stay on the notes."
fi

if [ "${ACADEMIC_OS_DEV_EXIT:-}" = "1" ]; then
  exit 0
fi
tail -f openbot/.logs/server.log openbot/.logs/app.log
