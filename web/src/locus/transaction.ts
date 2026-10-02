import type { SubmitActionResult } from "@jamscript/client";
import type { TransactionLifecycleUpdate } from "@jamscript/client";
import type { LocusClient, Ownership, AssetId } from "@archelabs/locus";
import type { PendingOperationTracker } from "./pendingOperations.js";

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
  tracking?: PendingOperationTracker,
  onLifecycleUpdate?: (update: TransactionLifecycleUpdate) => void,
): Promise<Extract<SendState, { status: "applied" }>> {
  let submitted: SubmitActionResult | undefined;
  try {
    submitted = await locus.transfer(assetId, recipient, amount, tracking?.submissionOptions);
    tracking?.onSubmitted(submitted);
    onSubmitted(submitted);
    const result = await locus.waitForFinalized(submitted.transactionId, {
      actionHash: submitted.actionHash,
      intervalMs: 500,
      timeoutMs: 180_000,
      onUpdate: (update) => {
        tracking?.onUpdate(update);
        onLifecycleUpdate?.(update);
        if (update.confirmation === "best") onBestIncluded?.();
      },
    });
    tracking?.onFinalized(result);
    if (result.actionReceipt.status !== "applied") {
      throw new Error(`Transaction failed${result.actionReceipt.errorCode === null ? "" : ` (error ${result.actionReceipt.errorCode})`}`);
    }
    return { status: "applied", transactionId: submitted.transactionId, actionHash: submitted.actionHash, networkId };
  } catch (error) {
    tracking?.onSubmissionUnknown(error);
    throw error;
  }
}
