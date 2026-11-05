#!/usr/bin/env bash
# Academic OS demo: starts the fake Google with Jordan's school inbox and calendar on port 4900,
# and points the app at it. Run it before scripts/start.sh. Development only.
set -euo pipefail
cd "$(dirname "$0")/.."

env_file=openbot/.env
if ! grep -q '^OPENDUET_FAKE_GOOGLE_URL=' "$env_file" 2>/dev/null; then
  echo 'OPENDUET_FAKE_GOOGLE_URL=http://127.0.0.1:4900' >>"$env_file"
  echo "Pointed the app at the demo inbox."
fi

pkill -f 'fake-google/server.ts' 2>/dev/null || true
mkdir -p openbot/.logs
nohup bun openbot/scripts/fake-google/server.ts --port 4900 --persona student \
  >openbot/.logs/fake-google.log 2>&1 &
sleep 2
head -1 openbot/.logs/fake-google.log
echo "Reset the demo any time: curl -X POST http://127.0.0.1:4900/__fake/reset"
