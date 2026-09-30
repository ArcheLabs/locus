import type { SubmitActionResult } from "@jamscript/client";
import type { LocusClient, Ownership, AssetId } from "@archelabs/locus";

export type SendState =
  | { status: "idle" }
  | { status: "awaiting-signature" }
  | { status: "submitting" }
  | { status: "submitted"; transactionId: string; actionHash?: string; networkId: string }
  | { status: "applied"; transactionId: string; actionHash?: string; networkId: string }
  | { status: "failed"; error: string; networkId?: string; transactionId?: string };

export async function transferAndWait(
  locus: LocusClient,
  assetId: AssetId,
  recipient: Ownership,
  amount: bigint,
  networkId: string,
  onSubmitted: (result: SubmitActionResult) => void,
): Promise<Extract<SendState, { status: "applied" }>> {
  const submitted = await locus.transfer(assetId, recipient, amount);
  onSubmitted(submitted);
  const result = await locus.waitForAction(submitted.transactionId, { intervalMs: 500, timeoutMs: 180_000 });
  if (result.actionReceipt.status !== "applied") {
    throw new Error(`Transaction failed${result.actionReceipt.errorCode === null ? "" : ` (error ${result.actionReceipt.errorCode})`}`);
  }
  return { status: "applied", transactionId: submitted.transactionId, actionHash: submitted.actionHash, networkId };
}
