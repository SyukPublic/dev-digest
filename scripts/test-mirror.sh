#!/usr/bin/env bash
#
# DevDigest test mirror — run a package's test suite from the WSL-native
# filesystem instead of the slow /mnt/* 9p bridge.
#
#   scripts/test-mirror.sh                    # mirror client/, run `pnpm test`
#   scripts/test-mirror.sh client typecheck   # run `pnpm typecheck` in the mirror
#   scripts/test-mirror.sh server test        # any package with its own lockfile
#
# Why: when the repo lives on a Windows drive, every module read inside WSL2
# goes through the 9p bridge — loading jsdom's module graph alone costs ~82s
# via /mnt/e vs ~0.5s on ext4 (~175x, TD-010). Mirroring the package to $HOME
# and running vitest there removes that multiplier entirely.
#
# Idempotent: rsync copies only changes; node_modules lives in the mirror and
# is reused across runs. Exit code is the underlying pnpm command's exit code.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PKG="${1:-client}"
if [ "$#" -ge 2 ]; then
  shift
  CMD=("$@")
else
  CMD=(test)
fi

SRC="$ROOT/$PKG"
MIRROR_ROOT="${DEVDIGEST_MIRROR:-$HOME/.devdigest-test-mirror}"
DST="$MIRROR_ROOT/$PKG"

[ -d "$SRC" ] || { echo "package dir not found: $SRC" >&2; exit 2; }
[ -f "$SRC/pnpm-lock.yaml" ] || { echo "$PKG has no pnpm-lock.yaml — mirror needs a per-package lockfile" >&2; exit 2; }

mkdir -p "$DST"

echo "[mirror] rsync $SRC/ -> $DST/"
rsync -a --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude coverage \
  --exclude '*.tsbuildinfo' \
  "$SRC/" "$DST/"

cd "$DST"

echo "[mirror] pnpm install --frozen-lockfile (store-linked, ext4)"
pnpm install --frozen-lockfile

echo "[mirror] pnpm run ${CMD[*]}"
exec pnpm run "${CMD[@]}"
