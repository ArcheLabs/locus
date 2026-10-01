import { LoaderCircle } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.js";

export type BalanceState = "known" | "loading" | "failed" | "signed-out";

export function AssetBalanceStatus({ state, amount, symbol }: {
  state: BalanceState;
  amount?: string;
  symbol?: string;
}) {
  const { t } = useI18n();
  if (state === "known") return <span>{t("common.balanceAmount", { amount: amount ?? "0", symbol: symbol ?? "" })}</span>;
  if (state === "loading") return <span role="status"><LoaderCircle className="action-button__icon--loading" size={13} aria-hidden="true" /> {t("common.loadingBalance")}</span>;
  return null;
}
