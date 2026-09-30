#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

dsh_home="${SHOPSWARM_TUI_DSH_HOME:-$project_dir/runtime/dsh-tui/home}"
if [[ ! -f "$dsh_home/profiles/tui/package.json" ]]; then
  echo "找不到已安装的 TUI profile：$dsh_home/profiles/tui" >&2
  exit 1
fi

export SHOPSWARM_DSH_HOME="$dsh_home"
exec bash "$project_dir/scripts/run-dsh.sh" tui "$@"
