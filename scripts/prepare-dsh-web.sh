#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

# Reuse the launcher's runtime checks before building or installing anything.
bash "$project_dir/scripts/run-dsh.sh" --version
pnpm build
pnpm pack --pack-destination "$project_dir/runtime/packages"
package_version="$(node -p 'require("./package.json").version')"
package_path="$project_dir/runtime/packages/shopswarm-$package_version.tgz"
package_hash="$(sha256sum "$package_path")"
package_hash="${package_hash%% *}"
current_package="$project_dir/runtime/packages/shopswarm-$package_version-$package_hash.tgz"
# A content-specific file spec prevents pnpm reusing an older build of the same version.
mv -f "$package_path" "$current_package"
pnpm install:dsh -- web "$current_package"
