#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
JAMSCRIPT_ROOT="${LOCUS_JAMSCRIPT_HOME:-}"
JAMSCRIPT_CLI="${LOCUS_JAMSCRIPT_CLI:-}"
if [[ -z "${JAMSCRIPT_CLI}" && -n "${JAMSCRIPT_ROOT}" ]]; then
  for candidate in "${JAMSCRIPT_ROOT}/target/debug/jams" "${JAMSCRIPT_ROOT}/target/release/jams"; do
    if [[ -x "${candidate}" ]]; then JAMSCRIPT_CLI="${candidate}"; break; fi
  done
fi
if [[ -z "${JAMSCRIPT_CLI}" ]]; then JAMSCRIPT_CLI="$(command -v jams || true)"; fi
if [[ -z "${JAMSCRIPT_CLI}" || ! -x "${JAMSCRIPT_CLI}" ]]; then
  echo "LOCUS_BUILD=NOT_RUN (set LOCUS_JAMSCRIPT_CLI or install jams)"
  exit 2
fi

args=(build "${ROOT_DIR}" --output "${ROOT_DIR}/dist")
if [[ "${LOCUS_BUILD_OFFLINE:-0}" == "1" ]]; then args+=(--offline); fi
"${JAMSCRIPT_CLI}" "${args[@]}"
echo "LOCUS_BUILD=PASS"
echo "LOCUS_PVM_BUILD=PASS"
