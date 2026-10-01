export type SupportedLanguage = "en" | "zh-Hans" | "ja" | "de";

export function resolveLanguage(saved: string | null | undefined, browserLanguage: string | null | undefined): SupportedLanguage {
  if (saved === "en" || saved === "zh-Hans" || saved === "ja" || saved === "de") return saved;
  const normalizedBrowserLanguage = browserLanguage?.toLowerCase() ?? "";
  if (normalizedBrowserLanguage.startsWith("zh")) return "zh-Hans";
  if (normalizedBrowserLanguage.startsWith("ja")) return "ja";
  if (normalizedBrowserLanguage.startsWith("de")) return "de";
  return "en";
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
