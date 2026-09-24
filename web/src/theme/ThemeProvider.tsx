import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useAppKitTheme } from "@reown/appkit/react";
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from "./theme.js";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try { return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return "system"; }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolvedTheme = resolveTheme(preference, systemDark);
  const { setThemeMode } = useAppKitTheme();

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); }
    catch { /* Theme remains active for this page even if storage is unavailable. */ }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent | MediaQueryList) => setSystemDark(event.matches);
    update(media);
    if (media.addEventListener) media.addEventListener("change", update);
    else media.addListener(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", update);
      else media.removeListener(update);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const colorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (colorMeta) colorMeta.content = resolvedTheme === "dark" ? "#0c0d10" : "#f8f9fc";
  }, [resolvedTheme]);

  useEffect(() => {
    setThemeMode(resolvedTheme);
  }, [resolvedTheme, setThemeMode]);

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
