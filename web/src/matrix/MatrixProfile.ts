import { createClient } from "matrix-js-sdk";

export type MatrixProfile = { displayName: string | null; avatarUrl: string | null };

const profileCache = new Map<string, Promise<MatrixProfile>>();

export function loadMatrixProfile(homeserver: string, userId: string): Promise<MatrixProfile> {
  const baseUrl = homeserver.replace(/\/$/, "");
  const cacheKey = `${baseUrl}|${userId}`;
  const cached = profileCache.get(cacheKey);
  if (cached) return cached;

  const client = createClient({ baseUrl });
  const request = client.getProfileInfo(userId).then((profile) => {
    const mxc = profile.avatar_url;
    const avatarUrl = mxc ? client.mxcUrlToHttp(mxc, 80, 80, "crop", false, false, false) : null;
    return {
      displayName: profile.displayname?.trim() || null,
      avatarUrl: avatarUrl && /^https?:\/\//i.test(avatarUrl) ? avatarUrl : null,
    };
  }).catch((error: unknown) => {
    profileCache.delete(cacheKey);
    throw error;
  });
  profileCache.set(cacheKey, request);
  return request;
}
