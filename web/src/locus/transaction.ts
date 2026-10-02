import type { SubmitActionResult } from "@jamscript/client";
import type { LocusClient, Ownership, AssetId } from "@archelabs/locus";

export type SendState =
  | { status: "idle" }
  | { status: "awaiting-signature" }
  | { status: "submitting" }
  | { status: "submitted"; transactionId: string; actionHash?: string; networkId: string }
  | { status: "best-included"; transactionId: string; actionHash?: string; networkId: string }
  | { status: "applied"; transactionId: string; actionHash?: string; networkId: string }
  | { status: "failed"; error: string; networkId?: string; transactionId?: string };

export async function transferAndWait(
  locus: LocusClient,
  assetId: AssetId,
  recipient: Ownership,
  amount: bigint,
  networkId: string,
  onSubmitted: (result: SubmitActionResult) => void,
  onBestIncluded?: () => void,
): Promise<Extract<SendState, { status: "applied" }>> {
  const submitted = await locus.transfer(assetId, recipient, amount);
  onSubmitted(submitted);
  const best = await locus.waitForBest(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
  if (best.status === "reorged") throw new Error("The transfer was removed from the best chain. Check its status before retrying.");
  if (best.status === "failed") throw new Error(best.error ?? "Transaction failed before best-chain inclusion.");
  if (best.bestChainStatus === "included" && best.finalized !== true) onBestIncluded?.();
  const result = await locus.waitForFinalized(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
  if (result.actionReceipt.status !== "applied") {
    throw new Error(`Transaction failed${result.actionReceipt.errorCode === null ? "" : ` (error ${result.actionReceipt.errorCode})`}`);
  }
  return { status: "applied", transactionId: submitted.transactionId, actionHash: submitted.actionHash, networkId };
}
