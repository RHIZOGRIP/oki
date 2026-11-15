#!/bin/sh
# Writes, beside a release's manifest.json, oki-management.tgz and spore-plugin-web.tgz, the
# package.json provision.sh installs and the package-lock.json that fixes every package under it,
# with its hash. Nothing is installed.
#   lock.sh <directory>
set -eu
dir=$1
jq -n --arg spore "$(jq -er .spore "$dir/manifest.json")" \
  '{ private: true, dependencies: { "@rhizogrip/spore-cli": $spore, "@rhizogrip/spore": $spore, "@rhizogrip/spore-plugin-web": "file:spore-plugin-web.tgz", "@rhizogrip/oki-management": "file:oki-management.tgz" } }' \
  > "$dir/package.json"
(cd "$dir" && npm install --package-lock-only --no-audit --no-fund)
