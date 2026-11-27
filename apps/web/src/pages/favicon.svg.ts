import type { APIRoute } from 'astro';
import { BRAND_FAVICON_SVG } from '../../../../packages/shared/src/design/brand';

export const GET: APIRoute = () => new Response(BRAND_FAVICON_SVG, {
  headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
});
