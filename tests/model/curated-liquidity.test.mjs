import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseHumanAmount, validateLiquidityManifest } from "../../scripts/curated/liquidity.mjs";
import { createTreasurySignerFromKeyFile, jamScriptEip712Preimage, parseTreasuryPrivateKeyFile } from "../../scripts/curated/treasury-keyfile.mjs";
import { CURATED_ASSETS, CURATED_TREASURY_EVM, curatedTreasuryOwnership } from "../../scripts/curated/config.mjs";

test("Local pool manifest uses the five approved demo ratios and exact decimal scaling", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../../config/liquidity/local.v1.json", import.meta.url), "utf8"));
  const pools = validateLiquidityManifest(manifest);
  assert.deepEqual(pools.map(({ base, quote }) => `${base}/${quote}`), [
    "DOT/USDT", "MINI/USDT", "AAPL/USDT", "NVDA/USDT", "TSLA/USDT",
  ]);
  assert.equal(parseHumanAmount("100000", 10), 1_000_000_000_000_000n);
  assert.equal(parseHumanAmount("500000", 6), 500_000_000_000n);
  assert.equal(parseHumanAmount("10000000", 6), 10_000_000_000_000n);
  assert.equal(parseHumanAmount("10000", 4), 100_000_000n);
  const reserves = new Map(CURATED_ASSETS.map((asset) => [asset.symbol, 0n]));
  for (const pool of pools) {
    const base = CURATED_ASSETS.find((asset) => asset.symbol === pool.base);
    const quote = CURATED_ASSETS.find((asset) => asset.symbol === pool.quote);
    reserves.set(base.symbol, reserves.get(base.symbol) + parseHumanAmount(pool.baseAmount, base.decimals));
    reserves.set(quote.symbol, reserves.get(quote.symbol) + parseHumanAmount(pool.quoteAmount, quote.decimals));
  }
  const remaining = new Map(CURATED_ASSETS.map((asset) => [asset.symbol, asset.initialSupply - reserves.get(asset.symbol)]));
  assert.deepEqual(Object.fromEntries([...remaining].map(([symbol, balance]) => [symbol, balance.toString()])), {
    DOT: "9000000000000000",
    MINI: "90000000000000",
    USDT: "5500000000000",
    AAPL: "9900000000",
    NVDA: "9900000000",
    TSLA: "9900000000",
  });
  assert.throws(() => parseHumanAmount("1.0000001", 6), /fractional digits/);
  assert.throws(() => parseHumanAmount("1e6", 6), /decimal string/);
  assert.throws(() => validateLiquidityManifest({ ...manifest, pools: manifest.pools.slice(0, 4) }), /exactly five/);
  const changedRatios = manifest.pools.map((pool, index) => index === 0 ? { ...pool, quoteAmount: "1" } : pool);
  assert.throws(() => validateLiquidityManifest({ ...manifest, pools: changedRatios }), /approved five demo pool ratios/);
  assert.equal(CURATED_TREASURY_EVM, "0x78B02E176e587E163661fBe70232CCDDEb11759e");
  assert.equal(curatedTreasuryOwnership.public.length, 20);
});

test("Treasury key file parser accepts only a single 32-byte hex value", () => {
  assert.throws(() => parseTreasuryPrivateKeyFile(Buffer.from("not a key\n")), /exactly one 32-byte/);
  assert.throws(() => parseTreasuryPrivateKeyFile(Buffer.from(`${"a".repeat(63)}\n`)), /exactly one 32-byte/);
  assert.throws(() => parseTreasuryPrivateKeyFile(Buffer.from(`${"a".repeat(64)} ${"b".repeat(64)}`)), /exactly one 32-byte/);
});

test("Treasury key file rejects unsafe permissions before parsing or chain use", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "locus-treasury-keyfile-test-"));
  const keyPath = path.join(directory, "not-a-secret-fixture.txt");
  try {
    await fs.writeFile(keyPath, "not a key\n", { mode: 0o644 });
    await assert.rejects(
      createTreasurySignerFromKeyFile(keyPath, "0x78B02E176e587E163661fBe70232CCDDEb11759e", process.cwd()),
      /permissions are too broad/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Treasury signer accepts only the fixed JamScript EIP-712 action schema", () => {
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "salt", type: "bytes32" },
      ],
      JamScriptAction: [{ name: "commitment", type: "bytes32" }],
    },
    primaryType: "JamScriptAction",
    domain: { name: "JamScript", version: "1", salt: `0x${"11".repeat(32)}` },
    message: { commitment: `0x${"22".repeat(32)}` },
  };
  const preimage = jamScriptEip712Preimage(typedData);
  assert.equal(preimage.length, 66);
  assert.deepEqual(preimage.slice(0, 2), new Uint8Array([0x19, 0x01]));
  assert.deepEqual(jamScriptEip712Preimage(typedData), preimage);
  assert.throws(() => jamScriptEip712Preimage({ ...typedData, primaryType: "PersonalSign" }), /only accepts JamScriptAction/);
});

test("tracked and present worktree files contain no signer or seed filenames", () => {
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
  const secretFileName = /(?:^|\/)(?:\.env(?:\.[^/]+)?|[^/]*(?:private[-_.]?key|seed[-_.]?phrase|mnemonic|locus-treasury)[^/]*)$/i;
  assert.deepEqual(paths.filter((file) => secretFileName.test(file)), []);
});

test("Swap UX distinguishes pool pricing from market data and discloses demo equity", async () => {
  const source = await fs.readFile(new URL("../../web/src/app.tsx", import.meta.url), "utf8");
  assert.match(source, /Pool price · Demo liquidity · No market oracle/);
  assert.match(source, /Demo equity · No real securities rights/);
  assert.match(source, /No liquidity is available for this pair/);
  assert.doesNotMatch(source, /Market data/);
});
