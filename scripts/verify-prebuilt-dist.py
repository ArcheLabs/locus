#!/usr/bin/env python3
"""Verify the fixed, prebuilt Locus Service artifact without compiling it."""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "dist"
EXPECTED_CODE_HASH = "0x7244d2be5d4c66cd59b186700c18e86464e0e5768cb73e64b4d03258cbd97114"
EXPECTED_ABI_HASH = "0x2a06783d3a21bd1a178cb1709c3fb3b5df42ac8b657a8fa092a31590cbe6c426"


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
if build.get("canonical_toolchain") is not False:
    fail("recorded toolchain provenance changed")
if build.get("jamscript_toolchain_id") != "development" or build.get("jamscript_toolchain_sha256") != "":
    fail("recorded development toolchain provenance changed")

print("PREBUILT_ARTIFACT_CHECKSUMS=verified")
print("SERVICE_CODE_HASH=verified")
print("SERVICE_ABI_HASH=verified")
print("CANONICAL_TOOLCHAIN=false")
