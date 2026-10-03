#!/usr/bin/env python3
"""Verify the canonical checked-in RC12 Locus Service candidate artifact."""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "dist"
EXPECTED_CODE_HASH = "0xc8f58efb503f4dce2615fc19e163d8690300794a33381a44de9f9ebbc54a4a62"
EXPECTED_ABI_HASH = "0x2a06783d3a21bd1a178cb1709c3fb3b5df42ac8b657a8fa092a31590cbe6c426"
EXPECTED_TOOLCHAIN_ID = "scriptc-m2-v2"
EXPECTED_TOOLCHAIN_SHA256 = "f9c6405a153a1707c33d384984923bba6652744bd2bef688a8079d0541567420"


def fail(message: str) -> None:
    print(f"PREBUILT_ARTIFACT_INVALID={message}", file=sys.stderr)
    raise SystemExit(1)


try:
    manifest = json.loads((ROOT / "checksums.json").read_text())
except (OSError, json.JSONDecodeError) as error:
    fail(f"cannot read checksum manifest: {error}")

if manifest.get("version") != 1 or manifest.get("algorithm") != "blake2b-256":
    fail("unsupported checksum manifest")
files = manifest.get("files")
if not isinstance(files, dict) or not files:
    fail("missing checksum entries")
for required in ("service.blob", "service.abi.json", "build.json"):
    if required not in files:
        fail(f"missing checksum entry: {required}")

for name, expected in files.items():
    if not isinstance(name, str) or not isinstance(expected, str):
        fail("invalid checksum entry")
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT.resolve()) or not path.is_file():
        fail(f"missing or unsafe artifact: {name}")
    actual = "0x" + hashlib.blake2b(path.read_bytes(), digest_size=32).hexdigest()
    if actual != expected:
        fail(f"checksum mismatch: {name}")

try:
    build = json.loads((ROOT / "build.json").read_text())
except (OSError, json.JSONDecodeError) as error:
    fail(f"cannot read build metadata: {error}")

if build.get("code_hash") != files["service.blob"] or build.get("code_hash") != EXPECTED_CODE_HASH:
    fail("service blob hash differs from the locked build metadata")
if build.get("abi_hash") != files["service.abi.json"] or build.get("abi_hash") != EXPECTED_ABI_HASH:
    fail("ABI hash differs from the locked build metadata")
if build.get("canonical_toolchain") is not True:
    fail("artifact was not built with the canonical toolchain")
if (
    build.get("jamscript_toolchain_id") != EXPECTED_TOOLCHAIN_ID
    or build.get("jamscript_toolchain_sha256") != EXPECTED_TOOLCHAIN_SHA256
):
    fail("recorded RC12 toolchain provenance changed")
memory = build.get("guestMemory")
if (
    not isinstance(memory, dict)
    or memory.get("heapInitialBytes") != 1_048_576
    or memory.get("effectiveHeapMaxBytes") != 16_777_216
):
    fail("guest memory budget differs from the Locus RC12 budget")

print("PREBUILT_ARTIFACT_CHECKSUMS=verified")
print("SERVICE_CODE_HASH=verified")
print("SERVICE_ABI_HASH=verified")
print("CANONICAL_TOOLCHAIN=true")
print("GUEST_MEMORY_BUDGET=verified")
