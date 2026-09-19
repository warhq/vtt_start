import type { InstanceConfig } from "./instances";

export type StatusColor = "green" | "orange" | "red";

export interface InstanceStatus {
  id: string;
  name: string;
  host: string;
  /** The /join URL players should be sent to. */
  url: string;
  status: StatusColor;
  /**
   * Where the frontend should load the card image from. Callers of
   * `checkInstance` should treat this as the *source* image URL found on
   * the instance's own `/join` page (or its `imageOverride`) and resolve it
   * through `syncInstanceImage` (see `images.ts`) before exposing it to the
   * frontend — that step downloads and caches the bytes so the image still
   * renders while the instance itself is offline.
   */
  imageUrl: string | null;
  checkedAt: string;
  detail: string;
  /** Foundry's world title for the currently active world — the campaign name. */
  world: string | null;
  /** Foundry game system id, e.g. "coc7", "pf2e". */
  system: string | null;
  /** Number of currently connected users, if Foundry's /api/status reports it. */
  players: number | null;
}

const FETCH_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

// Foundry's markup for the /join screen background varies a bit between
// versions and custom themes, so try a handful of patterns before giving up.
const IMAGE_PATTERNS: RegExp[] = [
  // Foundry V12+: e.g. `<style>body.background { --background-url: url("/worlds/<id>/images/....jpg"); }`
  // Confirmed against a live instance — this is the one that actually
  // matches current Foundry markup, kept first so it's tried before the
  // more speculative patterns below.
  /--[\w-]*background[\w-]*\s*:\s*url\((?:"|')?([^"')]+)(?:"|')?\)/i,
  /background-image\s*:\s*url\((?:"|')?([^"')]+)(?:"|')?\)/i,
  /<img[^>]+id=["']background["'][^>]*src=["']([^"']+)["']/i,
  /<img[^>]+class=["'][^"']*\b(?:splash|background|backdrop)\b[^"']*["'][^>]*src=["']([^"']+)["']/i,
];

function extractImageUrl(html: string, origin: string): string | null {
  for (const pattern of IMAGE_PATTERNS) {
    const match = html.match(pattern);
    if (match && match[1]) {
      try {
        return new URL(match[1], origin).toString();
      } catch {
        // malformed match, try the next pattern
      }
    }
  }
  return null;
}

/**
 * Checks a single Foundry VTT instance and returns its current status.
 *
 * Uses Foundry's `/api/status` endpoint (present on modern Foundry) to learn
 * whether a world is currently active, and independently confirms `/join`
 * actually responds (as requested: reachability of the login screen itself,
 * not just the API). Falls back to scraping the `/join` HTML for older
 * Foundry versions that don't expose `/api/status`.
 */
export async function checkInstance(instance: InstanceConfig): Promise<InstanceStatus> {
  const origin = `https://${instance.host}`;
  const joinUrl = `${origin}/join`;
  const checkedAt = new Date().toISOString();

  let apiActive: boolean | null = null;
  let world: string | null = null;
  let system: string | null = null;
  let players: number | null = null;
  try {
    const statusResp = await fetchWithTimeout(`${origin}/api/status`);
    if (statusResp.ok) {
      const data = (await statusResp.json().catch(() => null)) as {
        active?: unknown;
        world?: unknown;
        system?: unknown;
        users?: unknown;
      } | null;
      if (data) {
        if (typeof data.active === "boolean") apiActive = data.active;
        if (typeof data.world === "string" && data.world) world = data.world;
        if (typeof data.system === "string" && data.system) system = data.system;
        if (typeof data.users === "number") players = data.users;
      }
    }
  } catch {
    apiActive = null; // endpoint missing/unreachable; fall back to HTML below
  }

  let joinReachable = false;
  let html = "";
  try {
    const joinResp = await fetchWithTimeout(joinUrl);
    joinReachable = joinResp.ok;
    html = await joinResp.text().catch(() => "");
  } catch {
    joinReachable = false;
  }

  let status: StatusColor;
  let detail: string;

  if (apiActive === true && joinReachable) {
    status = "green";
    detail = "Online, en värld är aktiv och /join svarar.";
  } else if (apiActive === false) {
    status = "orange";
    detail = "Online men ingen värld är startad (administrativt läge).";
  } else if (apiActive === null && joinReachable) {
    const looksLikeSetup = /id=["']setup["']|game-setup|Configuration &amp; Setup/i.test(html);
    const looksLikeJoin = /id=["']join-game["']|join-game-form|Join Game Session/i.test(html);
    if (looksLikeSetup && !looksLikeJoin) {
      status = "orange";
      detail = "Online men verkar vara i administrativt/setup-läge (uppskattat).";
    } else {
      status = "green";
      detail = "Online, /join svarar (uppskattat, /api/status saknas).";
    }
  } else {
    status = "red";
    detail = "Instansen går inte att nå.";
  }

  let imageUrl: string | null = instance.imageOverride ?? null;
  if (!imageUrl && html) {
    imageUrl = extractImageUrl(html, origin);
  }

  return {
    id: instance.id,
    name: instance.name,
    host: instance.host,
    url: joinUrl,
    status,
    imageUrl,
    checkedAt,
    detail,
    world,
    system,
    players,
  };
}
