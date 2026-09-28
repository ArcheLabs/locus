import assert from "node:assert/strict";
import test from "node:test";
import { evmOwnership, formatLocusId, toHex } from "@archelabs/locus";
import { activityFilters, BROWSER_LOCAL_ACTIVITY_CAPABILITIES, includeActivityItem } from "../web/src/activity/activityTypes.ts";
import { compactValue } from "../web/src/components/valueFormatting.ts";
import { validatePositiveAmount, validateRecipientText } from "../web/src/forms/validation.ts";
import { matrixStateRequiresUserInteraction } from "../web/src/matrix/MatrixInteraction.ts";
import { pathForRoute, routeFromPath } from "../web/src/navigation/routes.ts";
import { parseSlippageBps } from "../web/src/locus/swap/swapValidation.ts";

test("routes support base-path candidate Liquidity while preserving direct pages", () => {
  assert.equal(pathForRoute("liquidity", "/candidate/"), "/candidate/liquidity");
  assert.equal(routeFromPath("/candidate/liquidity", "/candidate/"), "liquidity");
  assert.equal(pathForRoute("swap", "/"), "/swap");
  assert.equal(routeFromPath("/activity", "/"), "activity");
});

test("Matrix restore does not open verification UI for an authorization that is already progressing", () => {
  assert.equal(matrixStateRequiresUserInteraction("CONTROLLER_AUTHORIZING", "restore"), false);
  assert.equal(matrixStateRequiresUserInteraction("CONTROLLER_AUTHORIZATION_QUEUED", "restore"), false);
  assert.equal(matrixStateRequiresUserInteraction("READY", "restore"), false);
  assert.equal(matrixStateRequiresUserInteraction("VERIFICATION_REQUIRED", "restore"), true);
  assert.equal(matrixStateRequiresUserInteraction("VERIFICATION_CONFIRMING", "fresh"), true);
  assert.equal(matrixStateRequiresUserInteraction("VERIFICATION_CONFIRMING", "restore"), false);
});

test("amount and recipient validators reject unsafe or incomplete input", () => {
  assert.equal(validatePositiveAmount("", 6, 100_000n), "Enter an amount.");
  assert.equal(validatePositiveAmount("0", 6, 100_000n), "Amount must be greater than 0.");
  assert.equal(validatePositiveAmount("1e3", 6, 100_000n), "Enter a positive decimal amount.");
  assert.equal(validatePositiveAmount("1.0000001", 6, 100_000_000n), "This asset supports up to 6 decimal places.");
  assert.equal(validatePositiveAmount("2", 6, 1_000_000n), "Amount exceeds your available balance.");
  assert.equal(validatePositiveAmount("1", 6, null), "Your balance is unavailable. Retry the balance before continuing.");
  assert.equal(validatePositiveAmount("0.000001", 6, 1n), null);
  assert.match(validateRecipientText("@alice", "matrix"), /complete Matrix ID/);
  assert.equal(validateRecipientText("@alice:matrix.org", "matrix"), null);
});

test("custom slippage is parsed as integer basis points with strict bounds", () => {
  assert.equal(parseSlippageBps("0.01"), 1);
  assert.equal(parseSlippageBps("0.5"), 50);
  assert.equal(parseSlippageBps("50"), 5_000);
  for (const invalid of ["0", "-1", "50.01", "abc", "Infinity", "0.001"]) assert.equal(parseSlippageBps(invalid), null);
});

test("compact identities preserve complete values and copyable content", () => {
  const address = "0x78B02E176e587E163661fBe70232CCDDEb11759e";
  assert.equal(compactValue(address), "0x78B0…759e");
  const ownerId = formatLocusId(evmOwnership(address));
  assert.match(compactValue(ownerId), /^locus:.+…/);
  assert.equal(compactValue("short"), "short");
  assert.notEqual(toHex(evmOwnership(address).public), compactValue(ownerId));
});

test("browser-local Activity never claims incoming transfers or complete history", () => {
  const options = activityFilters(BROWSER_LOCAL_ACTIVITY_CAPABILITIES).map(({ value }) => value);
  assert.deepEqual(options, ["all", "sent", "swap"]);
  assert.equal(BROWSER_LOCAL_ACTIVITY_CAPABILITIES.incomingTransfers, false);
  assert.equal(BROWSER_LOCAL_ACTIVITY_CAPABILITIES.completeHistory, false);
  assert.equal(includeActivityItem("received", "all", BROWSER_LOCAL_ACTIVITY_CAPABILITIES), false);
  assert.equal(includeActivityItem("sent", "all", BROWSER_LOCAL_ACTIVITY_CAPABILITIES), true);
  assert.equal(includeActivityItem("swap", "sent", BROWSER_LOCAL_ACTIVITY_CAPABILITIES), false);
});
