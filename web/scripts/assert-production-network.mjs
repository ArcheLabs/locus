import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocusMode, resolveLocusMode } from "../src/network/mode.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const html = await readFile(join(root, "dist", "index.html"), "utf8");

assert.equal(resolveLocusMode(undefined), "network", "missing mode must resolve to Network");
assert.equal(resolveLocusMode("demo"), "demo", "Demo must require an explicit opt-in");
assert.equal(buildLocusMode("demo", "build"), "network", "production builds must always use Network");
assert.match(html, /<meta name="locus-mode" content="network"\s*\/>/, "production HTML must declare Network Mode");

console.log("PRODUCTION_BUILD_DEFAULT_MODE=network");
console.log("EXPLICIT_DEMO_ONLY=true");
