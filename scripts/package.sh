#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(node -p "require('$project_root/manifest.json').version")
package_root="$project_root/dist/package"
archive="$project_root/dist/skellock-$version.zip"

rm -rf "$package_root"
rm -f "$archive"
mkdir -p "$package_root/icons"

for file in \
  manifest.json \
  background.js \
  lock.html \
  script.js \
  styles.css \
  rules.json \
  LICENSE \
  PRIVACY.md
do
  cp "$project_root/$file" "$package_root/$file"
done

for size in 16 32 48 128
do
  cp "$project_root/icons/icon-$size.png" "$package_root/icons/icon-$size.png"
done

(
  cd "$package_root"
  zip -q -X -r "$archive" .
)

printf '%s\n' "$archive"
