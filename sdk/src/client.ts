import { assertId } from "./ids.js";
import { encodeAssetName, encodeAssetSymbol, decodeAssetName, decodeAssetSymbol } from "./metadata.js";
import { LOCUS_ERROR_CODES, locusError, normalizeLocusError } from "./errors.js";
import type {
  Amount,
  AssetId,
  AssetV1,
  IdentityId,
  IdentityV1,
  JamScriptLikeClient,
  LocusRecord,
  LocusValue,
} from "./types.js";

function asBigInt(value: LocusValue | null, label: string): bigint {
  if (typeof value !== "bigint") throw new Error(`${label} query did not return bigint`);
  return value;
}

function asBytes(value: LocusValue | null, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${label} query did not return bytes`);
  return value;
}

function asIdentity(value: LocusValue | null): IdentityV1 | null {
  return value as IdentityV1 | null;
}

function asAsset(value: LocusValue | null): AssetV1 | null {
  return value as AssetV1 | null;
}

function assertAmount(amount: Amount, label = "amount"): void {
  if (typeof amount !== "bigint" || amount < 0n) {
    throw new Error(`${label} must be a non-negative bigint`);
  }
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw locusError(LOCUS_ERROR_CODES.INVALID_DECIMALS);
  }
}

export class LocusClient {
  constructor(readonly jamClient: JamScriptLikeClient) {}

  private async submit(actionName: string, input: Record<string, LocusValue>): Promise<unknown> {
    try {
      return await this.jamClient.submitAction(actionName, input);
    } catch (error) {
      throw normalizeLocusError(error) ?? error;
    }
  }

  private async submitForIdentity(
    actionName: string,
    identityId: IdentityId,
    input: Record<string, LocusValue>,
  ): Promise<unknown> {
    const nonce = await this.identityNonce(identityId);
    return this.submit(actionName, { ...input, nonce });
  }

  private async queryValue(queryName: string, key?: LocusValue): Promise<LocusValue | null> {
    const result = await this.jamClient.queryLatest(queryName, key);
    return result.value;
  }

  async createIdentity(identityId: IdentityId): Promise<unknown> {
    assertId(identityId, "identityId");
    return this.submit("createIdentity", { identityId });
  }

  async rotateOwner(
    identityId: IdentityId,
    newOwnerPayload: Uint8Array,
    newOwnerScheme = 0,
  ): Promise<unknown> {
    assertId(identityId, "identityId");
    if (!(newOwnerPayload instanceof Uint8Array) || newOwnerPayload.length !== 32 || newOwnerPayload.every((byte) => byte === 0)) {
      throw locusError(LOCUS_ERROR_CODES.INVALID_OWNER);
    }
    if (!Number.isInteger(newOwnerScheme) || newOwnerScheme < 0 || newOwnerScheme > 255) {
      throw locusError(LOCUS_ERROR_CODES.UNSUPPORTED_OWNER_SCHEME);
    }
    return this.submitForIdentity("rotateOwner", identityId, {
      identityId,
      newOwnerScheme,
      newOwnerPayload,
    });
  }

  async createAsset(
    issuerId: IdentityId,
    assetId: AssetId,
    name: string | Uint8Array,
    symbol: string | Uint8Array,
    decimals: number,
    initialSupply: Amount,
  ): Promise<unknown> {
    assertId(issuerId, "issuerId");
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
    return this.submitForIdentity("createAsset", issuerId, {
      issuerId,
      assetId,
      name: nameBytes,
      symbol: symbolBytes,
      decimals,
      initialSupply,
    });
  }

  async mint(issuerId: IdentityId, assetId: AssetId, toId: IdentityId, amount: Amount): Promise<unknown> {
    assertId(issuerId, "issuerId");
    assertId(assetId, "assetId");
    assertId(toId, "toId");
    assertAmount(amount);
    return this.submitForIdentity("mint", issuerId, { issuerId, assetId, toId, amount });
  }

  async transfer(fromId: IdentityId, assetId: AssetId, toId: IdentityId, amount: Amount): Promise<unknown> {
    assertId(fromId, "fromId");
    assertId(assetId, "assetId");
    assertId(toId, "toId");
    assertAmount(amount);
    return this.submitForIdentity("transfer", fromId, { fromId, assetId, toId, amount });
  }

  async burn(fromId: IdentityId, assetId: AssetId, amount: Amount): Promise<unknown> {
    assertId(fromId, "fromId");
    assertId(assetId, "assetId");
    assertAmount(amount);
    return this.submitForIdentity("burn", fromId, { fromId, assetId, amount });
  }

  async approve(ownerId: IdentityId, assetId: AssetId, spenderId: IdentityId, amount: Amount): Promise<unknown> {
    assertId(ownerId, "ownerId");
    assertId(assetId, "assetId");
    assertId(spenderId, "spenderId");
    assertAmount(amount);
    return this.submitForIdentity("approve", ownerId, { ownerId, assetId, spenderId, amount });
  }

  async transferFrom(spenderId: IdentityId, assetId: AssetId, fromId: IdentityId, toId: IdentityId, amount: Amount): Promise<unknown> {
    assertId(spenderId, "spenderId");
    assertId(assetId, "assetId");
    assertId(fromId, "fromId");
    assertId(toId, "toId");
    assertAmount(amount);
    return this.submitForIdentity("transferFrom", spenderId, { spenderId, assetId, fromId, toId, amount });
  }

  async getIdentity(identityId: IdentityId): Promise<IdentityV1 | null> {
    assertId(identityId, "identityId");
    return asIdentity(await this.queryValue("getIdentity", identityId));
  }

  async identityNonce(identityId: IdentityId): Promise<bigint> {
    assertId(identityId, "identityId");
    if ((await this.getIdentity(identityId)) === null) {
      throw locusError(LOCUS_ERROR_CODES.IDENTITY_NOT_FOUND);
    }
    return asBigInt(await this.queryValue("getIdentityNonce", identityId), "identity nonce");
  }

  async getAsset(assetId: AssetId): Promise<AssetV1 | null> {
    assertId(assetId, "assetId");
    return asAsset(await this.queryValue("getAsset", assetId));
  }

  async balanceOf(assetId: AssetId, identityId: IdentityId): Promise<Amount> {
    assertId(assetId, "assetId");
    assertId(identityId, "identityId");
    const key: LocusRecord = { assetId, identityId };
    const value = await this.queryValue("getBalance", key);
    return value === null ? 0n : asBigInt(value, "balance");
  }

  async allowance(assetId: AssetId, ownerId: IdentityId, spenderId: IdentityId): Promise<Amount> {
    assertId(assetId, "assetId");
    assertId(ownerId, "ownerId");
    assertId(spenderId, "spenderId");
    const key: LocusRecord = { assetId, ownerId, spenderId };
    const value = await this.queryValue("getAllowance", key);
    return value === null ? 0n : asBigInt(value, "allowance");
  }

  async listIdentities(): Promise<IdentityId[]> {
    const count = asBigInt(await this.queryValue("getIdentityCount"), "identity count");
    const result: IdentityId[] = [];
    for (let index = 0n; index < count; index += 1n) {
      result.push(asBytes(await this.queryValue("getIdentityByIndex", index), "identity index"));
    }
    return result;
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

  private async metadata(): Promise<AssetV1> {
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

  async totalSupply(): Promise<Amount> {
    return (await this.metadata()).totalSupply;
  }

  balanceOf(identityId: IdentityId): Promise<Amount> {
    return this.client.balanceOf(this.assetId, identityId);
  }

  transfer(fromId: IdentityId, toId: IdentityId, amount: Amount): Promise<unknown> {
    return this.client.transfer(fromId, this.assetId, toId, amount);
  }

  approve(ownerId: IdentityId, spenderId: IdentityId, amount: Amount): Promise<unknown> {
    return this.client.approve(ownerId, this.assetId, spenderId, amount);
  }

  allowance(ownerId: IdentityId, spenderId: IdentityId): Promise<Amount> {
    return this.client.allowance(this.assetId, ownerId, spenderId);
  }

  transferFrom(spenderId: IdentityId, fromId: IdentityId, toId: IdentityId, amount: Amount): Promise<unknown> {
    return this.client.transferFrom(spenderId, this.assetId, fromId, toId, amount);
  }

  mint(issuerId: IdentityId, toId: IdentityId, amount: Amount): Promise<unknown> {
    return this.client.mint(issuerId, this.assetId, toId, amount);
  }

  burn(fromId: IdentityId, amount: Amount): Promise<unknown> {
    return this.client.burn(fromId, this.assetId, amount);
  }
}
