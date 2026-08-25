#!/usr/bin/env bash
# Build the demo and publish it to the gh-pages branch.
# Requires push access; GitHub Pages serves gh-pages at /SPICE-res/.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

npm --prefix "$root/example" install
npm --prefix "$root/example" run build:pages

cp -r "$root/example/dist/." "$work/"
touch "$work/.nojekyll"   # stop Pages running Jekyll over the assets

cd "$work"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy demo to GitHub Pages"
git push -q --force "$(git -C "$root" remote get-url origin)" gh-pages

echo "deployed -> https://indreshp135.github.io/SPICE-res/"
