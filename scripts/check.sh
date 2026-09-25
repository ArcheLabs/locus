#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
JAMSCRIPT_CLI="${LOCUS_JAMSCRIPT_CLI:-$(command -v jams || true)}"

if [[ -z "${JAMSCRIPT_CLI}" || ! -x "${JAMSCRIPT_CLI}" ]]; then
  echo "LOCUS_CHECK=BLOCKED (install the published jams binary)" >&2
  exit 2
fi

generated_project="$(mktemp -d)"
generated_abi="$(mktemp)"
trap 'rm -rf "${generated_project}"; rm -f "${generated_abi}"' EXIT
node "${ROOT_DIR}/scripts/bundle-service.mjs" "${ROOT_DIR}" "${generated_project}"
"${JAMSCRIPT_CLI}" check "${generated_project}"
"${JAMSCRIPT_CLI}" abi "${generated_project}" >"${generated_abi}"
diff -u "${ROOT_DIR}/abi/service.abi.json" "${generated_abi}"

grep -q '^language_version = "0.3"$' "${ROOT_DIR}/deps/jamscript.lock"
grep -q '^abi_version = 1$' "${ROOT_DIR}/deps/jamscript.lock"
echo "CONSUMER_MODE=true"
echo "LOCUS_ABI=PASS"
echo "LOCUS_CHECK=PASS"
