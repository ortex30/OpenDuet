#!/usr/bin/env bash
# One command for the Academic OS demo: Postgres, API, and the app.
# A school pack in data/private/ is used when it is there. Otherwise Jordan's sample week is.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/env.sh

APP_PORT="${APP_PORT:-3010}"
SERVER_PORT="${SERVER_PORT:-3001}"
mkdir -p openbot/.logs

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is not installed. Run: bash scripts/cloud-install.sh" >&2
  exit 1
fi

start_postgres() {
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    return 0
  fi
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    sudo pg_ctlcluster 16 main start
  else
    echo "Postgres is not running, and pg_ctlcluster is not installed." >&2
    exit 1
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  echo "Postgres did not accept connections on 127.0.0.1:5432." >&2
  exit 1
}

ensure_databases() {
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
if empty("INTELLIGENCE_API_KEY"):
    updates["INTELLIGENCE_API_KEY"] = "local-demo-not-a-real-key"
if empty("INTELLIGENCE_API_URL"):
    updates["INTELLIGENCE_API_URL"] = "https://api.intelligence.copilotkit.ai"
if empty("INTELLIGENCE_GATEWAY_WS_URL"):
    updates["INTELLIGENCE_GATEWAY_WS_URL"] = "wss://realtime.intelligence.copilotkit.ai"
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

start_postgres
ensure_databases
ensure_env

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
fi
if ! listening "$APP_PORT" "/"; then
  nohup bash -c "cd openbot/app && bun run dev --port $APP_PORT --strictPort --host 127.0.0.1" \
    >openbot/.logs/app.log 2>&1 &
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
if grep -q '^ACADEMIC_OS_PRIVATE_DEMO=1' openbot/.env; then
  echo "School pack: on. Spring 2026 rows are not deadlines."
else
  echo "School pack: not found. Using the generic demo student."
fi
if grep -q '^INTELLIGENCE_API_KEY=local-demo-not-a-real-key' openbot/.env || ! grep -q '^OPENAI_API_KEY=.\+' openbot/.env; then
  echo "Live chat needs a real INTELLIGENCE_API_KEY and OPENAI_API_KEY in openbot/.env, then a restart."
fi

if [ "${ACADEMIC_OS_DEV_EXIT:-}" = "1" ]; then
  exit 0
fi
tail -f openbot/.logs/server.log openbot/.logs/app.log
