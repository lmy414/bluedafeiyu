import { defineConfig } from 'astro/config';
export default defineConfig({ output: 'static', build: { format: 'file' }, outDir: process.env.ASTRO_OUT_DIR || './out', site: 'https://xn--pssy23gqgbz2d718b.com' });
