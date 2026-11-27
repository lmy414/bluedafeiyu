import type { Config } from '../config.js';

export function createCloudflare(config: Config, request: typeof fetch = fetch) {
  async function purge(body: { files: string[] } | { prefixes: string[] }) {
    if (!config.CF_ZONE_ID || !config.CF_API_TOKEN) return;
    try {
      const response = await request(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.CF_ZONE_ID)}/purge_cache`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
      });
      const result = await response.json() as { success?: boolean };
      if (!response.ok || result.success !== true) throw new Error(`Cloudflare returned HTTP ${response.status}`);
    } catch (error) { console.error('Cloudflare cache purge failed', body, error); }
  }

  return {
    async purgePaths(paths: Iterable<string>) {
      const files = [...new Set(Array.from(paths, path => new URL(path, config.SITE_PUBLIC_URL).href))];
      for (let i = 0; i < files.length; i += 30) await purge({ files: files.slice(i, i + 30) });
    },
    async purgePrefixes(paths: Iterable<string>) {
      const prefixes = [...new Set(Array.from(paths, path => new URL(path, config.SITE_PUBLIC_URL).href.replace(/^https?:\/\//, '')))];
      for (let i = 0; i < prefixes.length; i += 30) await purge({ prefixes: prefixes.slice(i, i + 30) });
    },
  };
}
