import { overlayData } from '../lib/v2.mjs';
export function GET() { return new Response(JSON.stringify(overlayData()), { headers: { 'Content-Type': 'application/json' } }); }
