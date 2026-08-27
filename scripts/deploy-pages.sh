#!/usr/bin/env bash
# Rebuild the demo and publish it.
#
# The site is served from main/docs, not a gh-pages branch: after the
# repository was renamed, GitHub's legacy Pages builder failed every build
# against gh-pages on content that was valid, and switching source fixed it.
#
# docs/ also holds the README images, so the build is copied in rather than
# written with vite's --outDir, which empties the directory first.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

npm --prefix "$root/example" install
npm --prefix "$root/example" run build:pages

rm -rf "$root/docs/assets"
cp -r "$root/example/dist/index.html" "$root/example/dist/assets" "$root/docs/"
touch "$root/docs/.nojekyll"

cd "$root"
git add docs
git commit -m "Deploy demo to GitHub Pages" || echo "nothing to deploy"
git push origin main

echo "deployed -> https://indreshp135.github.io/spice-schematic/"
