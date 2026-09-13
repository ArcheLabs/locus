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

"${JAMSCRIPT_CLI}" check "${ROOT_DIR}"
generated="$(mktemp)"
trap 'rm -f "${generated}"' EXIT
"${JAMSCRIPT_CLI}" abi "${ROOT_DIR}" >"${generated}"
diff -u "${ROOT_DIR}/abi/service.abi.json" "${generated}"

grep -q '^language_version = "0.3"$' "${ROOT_DIR}/deps/jamscript.lock"
grep -q '^abi_version = 1$' "${ROOT_DIR}/deps/jamscript.lock"
echo "LOCUS_JAMSCRIPT_VERSION=0.3"
echo "LOCUS_ABI=PASS"
echo "LOCUS_CHECK=PASS"
