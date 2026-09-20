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
  OwnershipSession,
} from "./types.js";

function asBigInt(value: LocusValue | null, label: string): bigint {
  if (typeof value !== "bigint") throw new Error(`${label} query did not return bigint`);
  return value;
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

function allowanceQueryKey(assetId: AssetId, owner: Ownership, spender: Ownership): LocusRecord {
  return {
    assetId,
    ownerKey: ownershipKey(owner),
    spenderKey: ownershipKey(spender),
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
    return this.session;
  }

  private async submit(
    actionName: string,
    input: Record<string, LocusValue>,
  ): Promise<SubmitActionResult> {
    try {
      const session = this.requireSession();
      return await this.jamClient.submitOwnershipAction(actionName, input, session.signer, { actAs: session.actAs });
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

  async createAsset(
    assetId: AssetId,
    name: string | Uint8Array,
    symbol: string | Uint8Array,
    decimals: number,
    initialSupply: Amount,
  ): Promise<SubmitActionResult> {
    assertId(assetId, "assetId");
    assertDecimals(decimals);
    assertAmount(initialSupply, "initialSupply");
    const nameBytes = typeof name === "string" ? encodeAssetName(name) : name;
    const symbolBytes = typeof symbol === "string" ? encodeAssetSymbol(symbol) : symbol;
    if (!(nameBytes instanceof Uint8Array) || nameBytes.length === 0 || nameBytes.length > 64) {
      throw locusError(LOCUS_ERROR_CODES.INVALID_ASSET_NAME);
    }
    if (!(symbolBytes instanceof Uint8Array) || symbolBytes.length === 0 || symbolBytes.length > 16) {
      throw locusError(LOCUS_ERROR_CODES.INVALID_ASSET_SYMBOL);
    }
    return this.submit("createAsset", {
      assetId,
      name: nameBytes,
      symbol: symbolBytes,
      decimals,
      initialSupply,
    });
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
    const count = asBigInt(await this.queryValue("getAssetCount"), "asset count");
    const result: AssetId[] = [];
    for (let index = 0n; index < count; index += 1n) {
      result.push(asBytes(await this.queryValue("getAssetByIndex", index), "asset index"));
    }
    return result;
  }

  asset(assetId: AssetId): BoundAsset {
    assertId(assetId, "assetId");
    return new BoundAsset(this, assetId);
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
