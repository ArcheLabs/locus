import { readStoredMatrixSession } from "./MatrixConnector.js";

export type MatrixProfile = {
  displayName: string | null;
  avatarUrl: string | null;
  dispose: () => void;
};

const MAX_AVATAR_BYTES = 1_048_576;
const PROFILE_TIMEOUT_MS = 8_000;

function apiUrl(homeserver: string, path: string): string {
  const base = new URL(homeserver);
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return new URL(path.replace(/^\/+/, ""), `${base.origin}${basePath}`).toString();
}

function parseMxcUri(value: string): { serverName: string; mediaId: string } | null {
  try {
    const mxc = new URL(value);
    if (mxc.protocol !== "mxc:" || !mxc.hostname || !mxc.pathname || mxc.search || mxc.hash) return null;
    const mediaId = decodeURIComponent(mxc.pathname.slice(1));
    if (!mediaId || mediaId.includes("/")) return null;
    return { serverName: mxc.host, mediaId };
  } catch {
    return null;
  }
}

async function readImage(response: Response): Promise<Blob | null> {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("image/")) return null;
  const announcedSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_AVATAR_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AVATAR_BYTES) {
        await reader.cancel();
        return null;
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
    }
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "image/*" });
  } finally {
    reader.releaseLock();
  }
}

export async function loadMatrixProfile(homeserver: string, userId: string): Promise<MatrixProfile> {
  const stored = readStoredMatrixSession();
  if (!stored
    || stored.userId !== userId
    || stored.homeserver.replace(/\/$/, "") !== homeserver.replace(/\/$/, "")) {
    return { displayName: null, avatarUrl: null, dispose: () => undefined };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);
  let avatarUrl: string | null = null;
  try {
    const headers = { Authorization: `Bearer ${stored.accessToken}` };
    const profileResponse = await fetch(
      apiUrl(homeserver, `/_matrix/client/v3/profile/${encodeURIComponent(userId)}`),
      { headers, signal: controller.signal, redirect: "error", credentials: "omit" },
    );
    if (!profileResponse.ok) return { displayName: null, avatarUrl: null, dispose: () => undefined };
    const profile = await profileResponse.json() as { displayname?: unknown; avatar_url?: unknown };
    const displayName = typeof profile.displayname === "string" ? profile.displayname.trim() || null : null;
    if (typeof profile.avatar_url === "string") {
      const mxc = parseMxcUri(profile.avatar_url);
      if (mxc) {
        const query = new URLSearchParams({ width: "96", height: "96", method: "crop" });
        const mediaPath = `/_matrix/client/v1/media/thumbnail/${encodeURIComponent(mxc.serverName)}/${encodeURIComponent(mxc.mediaId)}?${query}`;
        const mediaResponse = await fetch(apiUrl(homeserver, mediaPath), {
          headers,
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
        });
        const image = await readImage(mediaResponse);
        if (image) avatarUrl = URL.createObjectURL(image);
      }
    }
    return {
      displayName,
      avatarUrl,
      dispose: () => { if (avatarUrl) URL.revokeObjectURL(avatarUrl); },
    };
  } catch {
    if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    return { displayName: null, avatarUrl: null, dispose: () => undefined };
  } finally {
    window.clearTimeout(timeout);
  }
}
