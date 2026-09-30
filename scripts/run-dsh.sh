#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ "$(node --version)" != v24.21.0 || "$(pnpm --version)" != 11.7.0 ]]; then
  echo 'ShopSwarm 需要 Node.js 24.21.0 和 pnpm 11.7.0；请先切换版本。' >&2
  exit 1
fi

expected_dsh="$(node -p 'require("./package.json").engines.dsh')"
installed_dsh="$(node -p 'require("@deepseek-ai/dsh/package.json").version')"
if [[ "$installed_dsh" != "$expected_dsh" ]]; then
  echo "ShopSwarm 需要 DSH $expected_dsh，当前为 $installed_dsh；请运行 pnpm install --frozen-lockfile。" >&2
  exit 1
fi

exec env \
  -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u FTP_PROXY -u NO_PROXY \
  -u http_proxy -u https_proxy -u all_proxy -u ftp_proxy -u no_proxy \
  -u AGENT_BROWSER_PROXY -u AGENT_BROWSER_PROXY_BYPASS \
  DSH_HOME="${SHOPSWARM_DSH_HOME:-${DSH_HOME:-$HOME/.dsh}}" \
  node --env-file-if-exists="$project_dir/.env" \
  "$project_dir/node_modules/@deepseek-ai/dsh/lib/bin.js" "$@"
