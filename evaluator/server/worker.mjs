/* Evaluator organisation server for Cloudflare Workers.
 *
 * Settings are the Worker's variables and secrets (see README.md). Bind a KV
 * namespace as COUNTS to keep daily counts across the Worker's instances;
 * without it, counts are kept per instance, which is looser.
 */
import { handle, loadConfig, memoryStore } from './core.mjs';

const memory = memoryStore();

function kvStore(kv) {
  return {
    async get(key) { return Number(await kv.get(key)) || 0; },
    async incr(key, by, ttl) { const v = (Number(await kv.get(key)) || 0) + by; await kv.put(key, String(v), { expirationTtl: Math.max(60, ttl) }); return v; },
  };
}

export default {
  async fetch(request, env) {
    return handle(request, loadConfig(env), env.COUNTS ? kvStore(env.COUNTS) : memory, request.headers.get('cf-connecting-ip') || '');
  },
};
