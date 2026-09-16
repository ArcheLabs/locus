#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

if [[ "${LOCUS_RUN_REAL_MINIJAM:-0}" != "1" ]]; then
  echo "REAL_MINIJAM_E2E=NOT_RUN"
  echo "Set LOCUS_RUN_REAL_MINIJAM=1 after configuring the existing MiniJAM network."
  exit 0
fi

required=(LOCUS_E2E_SERVICE_ID LOCUS_E2E_GENESIS_HASH JAMSCRIPT_CLIENT_ROOT)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required" >&2
    exit 2
  fi
done

NODE_BIN="${LOCUS_NODE_BIN:-node}"
"${NODE_BIN}" "${ROOT_DIR}/scripts/real-minijam-e2e.mjs"
