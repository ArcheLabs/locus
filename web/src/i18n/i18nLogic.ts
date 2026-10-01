export type SupportedLanguage = "en" | "zh-Hans" | "ja" | "de";

export function resolveLanguage(saved: string | null | undefined, browserLanguage: string | null | undefined): SupportedLanguage {
  if (saved !== null && saved !== undefined && saved.trim() !== "") {
    return saved === "en" || saved === "zh-Hans" || saved === "ja" || saved === "de" ? saved : "en";
  }

  const normalizedBrowserLanguage = browserLanguage?.trim().replaceAll("_", "-").toLowerCase() ?? "";
  if (/^en(?:-|$)/.test(normalizedBrowserLanguage)) return "en";
  if (/^ja(?:-|$)/.test(normalizedBrowserLanguage)) return "ja";
  if (/^de(?:-|$)/.test(normalizedBrowserLanguage)) return "de";
  if (/^zh(?:-hans)?(?:-|$)/.test(normalizedBrowserLanguage) && !/^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(normalizedBrowserLanguage)) return "zh-Hans";
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
