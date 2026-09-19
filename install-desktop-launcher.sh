#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
applications_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
launcher_path="$applications_dir/PharmacyApothecary.desktop"

mkdir -p "$applications_dir"
sed "s|^Exec=.*|Exec=$project_dir/launch-pharmacy.sh|" \
  "$project_dir/PharmacyApothecary.desktop" > "$launcher_path"
chmod 755 "$launcher_path"

printf 'Installed Pharmacy Apothecary launcher at %s\n' "$launcher_path"
