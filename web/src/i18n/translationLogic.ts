export type TranslationEntries = ReadonlyArray<readonly [key: string, value: string]>;

export function interpolateTranslation(value: string, params?: Record<string, string | number>): string {
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => params && name in params ? String(params[name]) : whole);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function translateSourceText(sourceText: string, targetEntries: TranslationEntries, sourceEntries: TranslationEntries[]): string {
  const target = new Map(targetEntries);
  const sourceMaps = sourceEntries.map((entries) => new Map(entries.map(([key, value]) => [value, key])));
  for (const sourceMap of sourceMaps) {
    const key = sourceMap.get(sourceText);
    if (key) return target.has(key) ? target.get(key)! : sourceText;
  }
  for (const entries of sourceEntries) {
    for (const [key, template] of entries) {
      if (!template.includes("{")) continue;
      const names: string[] = [];
      const pattern = template.split(/(\{[a-zA-Z0-9_]+\})/g).map((part) => {
        const parameter = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
        if (!parameter) return escapeRegExp(part);
        names.push(parameter[1]!);
        return "(.+?)";
      }).join("");
      const match = new RegExp(`^${pattern}$`).exec(sourceText);
      if (!match) continue;
      const params = Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? ""]));
      const localized = target.get(key);
      return localized ? interpolateTranslation(localized, params) : sourceText;
    }
  }
  return sourceText;
}
