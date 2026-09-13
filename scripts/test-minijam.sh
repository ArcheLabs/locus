#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

if [[ "${LOCUS_RUN_REAL_MINIJAM:-0}" != "1" ]]; then
  echo "REAL_MINIJAM_E2E=NOT_RUN"
  echo "Set LOCUS_RUN_REAL_MINIJAM=1 after configuring a current MiniJAM network and JamScript client adapter."
  exit 0
fi

if [[ -z "${LOCUS_REAL_MINIJAM_COMMAND:-}" ]]; then
  echo "REAL_MINIJAM_E2E=NOT_RUN"
  echo "LOCUS_REAL_MINIJAM_COMMAND is required for an explicitly configured network run."
  exit 0
fi

# The command is supplied by the deployment environment so this repository
# does not duplicate JamScript's transport, signer, provider, or PVM runner.
bash -lc "${LOCUS_REAL_MINIJAM_COMMAND}"
echo "REAL_MINIJAM_E2E=PASS"
