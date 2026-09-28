export const DEFAULT_MATRIX_PROVIDER = {
  id: "matrix.org",
  label: "Matrix.org",
  server: "matrix.org",
} as const;

function normalizeServerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Resolve a Matrix server name through .well-known, or accept an explicit base URL. */
export async function resolveMatrixServer(input: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const value = input.trim();
  if (!value) throw new Error("Enter a Matrix server, such as matrix.org.");

  if (/^https?:\/\//i.test(value)) {
    const explicit = normalizeServerUrl(value);
    if (!explicit) throw new Error("Enter a valid Matrix server URL.");
    return explicit;
  }
  const serverName = value.replace(/\/+$/, "");
  if (serverName.includes("://") || /[\s/?#@]/.test(serverName)) throw new Error("Enter a Matrix server name or a complete HTTPS URL.");

  const server = normalizeServerUrl(`https://${serverName}`);
  if (!server) throw new Error("Enter a valid Matrix server name.");
  try {
    const response = await fetchImpl(`${server}/.well-known/matrix/client`, { headers: { accept: "application/json" } });
    if (response.ok) {
      const document = await response.json() as { "m.homeserver"?: { base_url?: unknown } };
      const discovered = document["m.homeserver"]?.base_url;
      if (typeof discovered === "string") {
        const normalized = normalizeServerUrl(discovered);
        if (normalized) return normalized;
      }
    }
  } catch {
    // A server name remains a valid direct homeserver when well-known is absent.
  }
  return server;
}
