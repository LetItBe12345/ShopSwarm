#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ "$(node -p 'process.versions.node')" != 24.* ]]; then
  echo 'ShopSwarm Web 需要 Node.js 24；先把 Node.js 24.21.0 放到 PATH。' >&2
  exit 1
fi

dsh_home="${SHOPSWARM_DSH_HOME:-$HOME/.dsh}"
exec env \
  -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u FTP_PROXY -u NO_PROXY \
  -u http_proxy -u https_proxy -u all_proxy -u ftp_proxy -u no_proxy \
  -u AGENT_BROWSER_PROXY -u AGENT_BROWSER_PROXY_BYPASS \
  DSH_HOME="$dsh_home" \
  dsh web "$@"
