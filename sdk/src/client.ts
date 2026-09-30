import { ownershipKey, encodeOwnership, type Ownership, type SubmitActionResult } from "@jamscript/client";
import { assertId } from "./ids.js";
import { encodeAssetName, encodeAssetSymbol, decodeAssetName, decodeAssetSymbol } from "./metadata.js";
import { LOCUS_ERROR_CODES, locusError, normalizeLocusError } from "./errors.js";
import type {
  Amount,
  Asset,
  AssetId,
  JamScriptLikeClient,
  LocusRecord,
  LocusValue,
  ExactInQuote,
  OwnershipSession,
  LiquidityPosition,
  AddLiquidityQuote,
  RemoveLiquidityQuote,
  PreparedOwnershipAction,
  OwnershipPreparationPhase,
  SignedOwnershipAction,
  Pool,
} from "./types.js";
import { quoteAddLiquidity as calculateAddLiquidity, quoteInitialLiquidity, quoteRemoveLiquidity as calculateRemoveLiquidity } from "./liquidity.js";

export const MAX_POOL_RESERVE = (1n << 64n) - 1n;
export const SWAP_FEE_BPS = 30 as const;
const BPS = 10000n;

export type ControllerStatus = "absent" | "active" | "revoked";

function asBigInt(value: LocusValue | null, label: string): bigint {
  if (typeof value !== "bigint") throw new Error(`${label} query did not return bigint`);
  return value;
}

function asBigIntOrZero(value: LocusValue | null, label: string): bigint {
  return value === null ? 0n : asBigInt(value, label);
}

