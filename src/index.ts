import { INSTANCES } from "./instances";
import { checkInstance, type InstanceStatus } from "./foundry";
import { syncInstanceImage, readCachedImage } from "./images";

export interface Env {
  STATUS_KV: KVNamespace;
  ASSETS: Fetcher;
}

const STALE_AFTER_MS = 5 * 60 * 1000;
const INSTANCE_IDS = new Set(INSTANCES.map((instance) => instance.id));

function kvKey(id: string): string {
  return `status:${id}`;
}

/**
 * Checks one instance, resolves its card image through the local cache
 * (see images.ts — downloads + hashes it, keeping the last known-good copy
 * if the instance is unreachable right now), and persists the combined
 * result to KV.
 */
async function checkAndStore(env: Env, instance: (typeof INSTANCES)[number]): Promise<InstanceStatus> {
  const result = await checkInstance(instance);
  const imageUrl = await syncInstanceImage(env, instance.id, result.imageUrl);
  const final: InstanceStatus = { ...result, imageUrl };
  await env.STATUS_KV.put(kvKey(instance.id), JSON.stringify(final), {
    expirationTtl: 3600,
  });
  return final;
}

async function runAllChecks(env: Env): Promise<InstanceStatus[]> {
  return Promise.all(INSTANCES.map((instance) => checkAndStore(env, instance)));
}

async function handleStatus(env: Env, ctx: ExecutionContext): Promise<Response> {
  const results: InstanceStatus[] = [];
  let needsBackgroundRefresh = false;

  for (const instance of INSTANCES) {
    const raw = await env.STATUS_KV.get(kvKey(instance.id));
    if (raw) {
      const parsed = JSON.parse(raw) as InstanceStatus;
      results.push(parsed);
      if (Date.now() - new Date(parsed.checkedAt).getTime() > STALE_AFTER_MS) {
        needsBackgroundRefresh = true;
      }
    } else {
      // First ever request for this instance: check synchronously so the
      // first visitor doesn't see a blank card.
      results.push(await checkAndStore(env, instance));
    }
  }

  if (needsBackgroundRefresh) {
    ctx.waitUntil(runAllChecks(env));
  }

  return new Response(
    JSON.stringify({ instances: results, generatedAt: new Date().toISOString() }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

async function handleImage(env: Env, request: Request, instanceId: string): Promise<Response> {
  if (!INSTANCE_IDS.has(instanceId)) {
    return new Response("Not found", { status: 404 });
  }

  const cached = await readCachedImage(env, instanceId);
  if (!cached) {
    return new Response("Not found", { status: 404 });
  }

  const etag = `"${cached.meta.hash}"`;
  const headers = {
    "content-type": cached.meta.contentType,
    "cache-control": "public, max-age=300",
    etag,
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(cached.bytes, { headers });
}

const IMAGE_PATH_PATTERN = /^\/api\/image\/([a-z0-9_-]+)$/i;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/status") {
      return handleStatus(env, ctx);
    }

    const imageMatch = url.pathname.match(IMAGE_PATH_PATTERN);
    if (imageMatch) {
      return handleImage(env, request, imageMatch[1]);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAllChecks(env));
  },
} satisfies ExportedHandler<Env>;
