#!/usr/bin/env bash
#
# DevDigest test mirror — run a package's test suite from the WSL-native
# filesystem instead of the slow /mnt/* 9p bridge.
#
#   scripts/test-mirror.sh                    # mirror client/, run `pnpm test`
#   scripts/test-mirror.sh client typecheck   # run `pnpm typecheck` in the mirror
#   scripts/test-mirror.sh server test        # full server suite (unit + integration)
#   scripts/test-mirror.sh server exec vitest run --exclude '**/*.it.test.ts'  # unit lane
#   scripts/test-mirror.sh server exec vitest run .it.test                     # integration lane
#
# Why: when the repo lives on a Windows drive, every module read inside WSL2
# goes through the 9p bridge — loading jsdom's module graph alone costs ~82s
# via /mnt/e vs ~0.5s on ext4 (~175x, TD-010). Mirroring the package to $HOME
# and running vitest there removes that multiplier entirely.
#
# Package specifics are declared in the case block below: extra excludes
# (server: runtime `clones/`, build `dist/`) and companion directories that
# must sit next to the package for cross-package aliases to resolve
# (server's vitest/tsconfig alias `@devdigest/reviewer-core` -> ../reviewer-core/src).
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

case "$PKG" in
  server)
    EXTRA_EXCLUDES=(--exclude clones --exclude dist)
    COMPANIONS=(reviewer-core)
    ;;
  *)
    EXTRA_EXCLUDES=()
    COMPANIONS=()
    ;;
esac

SRC="$ROOT/$PKG"
MIRROR_ROOT="${DEVDIGEST_MIRROR:-$HOME/.devdigest-test-mirror}"
DST="$MIRROR_ROOT/$PKG"

[ -d "$SRC" ] || { echo "package dir not found: $SRC" >&2; exit 2; }
[ -f "$SRC/pnpm-lock.yaml" ] || { echo "$PKG has no pnpm-lock.yaml — mirror needs a per-package lockfile" >&2; exit 2; }

sync_dir() { # sync_dir <name> [extra rsync args...]
  local name="$1"; shift
  mkdir -p "$MIRROR_ROOT/$name"
  echo "[mirror] rsync $ROOT/$name/ -> $MIRROR_ROOT/$name/"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .next \
    --exclude coverage \
    --exclude '*.tsbuildinfo' \
    "$@" \
    "$ROOT/$name/" "$MIRROR_ROOT/$name/"
}

sync_dir "$PKG" ${EXTRA_EXCLUDES[@]+"${EXTRA_EXCLUDES[@]}"}
for comp in ${COMPANIONS[@]+"${COMPANIONS[@]}"}; do
  sync_dir "$comp"
  if [ -f "$MIRROR_ROOT/$comp/pnpm-lock.yaml" ]; then
    echo "[mirror] pnpm install --frozen-lockfile ($comp)"
    (cd "$MIRROR_ROOT/$comp" && pnpm install --frozen-lockfile)
  fi
done

cd "$DST"

echo "[mirror] pnpm install --frozen-lockfile ($PKG)"
pnpm install --frozen-lockfile

if [ "${CMD[0]}" = "exec" ]; then
  echo "[mirror] pnpm ${CMD[*]}"
  exec pnpm "${CMD[@]}"
fi
echo "[mirror] pnpm run ${CMD[*]}"
exec pnpm run "${CMD[@]}"
