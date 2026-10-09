#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ "$(node --version)" != v24.21.0 || "$(pnpm --version)" != 11.7.0 ]]; then
  echo 'ShopSwarm 需要 Node.js 24.21.0 和 pnpm 11.7.0；请先切换版本。' >&2
  exit 1
fi

pnpm install --frozen-lockfile
bash "$project_dir/scripts/prepare-dsh-web.sh"
