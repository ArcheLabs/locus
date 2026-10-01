export type SupportedLanguage = "en" | "zh-Hans";

export function resolveLanguage(saved: string | null | undefined, browserLanguage: string | null | undefined): SupportedLanguage {
  if (saved === "en" || saved === "zh-Hans") return saved;
  return browserLanguage?.toLowerCase().startsWith("zh") ? "zh-Hans" : "en";
}

export type AssetBalanceUiState = "known" | "loading" | "failed" | "signed-out";

export function resolveAssetBalanceUiState(input: {
  hasSession: boolean;
  hasData: boolean;
  enabled: boolean;
  fetching: boolean;
}): AssetBalanceUiState {
  if (input.hasData) return "known";
  if (!input.hasSession) return "signed-out";
  if (!input.enabled || input.fetching) return "loading";
  return "failed";
}
