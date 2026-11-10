#!/usr/bin/env bash
# Dependencies for a Cloud Agent checkout, or a Mac with Homebrew.
# Safe to run twice. Does not start servers.
set -euo pipefail
cd "$(dirname "$0")/.." || exit

if [ "${ACADEMIC_OS_PLATFORM_CHECK:-}" = "1" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "install:brew"
  else
    echo "install:apt"
  fi
  exit 0
fi

install_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi
  curl -fsSL https://bun.sh/install | bash
  if [ "$(uname -s)" = "Darwin" ]; then
    # The installer puts bun on ~/.bun/bin. A Mac install does not use sudo.
    return 0
  fi
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
}

install_postgres_linux() {
  if command -v psql >/dev/null 2>&1; then
    return 0
  fi
  if ! sudo apt-get update -qq; then
    sudo sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu/|https://mirrors.edge.kernel.org/ubuntu/|g' \
      -e 's|http://security.ubuntu.com/ubuntu/|https://mirrors.edge.kernel.org/ubuntu/|g' \
      /etc/apt/sources.list.d/ubuntu.sources
    sudo apt-get update -qq
  fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    postgresql postgresql-contrib postgresql-16-pgvector
}

# postgresql@16 only, plus pgvector built into that prefix. No second Postgres and no sudo.
install_postgres_macos() {
  local prefix shared src
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required. Install it from https://brew.sh and run this again." >&2
    exit 1
  fi
  if ! brew list --versions postgresql@16 >/dev/null 2>&1; then
    brew install postgresql@16
  fi
  prefix="$(brew --prefix postgresql@16)"
  shared="$("$prefix/bin/pg_config" --sharedir)"
  if [ -f "$shared/extension/vector.control" ]; then
    return 0
  fi
  src="$(mktemp -d)"
  git clone --depth 1 https://github.com/pgvector/pgvector.git "$src/pgvector"
  make -C "$src/pgvector" PG_CONFIG="$prefix/bin/pg_config"
  make -C "$src/pgvector" install PG_CONFIG="$prefix/bin/pg_config"
  rm -rf "$src"
}

install_bun
if [ "$(uname -s)" = "Darwin" ]; then
  install_postgres_macos
else
  install_postgres_linux
fi

if [ "${ACADEMIC_OS_INSTALL_DRY:-}" = "1" ]; then
  echo "would:bun-install"
  exit 0
fi

bun install
