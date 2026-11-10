#!/usr/bin/env bash
# Dependencies for a Cloud Agent checkout. Safe to run twice. Does not start servers.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
fi

if ! command -v psql >/dev/null 2>&1; then
  if ! sudo apt-get update -qq; then
    sudo sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu/|https://mirrors.edge.kernel.org/ubuntu/|g' \
      -e 's|http://security.ubuntu.com/ubuntu/|https://mirrors.edge.kernel.org/ubuntu/|g' \
      /etc/apt/sources.list.d/ubuntu.sources
    sudo apt-get update -qq
  fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    postgresql postgresql-contrib postgresql-16-pgvector
fi

bun install