function asBytes(value: LocusValue | null, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${label} query did not return bytes`);
  return value;
}

function asOwnership(value: LocusValue): Ownership {
  if (!value || typeof value !== "object" || value instanceof Uint8Array || Array.isArray(value) || !(value.public instanceof Uint8Array)) {
    throw new Error("asset issuer query did not return Ownership");
  }
  return value as Ownership;
}

function asAsset(value: LocusValue | null): Asset | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("asset query did not return a record");
  }
  const asset = value as Record<string, LocusValue>;
  if (typeof asset.version !== "number" || asset.version !== 2) throw new Error("unsupported asset version");
  return {
    version: 2,
    issuer: asOwnership(asset.issuer),
    name: asBytes(asset.name, "asset name"),
    symbol: asBytes(asset.symbol, "asset symbol"),
    decimals: typeof asset.decimals === "number" ? asset.decimals : Number(asset.decimals),
    totalSupply: asBigInt(asset.totalSupply, "total supply"),
  };
}

function asPool(value: LocusValue | null, key: { asset0: AssetId; asset1: AssetId }): Pool | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || value instanceof Uint8Array || Array.isArray(value)) {
    throw new Error("pool query did not return a record");
  }
  const pool = value as Record<string, LocusValue>;
  if (typeof pool.version !== "number" || pool.version !== 2) throw new Error("unsupported pool version");
  return {
    version: 2,
    asset0: key.asset0,
    asset1: key.asset1,
    reserve0: asBigInt(pool.reserve0, "pool reserve0"),
    reserve1: asBigInt(pool.reserve1, "pool reserve1"),
    totalShares: asBigInt(pool.totalShares, "pool total shares"),
  };
}

function assertAmount(amount: Amount, label = "amount"): void {
  if (typeof amount !== "bigint" || amount < 0n || amount >= 1n << 128n) {
    throw new Error(`${label} must be a u128 bigint`);
  }
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw locusError(LOCUS_ERROR_CODES.INVALID_DECIMALS);
  }
}

function assertOwnership(owner: Ownership, label: string): void {
  try {
    encodeOwnership(owner);
  } catch (error) {
    throw new Error(`${label} is not a valid Ownership`, { cause: error });
  }
}

function balanceQueryKey(assetId: AssetId, owner: Ownership): LocusRecord {
  return { assetId, ownerKey: ownershipKey(owner) };
}

function compareAssetIds(left: AssetId, right: AssetId): number {
  for (let index = 0; index < 32; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function canonicalPoolKey(assetA: AssetId, assetB: AssetId): { asset0: AssetId; asset1: AssetId } {
  assertId(assetA, "assetA");
  assertId(assetB, "assetB");
  const order = compareAssetIds(assetA, assetB);
  if (order === 0) throw locusError(LOCUS_ERROR_CODES.INVALID_POOL_PAIR);
  return order < 0 ? { asset0: assetA, asset1: assetB } : { asset0: assetB, asset1: assetA };
}

function assertPoolReserve(value: Amount, label: string): void {
  assertAmount(value, label);
  if (value > MAX_POOL_RESERVE) throw locusError(LOCUS_ERROR_CODES.POOL_RESERVE_LIMIT);
}

export function quoteExactIn(reserveIn: Amount, reserveOut: Amount, amountIn: Amount): ExactInQuote {
  assertPoolReserve(reserveIn, "reserveIn");
  assertPoolReserve(reserveOut, "reserveOut");
  assertPoolReserve(amountIn, "amountIn");
  if (amountIn === 0n) throw locusError(LOCUS_ERROR_CODES.INVALID_SWAP_AMOUNT);
  if (reserveIn === 0n || reserveOut === 0n) throw locusError(LOCUS_ERROR_CODES.INSUFFICIENT_POOL_LIQUIDITY);
  const amountInAfterFee = amountIn * (BPS - BigInt(SWAP_FEE_BPS)) / BPS;
  if (amountInAfterFee === 0n) throw locusError(LOCUS_ERROR_CODES.INVALID_SWAP_AMOUNT);
  const amountOut = reserveOut * amountInAfterFee / (reserveIn + amountInAfterFee);
  if (amountOut === 0n || amountOut >= reserveOut) throw locusError(LOCUS_ERROR_CODES.INSUFFICIENT_POOL_LIQUIDITY);
  const minimumAmountOut = amountOut;
  return {
    amountIn,
    amountOut,
    minimumAmountOut,
    feeAmount: amountIn - amountInAfterFee,
    feeBps: SWAP_FEE_BPS,
  };
}

export function minimumAmountOut(amountOut: Amount, slippageBps: number): Amount {
  assertAmount(amountOut, "amountOut");
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) {
    throw new Error("slippageBps must be an integer from 0 to 9999");
  }
  return amountOut * BigInt(10000 - slippageBps) / BPS;
}

function allowanceQueryKey(assetId: AssetId, owner: Ownership, spender: Ownership): LocusRecord {
  return {
    assetId,
    ownerKey: ownershipKey(owner),
    spenderKey: ownershipKey(spender),
  };
}

function controllerGrantQueryKey(subject: Ownership, controller: Ownership): LocusRecord {
  return {
    subjectKey: ownershipKey(subject),
    controllerKey: ownershipKey(controller),
  };
}

export class LocusClient {
  constructor(
    readonly jamClient: JamScriptLikeClient,
    readonly session?: OwnershipSession | null,
  ) {}

  withSession(session: OwnershipSession | null): LocusClient {
    return new LocusClient(this.jamClient, session);
  }

  private requireSession(): OwnershipSession {
    if (!this.session) throw locusError(LOCUS_ERROR_CODES.NO_OWNERSHIP_SESSION, "an Ownership session is required for this action");
    assertOwnership(this.session.subject, "session.subject");
    return this.session;
  }

  private async submit(
    actionName: string,
    input: Record<string, LocusValue>,
  ): Promise<SubmitActionResult> {
    try {
      const session = this.requireSession();
      return await this.jamClient.submitOwnershipAction(
        actionName,
        { ...input, subject: session.subject },
        session.signer,
      );
    } catch (error) {
      throw normalizeLocusError(error) ?? error;
    }
  }

  private async queryValue(queryName: string, key?: LocusValue): Promise<LocusValue | null> {
    const result = await this.jamClient.queryLatest(queryName, key);
    return result.value;
  }

  async waitForAction(transactionId: string, options?: { intervalMs?: number; timeoutMs?: number }) {
    return this.jamClient.waitForAction(transactionId, options);
  }

  async waitForActionByHash(
    transactionId: string,
    actionHash: string,
    options?: { intervalMs?: number; timeoutMs?: number },
  ) {
    return this.jamClient.waitForAction(transactionId, actionHash, options);
  }

  /** Complete all deployment/state reads before the caller opens a wallet. */
  prepareOwnershipAction(
    actionName: string,
    input: Record<string, LocusValue>,
    options: { onProgress?: (phase: OwnershipPreparationPhase) => void } = {},
  ): Promise<PreparedOwnershipAction> {
    const session = this.requireSession();
    const prepare = this.jamClient.prepareOwnershipAction;
    if (!prepare) throw new Error("the configured JamScript client does not expose phased Ownership actions");
    return prepare.call(this.jamClient, actionName, { ...input, subject: session.subject }, session.signer, options);
  }

  /** Starts the wallet request synchronously when called from a user gesture. */
  signPreparedOwnershipAction(prepared: PreparedOwnershipAction): Promise<SignedOwnershipAction> {
    this.requireSession();
    const sign = this.jamClient.signPreparedOwnershipAction;
    if (!sign) throw new Error("the configured JamScript client does not expose phased Ownership actions");
    return sign.call(this.jamClient, prepared);
  }

  abandonPreparedOwnershipAction(prepared: PreparedOwnershipAction): void {
    const abandon = this.jamClient.abandonPreparedOwnershipAction;
    if (!abandon) return;
    abandon.call(this.jamClient, prepared);
  }

  submitSignedOwnershipAction(signed: SignedOwnershipAction) {
    this.requireSession();
    const submit = this.jamClient.submitSignedOwnershipAction;
    if (!submit) throw new Error("the configured JamScript client does not expose phased Ownership actions");
    return submit.call(this.jamClient, signed);
  }

  async transactionStatus(transactionId: string) {
    if (!this.jamClient.transactionStatus) throw new Error("the configured JamScript client does not expose transaction status");
    return this.jamClient.transactionStatus(transactionId);
  }

  async finalizedContext() {
    if (!this.jamClient.finalizedContext) throw new Error("the configured JamScript client does not expose finalized context");
    return this.jamClient.finalizedContext();
  }

  async createAsset(
    assetId: AssetId,
    name: string | Uint8Array,
    symbol: string | Uint8Array,
    decimals: number,
    initialSupply: Amount,
    initialHolder?: Ownership,
  ): Promise<SubmitActionResult> {
    return this.submit("createAsset", this.createAssetInput(assetId, name, symbol, decimals, initialSupply, initialHolder));
  }

  prepareCreateAsset(
    assetId: AssetId,
    name: string | Uint8Array,
    symbol: string | Uint8Array,
    decimals: number,
    initialSupply: Amount,
    initialHolder?: Ownership,
    onProgress?: (phase: OwnershipPreparationPhase) => void,
  ): Promise<PreparedOwnershipAction> {
    return this.prepareOwnershipAction("createAsset", this.createAssetInput(assetId, name, symbol, decimals, initialSupply, initialHolder), { onProgress });
  }

  private createAssetInput(
    assetId: AssetId,
    name: string | Uint8Array,
    symbol: string | Uint8Array,
    decimals: number,
    initialSupply: Amount,
    initialHolder?: Ownership,
  ): Record<string, LocusValue> {
    assertId(assetId, "assetId");
    assertDecimals(decimals);
    assertAmount(initialSupply, "initialSupply");
    const holder = initialHolder ?? this.requireSession().subject;
    assertOwnership(holder, "initialHolder");
    const nameBytes = typeof name === "string" ? encodeAssetName(name) : name;
    const symbolBytes = typeof symbol === "string" ? encodeAssetSymbol(symbol) : symbol;
    if (!(nameBytes instanceof Uint8Array) || nameBytes.length === 0 || nameBytes.length > 64) {
      throw locusError(LOCUS_ERROR_CODES.INVALID_ASSET_NAME);
    }
    if (!(symbolBytes instanceof Uint8Array) || symbolBytes.length === 0 || symbolBytes.length > 16) {
      throw locusError(LOCUS_ERROR_CODES.INVALID_ASSET_SYMBOL);
    }
    return {
      assetId,
      name: nameBytes,
      symbol: symbolBytes,
      decimals,
      initialSupply,
      initialHolder: holder,
    };
  }

  async transfer(assetId: AssetId, to: Ownership, amount: Amount): Promise<SubmitActionResult> {
    assertId(assetId, "assetId");
    assertOwnership(to, "to");
    assertAmount(amount);
    return this.submit("transfer", { assetId, to, amount });
  }

  async approve(assetId: AssetId, spender: Ownership, amount: Amount): Promise<SubmitActionResult> {
    assertId(assetId, "assetId");
    assertOwnership(spender, "spender");
    assertAmount(amount);
    return this.submit("approve", { assetId, spender, amount });
  }

  async transferFrom(
    assetId: AssetId,
    from: Ownership,
    to: Ownership,
    amount: Amount,
  ): Promise<SubmitActionResult> {
    assertId(assetId, "assetId");
    assertOwnership(from, "from");
    assertOwnership(to, "to");
    assertAmount(amount);
    return this.submit("transferFrom", { assetId, from, to, amount });
  }

  async mint(assetId: AssetId, to: Ownership, amount: Amount): Promise<SubmitActionResult> {
    assertId(assetId, "assetId");
    assertOwnership(to, "to");
    assertAmount(amount);
    return this.submit("mint", { assetId, to, amount });
  }

  async burn(assetId: AssetId, amount: Amount): Promise<SubmitActionResult> {
    assertId(assetId, "assetId");
    assertAmount(amount);
    return this.submit("burn", { assetId, amount });
  }

  async authorizeMatrixController(proof: Uint8Array): Promise<SubmitActionResult> {
    if (!(proof instanceof Uint8Array) || proof.length === 0 || proof.length > 4096) {
      throw new Error("Matrix controller authorization proof must be between 1 and 4096 bytes");
    }
    return this.submit("authorizeMatrixController", { proof });
  }

  async addController(controller: Ownership): Promise<SubmitActionResult> {
    assertOwnership(controller, "controller");
    return this.submit("addController", { controller });
  }

  async revokeController(controller: Ownership): Promise<SubmitActionResult> {
    assertOwnership(controller, "controller");
    return this.submit("revokeController", { controller });
  }

  async getControllerStatus(subject: Ownership, controller: Ownership): Promise<ControllerStatus> {
    assertOwnership(subject, "subject");
    assertOwnership(controller, "controller");
    const value = await this.queryValue("getControllerGrant", controllerGrantQueryKey(subject, controller));
    if (value === null) return "absent";
    if (value === 1n || value === 1) return "active";
    if (value === 0n || value === 0) return "revoked";
    throw new Error("controller grant query returned an unknown status");
  }

  async isControllerActive(subject: Ownership, controller: Ownership): Promise<boolean> {
    return (await this.getControllerStatus(subject, controller)) === "active";
  }

  async getAsset(assetId: AssetId): Promise<Asset | null> {
    assertId(assetId, "assetId");
    return asAsset(await this.queryValue("getAsset", assetId));
  }

  async balanceOf(assetId: AssetId, owner: Ownership): Promise<Amount> {
    assertId(assetId, "assetId");
    assertOwnership(owner, "owner");
    const value = await this.queryValue("getBalance", balanceQueryKey(assetId, owner));
    return value === null ? 0n : asBigInt(value, "balance");
  }

  async allowance(assetId: AssetId, owner: Ownership, spender: Ownership): Promise<Amount> {
    assertId(assetId, "assetId");
    assertOwnership(owner, "owner");
    assertOwnership(spender, "spender");
    const value = await this.queryValue("getAllowance", allowanceQueryKey(assetId, owner, spender));
    return value === null ? 0n : asBigInt(value, "allowance");
  }

  async listAssets(): Promise<AssetId[]> {
    const count = asBigIntOrZero(await this.queryValue("getAssetCount"), "asset count");
    const result: AssetId[] = [];
    for (let index = 0n; index < count; index += 1n) {
      result.push(asBytes(await this.queryValue("getAssetByIndex", index), "asset index"));
    }
    return result;
  }

  async getPool(assetA: AssetId, assetB: AssetId): Promise<Pool | null> {
    const key = canonicalPoolKey(assetA, assetB);
    return asPool(await this.queryValue("getPool", key), key);
  }

  async listPools(options: { offset?: bigint; limit?: number } = {}): Promise<Pool[]> {
    const count = asBigIntOrZero(await this.queryValue("getPoolCount"), "pool count");
    const offset = options.offset ?? 0n;
    const limit = options.limit ?? 50;
    if (offset < 0n || offset > count) throw new RangeError("pool offset is outside the indexed range");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("pool limit must be an integer from 1 to 100");
    const end = offset + BigInt(limit) < count ? offset + BigInt(limit) : count;
    const result: Pool[] = [];
    for (let index = offset; index < end; index += 1n) {
      const value = await this.queryValue("getPoolByIndex", index);
      if (!value || typeof value !== "object" || value instanceof Uint8Array || Array.isArray(value)) {
        throw new Error("pool index query did not return a PoolKey");
      }
      const key = value as Record<string, LocusValue>;
      const pool = await this.getPool(asBytes(key.asset0, "pool asset0"), asBytes(key.asset1, "pool asset1"));
      if (!pool) throw new Error("indexed pool does not exist");
      result.push(pool);
    }
    return result;
  }

  pool(assetA: AssetId, assetB: AssetId): BoundPool {
    const key = canonicalPoolKey(assetA, assetB);
    return new BoundPool(this, key.asset0, key.asset1);
  }

  async createPool(assetA: AssetId, assetB: AssetId, amountA: Amount, amountB: Amount): Promise<SubmitActionResult> {
    canonicalPoolKey(assetA, assetB);
    assertPoolReserve(amountA, "amountA");
    assertPoolReserve(amountB, "amountB");
    if (amountA === 0n || amountB === 0n) throw locusError(LOCUS_ERROR_CODES.INVALID_LIQUIDITY_AMOUNT);
    const initialShares = quoteInitialLiquidity(amountA, amountB).sharesMinted;
    return this.submit("createPool", { assetA, assetB, amountA, amountB, initialShares });
  }

  async addPoolLiquidity(assetA: AssetId, assetB: AssetId, maxAmountA: Amount, maxAmountB: Amount, minShares: Amount): Promise<SubmitActionResult> {
    canonicalPoolKey(assetA, assetB);
    assertPoolReserve(maxAmountA, "maxAmountA");
    assertPoolReserve(maxAmountB, "maxAmountB");
    assertAmount(minShares, "minShares");
    if (maxAmountA === 0n || maxAmountB === 0n) throw locusError(LOCUS_ERROR_CODES.INVALID_LIQUIDITY_AMOUNT);
    const pool = await this.getPool(assetA, assetB);
    if (!pool) throw locusError(LOCUS_ERROR_CODES.POOL_NOT_FOUND);
    const assetAIs0 = compareAssetIds(assetA, pool.asset0) === 0;
    const maxAmount0 = assetAIs0 ? maxAmountA : maxAmountB;
    const maxAmount1 = assetAIs0 ? maxAmountB : maxAmountA;
    const quote = pool.totalShares === 0n
      ? quoteInitialLiquidity(maxAmount0, maxAmount1)
      : calculateAddLiquidity(pool.reserve0, pool.reserve1, pool.totalShares, maxAmount0, maxAmount1);
    const amountAUsed = assetAIs0 ? quote.amount0Used : quote.amount1Used;
    const amountBUsed = assetAIs0 ? quote.amount1Used : quote.amount0Used;
    const initialShares = pool.totalShares === 0n ? quote.sharesMinted : 0n;
    return this.submit("addPoolLiquidity", {
      assetA,
      assetB,
      maxAmountA,
      maxAmountB,
      amountAUsed,
      amountBUsed,
      sharesMinted: quote.sharesMinted,
      minShares,
      initialShares,
    });
  }

  async removePoolLiquidity(assetA: AssetId, assetB: AssetId, shares: Amount, minAmountA: Amount, minAmountB: Amount): Promise<SubmitActionResult> {
    canonicalPoolKey(assetA, assetB);
    assertAmount(shares, "shares");
    assertAmount(minAmountA, "minAmountA");
    assertAmount(minAmountB, "minAmountB");
    if (shares === 0n) throw locusError(LOCUS_ERROR_CODES.INVALID_LIQUIDITY_AMOUNT);
    const session = this.requireSession();
    const pool = await this.getPool(assetA, assetB);
    if (!pool) throw locusError(LOCUS_ERROR_CODES.POOL_NOT_FOUND);
    const ownerShares = await this.liquiditySharesOf(assetA, assetB, session.subject);
    const quote = calculateRemoveLiquidity(pool.reserve0, pool.reserve1, pool.totalShares, ownerShares, shares);
    const assetAIs0 = compareAssetIds(assetA, pool.asset0) === 0;
    return this.submit("removePoolLiquidity", {
      assetA,
      assetB,
      shares,
      amountAOut: assetAIs0 ? quote.amount0 : quote.amount1,
      amountBOut: assetAIs0 ? quote.amount1 : quote.amount0,
      minAmountA,
      minAmountB,
    });
  }

  async liquiditySharesOf(assetA: AssetId, assetB: AssetId, owner: Ownership): Promise<Amount> {
    const key = canonicalPoolKey(assetA, assetB);
    assertOwnership(owner, "owner");
    const value = await this.queryValue("getLiquidityShares", { ...key, ownerKey: ownershipKey(owner) });
    return asBigIntOrZero(value, "liquidity shares");
  }

  async liquidityPositionCount(owner: Ownership): Promise<Amount> {
    assertOwnership(owner, "owner");
    return asBigIntOrZero(await this.queryValue("getLiquidityPositionCount", ownershipKey(owner)), "liquidity position count");
  }

  async quoteAddLiquidity(assetA: AssetId, assetB: AssetId, maxAmountA: Amount, maxAmountB: Amount): Promise<AddLiquidityQuote> {
    const key = canonicalPoolKey(assetA, assetB);
    const isA0 = compareAssetIds(assetA, key.asset0) === 0;
    const maxAmount0 = isA0 ? maxAmountA : maxAmountB;
    const maxAmount1 = isA0 ? maxAmountB : maxAmountA;
    const pool = await this.getPool(key.asset0, key.asset1);
    if (!pool) return quoteInitialLiquidity(maxAmount0, maxAmount1);
    return calculateAddLiquidity(pool.reserve0, pool.reserve1, pool.totalShares, maxAmount0, maxAmount1);
  }

  async quoteRemoveLiquidity(assetA: AssetId, assetB: AssetId, owner: Ownership, shares: Amount): Promise<RemoveLiquidityQuote> {
    const pool = await this.getPool(assetA, assetB);
    if (!pool) throw locusError(LOCUS_ERROR_CODES.POOL_NOT_FOUND);
    const ownerShares = await this.liquiditySharesOf(assetA, assetB, owner);
    return calculateRemoveLiquidity(pool.reserve0, pool.reserve1, pool.totalShares, ownerShares, shares);
  }

  async listLiquidityPositions(owner: Ownership, options: { offset?: bigint; limit?: number } = {}): Promise<LiquidityPosition[]> {
    assertOwnership(owner, "owner");
    const ownerId = ownershipKey(owner);
    const count = await this.liquidityPositionCount(owner);
    const offset = options.offset ?? 0n;
    const limit = options.limit ?? 50;
    if (offset < 0n || offset > count) throw new RangeError("position offset is outside the indexed range");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("position limit must be an integer from 1 to 100");
    const end = offset + BigInt(limit) < count ? offset + BigInt(limit) : count;
    const positions: LiquidityPosition[] = [];
    for (let index = offset; index < end; index += 1n) {
      const value = await this.queryValue("getLiquidityPositionByIndex", { ownerKey: ownerId, index });
      if (!value || typeof value !== "object" || value instanceof Uint8Array || Array.isArray(value)) throw new Error("liquidity position index did not return a PoolKey");
      const poolKey = value as Record<string, LocusValue>;
      const asset0 = asBytes(poolKey.asset0, "position asset0");
      const asset1 = asBytes(poolKey.asset1, "position asset1");
      const shares = await this.liquiditySharesOf(asset0, asset1, owner);
      if (shares === 0n) continue;
      const pool = await this.getPool(asset0, asset1);
      if (!pool) throw new Error("liquidity position points to a missing pool");
      positions.push({
        pool,
        shares,
        amount0: shares === pool.totalShares ? pool.reserve0 : pool.reserve0 * shares / pool.totalShares,
        amount1: shares === pool.totalShares ? pool.reserve1 : pool.reserve1 * shares / pool.totalShares,
      });
    }
    return positions;
  }

  async swapExactIn(assetIn: AssetId, assetOut: AssetId, amountIn: Amount, minAmountOut: Amount): Promise<SubmitActionResult> {
    canonicalPoolKey(assetIn, assetOut);
    assertPoolReserve(amountIn, "amountIn");
    assertAmount(minAmountOut, "minAmountOut");
    if (amountIn === 0n) throw locusError(LOCUS_ERROR_CODES.INVALID_SWAP_AMOUNT);
    return this.submit("swapExactIn", { assetIn, assetOut, amountIn, minAmountOut });
  }

  async quoteExactIn(assetIn: AssetId, assetOut: AssetId, amountIn: Amount): Promise<ExactInQuote> {
    const pool = await this.getPool(assetIn, assetOut);
    if (!pool) throw locusError(LOCUS_ERROR_CODES.POOL_NOT_FOUND);
    const assetInIs0 = compareAssetIds(assetIn, pool.asset0) === 0;
    return quoteExactIn(assetInIs0 ? pool.reserve0 : pool.reserve1, assetInIs0 ? pool.reserve1 : pool.reserve0, amountIn);
  }

  async quoteAddLiquidityForPool(asset0: AssetId, asset1: AssetId, maxAmount0: Amount, maxAmount1: Amount): Promise<AddLiquidityQuote> {
    const pool = await this.getPool(asset0, asset1);
    if (!pool) return quoteInitialLiquidity(maxAmount0, maxAmount1);
    return calculateAddLiquidity(pool.reserve0, pool.reserve1, pool.totalShares, maxAmount0, maxAmount1);
  }

  async quoteRemoveLiquidityForPool(asset0: AssetId, asset1: AssetId, owner: Ownership, shares: Amount): Promise<RemoveLiquidityQuote> {
    return this.quoteRemoveLiquidity(asset0, asset1, owner, shares);
  }

  asset(assetId: AssetId): BoundAsset {
    assertId(assetId, "assetId");
    return new BoundAsset(this, assetId);
  }
}

export class BoundPool {
  constructor(private readonly client: LocusClient, readonly asset0: AssetId, readonly asset1: AssetId) {}

  get(): Promise<Pool | null> { return this.client.getPool(this.asset0, this.asset1); }
  quoteExactIn(assetIn: AssetId, amountIn: Amount): Promise<ExactInQuote> {
    return this.client.quoteExactIn(assetIn, compareAssetIds(assetIn, this.asset0) === 0 ? this.asset1 : this.asset0, amountIn);
  }
  swapExactIn(assetIn: AssetId, amountIn: Amount, minAmountOut: Amount): Promise<SubmitActionResult> {
    return this.client.swapExactIn(assetIn, compareAssetIds(assetIn, this.asset0) === 0 ? this.asset1 : this.asset0, amountIn, minAmountOut);
  }
  addLiquidity(maxAmount0: Amount, maxAmount1: Amount, minShares: Amount): Promise<SubmitActionResult> {
    return this.client.addPoolLiquidity(this.asset0, this.asset1, maxAmount0, maxAmount1, minShares);
  }
  removeLiquidity(shares: Amount, minAmount0: Amount, minAmount1: Amount): Promise<SubmitActionResult> {
    return this.client.removePoolLiquidity(this.asset0, this.asset1, shares, minAmount0, minAmount1);
  }
  sharesOf(owner: Ownership): Promise<Amount> {
    return this.client.liquiditySharesOf(this.asset0, this.asset1, owner);
  }
  quoteAddLiquidity(maxAmount0: Amount, maxAmount1: Amount): Promise<AddLiquidityQuote> {
    return this.client.quoteAddLiquidityForPool(this.asset0, this.asset1, maxAmount0, maxAmount1);
  }
  quoteRemoveLiquidity(owner: Ownership, shares: Amount): Promise<RemoveLiquidityQuote> {
    return this.client.quoteRemoveLiquidityForPool(this.asset0, this.asset1, owner, shares);
  }
}

export class BoundAsset {
  constructor(private readonly client: LocusClient, readonly assetId: AssetId) {}

  private async metadata(): Promise<Asset> {
    const asset = await this.client.getAsset(this.assetId);
    if (!asset) throw locusError(LOCUS_ERROR_CODES.ASSET_NOT_FOUND);
    return asset;
  }

  async name(): Promise<string> {
    return decodeAssetName((await this.metadata()).name);
  }

  async symbol(): Promise<string> {
    return decodeAssetSymbol((await this.metadata()).symbol);
  }

  async decimals(): Promise<number> {
    return (await this.metadata()).decimals;
  }

  async issuer(): Promise<Ownership> {
    return (await this.metadata()).issuer;
  }

  async totalSupply(): Promise<Amount> {
    return (await this.metadata()).totalSupply;
  }

  balanceOf(owner: Ownership): Promise<Amount> {
    return this.client.balanceOf(this.assetId, owner);
  }

  transfer(to: Ownership, amount: Amount): Promise<SubmitActionResult> {
    return this.client.transfer(this.assetId, to, amount);
  }

  approve(spender: Ownership, amount: Amount): Promise<SubmitActionResult> {
    return this.client.approve(this.assetId, spender, amount);
  }

  allowance(owner: Ownership, spender: Ownership): Promise<Amount> {
    return this.client.allowance(this.assetId, owner, spender);
  }

  transferFrom(from: Ownership, to: Ownership, amount: Amount): Promise<SubmitActionResult> {
    return this.client.transferFrom(this.assetId, from, to, amount);
  }

  mint(to: Ownership, amount: Amount): Promise<SubmitActionResult> {
    return this.client.mint(this.assetId, to, amount);
  }

  burn(amount: Amount): Promise<SubmitActionResult> {
    return this.client.burn(this.assetId, amount);
  }
}
