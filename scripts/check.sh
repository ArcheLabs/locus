#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
JAMSCRIPT_CLI="${LOCUS_JAMSCRIPT_CLI:-$(command -v jams || true)}"

if [[ -z "${JAMSCRIPT_CLI}" || ! -x "${JAMSCRIPT_CLI}" ]]; then
  echo "LOCUS_CHECK=BLOCKED (install the published jams binary)" >&2
  exit 2
fi

"${JAMSCRIPT_CLI}" check "${ROOT_DIR}"
generated="$(mktemp)"
trap 'rm -f "${generated}"' EXIT
"${JAMSCRIPT_CLI}" abi "${ROOT_DIR}" >"${generated}"
diff -u "${ROOT_DIR}/abi/service.abi.json" "${generated}"

grep -q '^language_version = "0.3"$' "${ROOT_DIR}/deps/jamscript.lock"
grep -q '^abi_version = 1$' "${ROOT_DIR}/deps/jamscript.lock"
echo "CONSUMER_MODE=true"
echo "LOCUS_ABI=PASS"
echo "LOCUS_CHECK=PASS"
