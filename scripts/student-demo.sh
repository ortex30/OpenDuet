#!/usr/bin/env bash
# Academic OS demo: starts the fake Google with Jordan's school inbox and calendar on port 4900,
# and points the app at it. Run it before scripts/start.sh. Development only: the app ignores the
# fake when NODE_ENV=production.
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
cat <<'STEPS'

Once the app is running (bash scripts/start.sh), connect the demo inbox once:
  1. /admin/plugins/google-workspace: turn it on, type anything as the client ID and secret,
     and press Refresh tools.
  2. /connections/google-workspace: press Connect.
  3. /admin/plugins/google-workspace/bots/openduet: give Academic OS gmail_search_messages,
     gmail_read_message and calendar_list_events.

The demo's due dates are worked out from today each time the fake starts.
Start the inbox over: curl -X POST http://127.0.0.1:4900/__fake/reset
That resets only the fake mail and calendar. Remove a practice plan with Remove from calendar on
its card.
STEPS
