#!/usr/bin/env bash
# Checks the Mac and Linux branches without installing Postgres.
# A fake uname picks the branch. A dry install records brew and must not call sudo.
set -euo pipefail
cd "$(dirname "$0")/.." || exit

fail() {
  echo "platform test failed: $*" >&2
  exit 1
}

run_check() {
  local name script expect
  name="$1"
  script="$2"
  expect="$3"
  out="$(FAKE_UNAME="$name" PATH="$FAKE:$PATH" ACADEMIC_OS_PLATFORM_CHECK=1 bash "$script")"
  printf '%s' "$out" | grep -qx "$expect" || fail "$script with uname $name printed: $out"
}

tmp="$(mktemp -d)"
FAKE="$tmp/bin"
mkdir -p "$FAKE"
cat >"$FAKE/uname" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-s" ]; then
  printf '%s\n' "$FAKE_UNAME"
  exit 0
fi
exec /usr/bin/uname "$@"
EOF
chmod +x "$FAKE/uname"

linux_dev="$(FAKE_UNAME=Linux PATH="$FAKE:$PATH" ACADEMIC_OS_PLATFORM_CHECK=1 bash scripts/academic-os-dev.sh)"
printf '%s\n' "$linux_dev" | grep -qx "postgres:pg_ctlcluster" || fail "linux postgres plan"
printf '%s\n' "$linux_dev" | grep -qx "databases:sudo-postgres" || fail "linux database plan"
printf '%s\n' "$linux_dev" | grep -qx "browser:no" || fail "linux should not open a browser"

mac_dev="$(FAKE_UNAME=Darwin PATH="$FAKE:$PATH" ACADEMIC_OS_PLATFORM_CHECK=1 bash scripts/academic-os-dev.sh)"
printf '%s\n' "$mac_dev" | grep -qx "postgres:brew-or-pg_ctl" || fail "mac postgres plan"
printf '%s\n' "$mac_dev" | grep -qx "databases:current-user" || fail "mac database plan"
printf '%s\n' "$mac_dev" | grep -qx "browser:open" || fail "mac should open a browser"

linux_install="$(FAKE_UNAME=Linux PATH="$FAKE:$PATH" ACADEMIC_OS_PLATFORM_CHECK=1 bash scripts/cloud-install.sh)"
[ "$linux_install" = "install:apt" ] || fail "linux install plan: $linux_install"
mac_install="$(FAKE_UNAME=Darwin PATH="$FAKE:$PATH" ACADEMIC_OS_PLATFORM_CHECK=1 bash scripts/cloud-install.sh)"
[ "$mac_install" = "install:brew" ] || fail "mac install plan: $mac_install"

# The Mac helpers must not reach for sudo, apt, or Docker.
mac_fns="$(awk '
  /^start_postgres_macos\(\)/ { keep=1 }
  /^ensure_databases_macos\(\)/ { keep=1 }
  /^install_postgres_macos\(\)/ { keep=1 }
  /^[a-zA-Z_][a-zA-Z0-9_]*\(\)/ && $0 !~ /^(start_postgres_macos|ensure_databases_macos|install_postgres_macos)\(\)/ { if (keep && seen) keep=0 }
  { if (keep) { print; seen=1 } }
' scripts/academic-os-dev.sh scripts/cloud-install.sh)"
printf '%s\n' "$mac_fns" | grep -E 'sudo|apt-get|docker|pg_ctlcluster' && fail "mac helper uses a Linux-only command"
printf '%s\n' "$mac_fns" | grep -q 'brew services start' || fail "mac start does not try brew services"
printf '%s\n' "$mac_fns" | grep -q 'pg_ctl' || fail "mac start has no pg_ctl fallback"
printf '%s\n' "$mac_fns" | grep -q 'postgresql@16' || fail "mac install is not postgresql@16"

log="$tmp/commands"
: >"$log"
cat >"$FAKE/brew" <<EOF
#!/bin/sh
printf '%s\n' "brew \$*" >>"$log"
if [ "\$1" = "list" ]; then
  exit 1
fi
if [ "\$1" = "--prefix" ]; then
  printf '%s\n' "$tmp/pg"
  exit 0
fi
exit 0
EOF
cat >"$FAKE/bun" <<EOF
#!/bin/sh
printf '%s\n' "bun \$*" >>"$log"
exit 0
EOF
cat >"$FAKE/git" <<EOF
#!/bin/sh
printf '%s\n' "git \$*" >>"$log"
mkdir -p "\$4"
exit 0
EOF
cat >"$FAKE/make" <<EOF
#!/bin/sh
printf '%s\n' "make \$*" >>"$log"
exit 0
EOF
cat >"$FAKE/sudo" <<EOF
#!/bin/sh
printf '%s\n' "sudo \$*" >>"$log"
exit 1
EOF
chmod +x "$FAKE/brew" "$FAKE/bun" "$FAKE/git" "$FAKE/make" "$FAKE/sudo"
mkdir -p "$tmp/pg/bin"
cat >"$tmp/pg/bin/pg_config" <<EOF
#!/bin/sh
if [ "\$1" = "--sharedir" ]; then
  printf '%s\n' "$tmp/pg/share"
fi
exit 0
EOF
chmod +x "$tmp/pg/bin/pg_config"

FAKE_UNAME=Darwin PATH="$FAKE:$PATH" ACADEMIC_OS_INSTALL_DRY=1 bash scripts/cloud-install.sh >/dev/null
grep -q 'brew install postgresql@16' "$log" || fail "dry install did not install postgresql@16"
grep -q 'git clone' "$log" || fail "dry install did not fetch pgvector"
grep -q 'would:bun-install' <(FAKE_UNAME=Darwin PATH="$FAKE:$PATH" ACADEMIC_OS_INSTALL_DRY=1 bash scripts/cloud-install.sh) || fail "dry install skipped bun"
if grep -q '^sudo ' "$log"; then
  fail "dry mac install called sudo"
fi

echo "academic os platform branches ok"
rm -rf "$tmp"
