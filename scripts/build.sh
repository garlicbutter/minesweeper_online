#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo build --locked --release --target wasm32-unknown-unknown --no-default-features --lib
cp "${CARGO_TARGET_DIR:-target}/wasm32-unknown-unknown/release/minefield.wasm" public/minefield.wasm
cargo build --locked --release --bin minefield
