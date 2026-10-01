import assert from "node:assert/strict";
import test from "node:test";
import { evmOwnership, formatLocusId, toHex } from "@archelabs/locus";
import { activityFilters, BROWSER_LOCAL_ACTIVITY_CAPABILITIES, includeActivityItem } from "../web/src/activity/activityTypes.ts";
import { compactValue } from "../web/src/components/valueFormatting.ts";
import { validatePositiveAmount, validateRecipientText } from "../web/src/forms/validation.ts";
import { matrixStateRequiresUserInteraction } from "../web/src/matrix/MatrixInteraction.ts";
import { pathForRoute, routeFromPath } from "../web/src/navigation/routes.ts";
import { isPairConfirmedUnsupported, parseSlippageBps } from "../web/src/locus/swap/swapValidation.ts";
import { resolveAssetBalanceUiState, resolveLanguage } from "../web/src/i18n/i18nLogic.ts";
import { interpolateTranslation, translateSourceText } from "../web/src/i18n/translationLogic.ts";

test("routes support base-path candidate Liquidity while preserving direct pages", () => {
  assert.equal(pathForRoute("liquidity", "/candidate/"), "/candidate/liquidity");
  assert.equal(routeFromPath("/candidate/liquidity", "/candidate/"), "liquidity");
  assert.equal(pathForRoute("liquidity-new", "/candidate/"), "/candidate/liquidity/new");
  assert.equal(routeFromPath("/candidate/liquidity/new", "/candidate/"), "liquidity-new");
  assert.equal(routeFromPath("/liquidity/new", "/"), "liquidity-new");
  assert.equal(pathForRoute("swap", "/"), "/swap");
  assert.equal(routeFromPath("/activity", "/"), "activity");
});

test("Matrix sign-in requires interaction only for unknown status recovery or verification, not authorization", () => {
  assert.equal(matrixStateRequiresUserInteraction("TRUST_CHECKING", "restore"), false);
  assert.equal(matrixStateRequiresUserInteraction("TRUST_UNKNOWN", "restore"), true);
  assert.equal(matrixStateRequiresUserInteraction("CONNECTED", "restore"), false);
  assert.equal(matrixStateRequiresUserInteraction("VERIFICATION_REQUIRED", "restore"), true);
  assert.equal(matrixStateRequiresUserInteraction("VERIFICATION_CONFIRMING", "fresh"), true);
  assert.equal(matrixStateRequiresUserInteraction("VERIFICATION_CONFIRMING", "restore"), true);
});

test("amount and recipient validators reject unsafe or incomplete input", () => {
  assert.equal(validatePositiveAmount("", 6, 100_000n), null);
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

test("language selection persists supported choices and otherwise follows browser language", () => {
  assert.equal(resolveLanguage("en", "zh-CN"), "en");
  assert.equal(resolveLanguage("zh-Hans", "en-US"), "zh-Hans");
  assert.equal(resolveLanguage("unsupported", "zh-TW"), "zh-Hans");
  assert.equal(resolveLanguage(null, "fr-FR"), "en");
});

test("notification text follows the active language, including transaction placeholders", () => {
  const en = [
    ["auth.accountAuthorizing", "Signed in. Finishing account authorization…"],
    ["notices.transactionSaved", "Transaction {transactionId} was received and saved."],
  ];
  const zh = [
    ["auth.accountAuthorizing", "已登录，正在完成账户授权…"],
    ["notices.transactionSaved", "已收到并保存交易 {transactionId}。"],
  ];
  assert.equal(translateSourceText(en[0][1], zh, [en, zh]), zh[0][1]);
  assert.equal(translateSourceText("Transaction 0xabc was received and saved.", zh, [en, zh]), "已收到并保存交易 0xabc。");
  assert.equal(translateSourceText("Unmapped notice", zh, [en, zh]), "Unmapped notice");
  assert.equal(interpolateTranslation("Balance: {amount} {symbol}", { amount: "0", symbol: "DOT" }), "Balance: 0 DOT");
});

test("balance presentation distinguishes signed-out, loading, failed, and real zero balances", () => {
  assert.equal(resolveAssetBalanceUiState({ hasSession: false, hasData: false, enabled: false, fetching: false }), "signed-out");
  assert.equal(resolveAssetBalanceUiState({ hasSession: true, hasData: false, enabled: false, fetching: false }), "loading");
  assert.equal(resolveAssetBalanceUiState({ hasSession: true, hasData: false, enabled: true, fetching: true }), "loading");
  assert.equal(resolveAssetBalanceUiState({ hasSession: true, hasData: false, enabled: true, fetching: false }), "failed");
  assert.equal(resolveAssetBalanceUiState({ hasSession: true, hasData: true, enabled: true, fetching: false }), "known");
});

test("Swap only marks a pair unsupported after a successful completed lookup", () => {
  const base = { networkMode: true, hasInput: true, hasOutput: true, sameAsset: false, loading: false, error: false, hasPool: false, hasReserves: false };
  assert.equal(isPairConfirmedUnsupported(base), true);
  assert.equal(isPairConfirmedUnsupported({ ...base, loading: true }), false);
  assert.equal(isPairConfirmedUnsupported({ ...base, error: true }), false);
  assert.equal(isPairConfirmedUnsupported({ ...base, hasPool: true, hasReserves: true }), false);
  assert.equal(isPairConfirmedUnsupported({ ...base, sameAsset: true }), false);
  assert.equal(isPairConfirmedUnsupported({ ...base, networkMode: false }), false);
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
