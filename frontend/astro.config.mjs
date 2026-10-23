import { defineConfig } from 'astro/config';
import {incrementalIntegration} from './scripts/incremental-integration.mjs';
export default defineConfig({ output: 'static', cacheDir:'../.build/astro-cache/', experimental:{incrementalBuild:true}, integrations:[incrementalIntegration()], build: { format: 'file' }, outDir: process.env.ASTRO_OUT_DIR || './out', site: 'https://xn--pssy23gqgbz2d718b.com' });
