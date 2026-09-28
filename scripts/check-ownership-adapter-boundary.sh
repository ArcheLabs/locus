#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if grep -Ern 'verifyMatrixCrossSigning|MatrixControlClaimProofV1|canonical(Matrix|Device|SelfSigning)' \
  "${ROOT}/src/service.ts" "${ROOT}/sdk"; then
  echo "LOCUS_LOCAL_MATRIX_CRYPTO_IMPLEMENTATION=FAIL" >&2
  exit 1
fi
grep -Eq '@jamscript/client/ownership/matrix/service-scriptc' "${ROOT}/src/service.ts"
grep -Eq 'verifyMatrixOwnershipAuthorizationScriptc' "${ROOT}/src/service.ts"
CLIENT_ROOT="$(npm root)/@jamscript/client"
grep -Eq 'import \{ verifyEd25519 \} from "jam"' "${CLIENT_ROOT}/src/ownership/matrix/service-scriptc.ts"
test "$(grep -c 'verifyEd25519(' "${CLIENT_ROOT}/src/ownership/matrix/service-scriptc.ts")" -eq 2
echo "LOCUS_LOCAL_MATRIX_CRYPTO_IMPLEMENTATION_COUNT=0"
echo "LOCUS_OWNERSHIP_MATRIX_ADAPTER=PASS"
