#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
NODE_BIN="${LOCUS_NODE_BIN:-node}"
if [[ ! -f "${ROOT_DIR}/node_modules/typescript/bin/tsc" ]]; then
  echo "SDK dependencies are not installed; run npm install first" >&2
  exit 2
fi
"${NODE_BIN}" "${ROOT_DIR}/node_modules/typescript/bin/tsc" -p "${ROOT_DIR}/tsconfig.json"
echo "SDK_TYPECHECK=PASS"
"${NODE_BIN}" --experimental-strip-types --test "${ROOT_DIR}"/tests/model/*.test.mjs "${ROOT_DIR}"/tests/vectors/*.test.mjs
echo "LOCAL_MODEL_TESTS=PASS"
"${NODE_BIN}" --experimental-strip-types --test "${ROOT_DIR}"/tests/web-network.test.mjs
echo "WEB_NETWORK_TESTS=PASS"
