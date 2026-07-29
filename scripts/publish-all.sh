#!/usr/bin/env bash
set -euo pipefail

# Publish all platform packages, then the main package.
# Run this from the veda-ts/ directory after `npm login`.
# npm will prompt for 2FA on the first publish; the token caches for
# the rest of the session, so you only authenticate once.

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

for pkg in darwin-arm64 darwin-x64 linux-x64 linux-arm64; do
  echo ""
  echo "=== Publishing veda-ts-${pkg} ==="
  cd "${ROOT}/platform/${pkg}"
  npm publish --access public
  cd "${ROOT}"
done

echo ""
echo "=== Publishing veda-ts (main) ==="
cd "${ROOT}"
npm publish

echo ""
echo "=== All packages published ==="
echo "  veda-ts@$(node -e "console.log(require('./package.json').version)")"
echo "  + 4 platform packages"
