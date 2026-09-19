import { INSTANCES } from "./instances";
import { checkInstance, type InstanceStatus } from "./foundry";

export interface Env {
  STATUS_KV: KVNamespace;
  ASSETS: Fetcher;
}

const STALE_AFTER_MS = 5 * 60 * 1000;

function kvKey(id: string): string {
  return `status:${id}`;
}

async function runAllChecks(env: Env): Promise<InstanceStatus[]> {
  return Promise.all(
    INSTANCES.map(async (instance) => {
      const prevRaw = await env.STATUS_KV.get(kvKey(instance.id));
      const prev = prevRaw ? (JSON.parse(prevRaw) as InstanceStatus) : null;
      const result = await checkInstance(instance, prev?.imageUrl ?? null);
      await env.STATUS_KV.put(kvKey(instance.id), JSON.stringify(result), {
        expirationTtl: 3600,
      });
      return result;
    }),
  );
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
      const result = await checkInstance(instance, null);
      await env.STATUS_KV.put(kvKey(instance.id), JSON.stringify(result), {
        expirationTtl: 3600,
      });
      results.push(result);
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") {
      return handleStatus(env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAllChecks(env));
  },
} satisfies ExportedHandler<Env>;
