import { LoaderCircle } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.js";

export type BalanceState = "known" | "loading" | "failed" | "signed-out";

export function AssetBalanceStatus({ state, amount, symbol, onRetry }: {
  state: BalanceState;
  amount?: string;
  symbol?: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  if (state === "known") return <span>{t("common.balanceAmount", { amount: amount ?? "0", symbol: symbol ?? "" })}</span>;
  if (state === "loading") return <span role="status"><LoaderCircle className="action-button__icon--loading" size={13} aria-hidden="true" /> {t("common.loadingBalance")}</span>;
  if (state === "signed-out") return <span role="status">— <small>{t("common.signInToViewBalance")}</small></span>;
  return <span className="asset-balance-status-failed" role="status">— <small>{t("assets.balanceUnavailable")}</small> <button type="button" className="text-button" onClick={onRetry}>{t("common.retry")}</button></span>;
}
