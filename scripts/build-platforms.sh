#!/usr/bin/env bash
set -euo pipefail

# Cross-compile veda for all supported platforms.
# Bun supports cross-compilation via --target=bun-<os>-<arch>.
# Run from the veda-ts/ directory.
#
# Output: platform/<name>/bin/veda (the compiled binary for that platform)

cd "$(dirname "$0")/.."

VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
echo "Building veda v${VERSION} for all platforms..."

TARGETS=(
  "bun-darwin-arm64:darwin-arm64"
  "bun-darwin-x64:darwin-x64"
  "bun-linux-x64:linux-x64"
  "bun-linux-arm64:linux-arm64"
)

for entry in "${TARGETS[@]}"; do
  target="${entry%%:*}"
  dir="${entry##*:}"
  echo ""
  echo "  → ${dir} (${target})"
  bun build --compile --minify --target="${target}" \
    --outfile="platform/${dir}/bin/veda" \
    src/index.ts
  chmod +x "platform/${dir}/bin/veda"
  echo "    $(file "platform/${dir}/bin/veda" | cut -d: -f2-)"
done

echo ""
echo "Done. Binaries in platform/*/bin/veda"
echo "Publish each:  cd platform/<name> && npm publish"
echo "Then publish:  npm publish  (from veda-ts/ root)"
