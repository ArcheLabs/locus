#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if rg -n 'verifyMatrixCrossSigning|MatrixControlClaimProofV1|canonical(Matrix|Device|SelfSigning)' \
  "${ROOT}/src/service.ts" "${ROOT}/sdk"; then
  echo "LOCUS_LOCAL_MATRIX_CRYPTO_IMPLEMENTATION=FAIL" >&2
  exit 1
fi
rg -q '@jamscript/client/ownership/matrix/service' "${ROOT}/src/service.ts"
rg -q 'verifyMatrixOwnershipAuthorization' "${ROOT}/src/service.ts"
echo "LOCUS_LOCAL_MATRIX_CRYPTO_IMPLEMENTATION_COUNT=0"
echo "LOCUS_OWNERSHIP_MATRIX_ADAPTER=PASS"
