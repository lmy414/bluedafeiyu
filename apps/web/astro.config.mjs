import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

const publicUrl = process.env.PUBLIC_SITE_URL;
const publicHost = publicUrl && URL.canParse(publicUrl) ? new URL(publicUrl).hostname : undefined;
const hosts = ['127.0.0.1', 'localhost', 'xn--pssy23gqgbz2d718b.com', 'v2.xn--pssy23gqgbz2d718b.com', publicHost].filter(Boolean);

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'ignore',
  server: { host: '127.0.0.1', port: 4330 },
  security: { allowedDomains: [...new Set(hosts)].map((hostname) => ({ hostname })) },
});
