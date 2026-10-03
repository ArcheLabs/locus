import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.env.LOCUS_BUILD_OUTPUT ?? path.join(root, "dist"));
const manifest = JSON.parse(await fs.readFile(path.join(output, "build.json"), "utf8"));
assert.equal(manifest.guestMemory?.heapInitialBytes, 1_048_576, "guest heap initial budget must be 1 MiB");
assert.equal(manifest.guestMemory?.heapMaxBytes, 16_777_216, "guest heap maximum must be 16 MiB");
assert.equal(manifest.guestMemory?.effectiveHeapMaxBytes, 16_777_216, "effective heap maximum must match the project budget");
console.log(`LOCUS_GUEST_MEMORY=PASS initial=${manifest.guestMemory.heapInitialBytes} max=${manifest.guestMemory.heapMaxBytes}`);
