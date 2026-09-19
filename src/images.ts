export interface Env {
  STATUS_KV: KVNamespace;
}

export interface CachedImageMeta {
  contentType: string;
  hash: string;
  fetchedAt: string;
  sourceUrl: string;
}

const FETCH_TIMEOUT_MS = 8000;
// Foundry join-screen backgrounds are typically a few hundred KB; this caps
// what we'll pull into a KV value (KV's own hard limit is 25 MiB).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function metaKey(instanceId: string): string {
  return `image-meta:${instanceId}`;
}

function bytesKey(instanceId: string): string {
  return `image-bytes:${instanceId}`;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hasCachedImage(env: Env, instanceId: string): Promise<boolean> {
  return (await env.STATUS_KV.get(metaKey(instanceId))) !== null;
}

/**
 * Makes sure the instance's card image is available from our own cache.
 *
 * If `sourceUrl` points at a fresh image, downloads it and, only when its
 * content actually differs from what's cached (compared by SHA-256), writes
 * the new bytes + metadata to KV. If the download fails, is unreachable, or
 * `sourceUrl` is null (e.g. the instance is offline this check), the
 * previously cached image — if any — is kept as-is so the card keeps
 * showing a real image instead of going blank.
 *
 * Returns the local `/api/image/<id>` URL the frontend should use, or null
 * if we've never managed to cache an image for this instance.
 */
export async function syncInstanceImage(
  env: Env,
  instanceId: string,
  sourceUrl: string | null,
): Promise<string | null> {
  const localUrl = `/api/image/${instanceId}`;

  if (!sourceUrl) {
    return (await hasCachedImage(env, instanceId)) ? localUrl : null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(sourceUrl, { signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return (await hasCachedImage(env, instanceId)) ? localUrl : null;
  }
  clearTimeout(timer);

  const contentType = resp.headers.get("content-type") ?? "";
  if (!resp.ok || !contentType.startsWith("image/")) {
    return (await hasCachedImage(env, instanceId)) ? localUrl : null;
  }

  const buffer = await resp.arrayBuffer().catch(() => null);
  if (!buffer || buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    return (await hasCachedImage(env, instanceId)) ? localUrl : null;
  }

  const hash = await sha256Hex(buffer);
  const existingMetaRaw = await env.STATUS_KV.get(metaKey(instanceId));
  const existingMeta = existingMetaRaw ? (JSON.parse(existingMetaRaw) as CachedImageMeta) : null;

  if (existingMeta && existingMeta.hash === hash) {
    return localUrl; // unchanged since last check, nothing to write
  }

  const meta: CachedImageMeta = {
    contentType,
    hash,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
  };

  await env.STATUS_KV.put(bytesKey(instanceId), buffer);
  await env.STATUS_KV.put(metaKey(instanceId), JSON.stringify(meta));

  return localUrl;
}

export interface CachedImage {
  bytes: ArrayBuffer;
  meta: CachedImageMeta;
}

export async function readCachedImage(env: Env, instanceId: string): Promise<CachedImage | null> {
  const metaRaw = await env.STATUS_KV.get(metaKey(instanceId));
  if (!metaRaw) return null;

  const bytes = await env.STATUS_KV.get(bytesKey(instanceId), "arrayBuffer");
  if (!bytes) return null;

  return { bytes, meta: JSON.parse(metaRaw) as CachedImageMeta };
}
