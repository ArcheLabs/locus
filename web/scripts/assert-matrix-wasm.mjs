import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const outputDirectory = join(root, "dist", "assets");
const packageWasm = join(root, "node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm");
const assetName = (await readdir(outputDirectory)).find((name) => /^matrix_sdk_crypto_wasm_bg-.+\.wasm$/.test(name));
assert.ok(assetName, "Vite production output must contain the Matrix crypto WASM asset");

const emittedPath = join(outputDirectory, assetName);
const [source, emitted, metadata] = await Promise.all([readFile(packageWasm), readFile(emittedPath), stat(emittedPath)]);
assert.ok(metadata.size > 0, "Matrix crypto WASM production asset must not be empty");
assert.deepEqual(emitted, source, "Vite must emit the unmodified Matrix crypto WASM bytes");
console.log(`MATRIX_WASM_PRODUCTION_BUILD=PASS ${assetName} (${metadata.size} bytes)`);
