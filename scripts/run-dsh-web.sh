#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

bash "$project_dir/scripts/prepare-dsh-web.sh"
exec bash "$project_dir/scripts/run-dsh.sh" web "$@"
