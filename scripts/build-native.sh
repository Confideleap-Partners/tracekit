#!/usr/bin/env bash
# Build the napi-rs native addon and copy it into the package.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT/packages/tracekit"
OUT_DIR="$PACKAGE_DIR/native"

cd "$ROOT"
cargo build -p tracekit-node --release

case "$(uname -s)" in
  Linux)
    SRC="$ROOT/target/release/libtracekit_node.so"
    ;;
  Darwin)
    SRC="$ROOT/target/release/libtracekit_node.dylib"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    SRC="$ROOT/target/release/tracekit_node.dll"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac

if [ ! -f "$SRC" ]; then
  echo "Native build output not found at $SRC" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cp "$SRC" "$OUT_DIR/tracekit.node"
echo "Wrote $OUT_DIR/tracekit.node"
