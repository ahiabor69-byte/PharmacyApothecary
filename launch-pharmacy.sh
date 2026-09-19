#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

if [[ ! -f "$project_dir/dist/index.html" ]]; then
  npm run build
fi

exec env NODE_ENV=production npm start
