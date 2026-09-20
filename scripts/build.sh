#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
JAMSCRIPT_CLI="${LOCUS_JAMSCRIPT_CLI:-$(command -v jams || true)}"

if [[ -z "${JAMSCRIPT_CLI}" || ! -x "${JAMSCRIPT_CLI}" ]]; then
  echo "LOCUS_BUILD=BLOCKED (install the published jams binary)" >&2
  exit 2
fi

args=(build "${ROOT_DIR}" --output "${ROOT_DIR}/dist")
if [[ "${LOCUS_BUILD_OFFLINE:-0}" == "1" ]]; then args+=(--offline); fi
"${JAMSCRIPT_CLI}" "${args[@]}"
echo "CONSUMER_MODE=true"
echo "LOCUS_BUILD=PASS"
