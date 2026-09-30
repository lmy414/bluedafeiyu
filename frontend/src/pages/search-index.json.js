import { searchIndex } from '../lib/v2.mjs';
export function GET() { return new Response(JSON.stringify(searchIndex()), { headers: { 'Content-Type': 'application/json' } }); }
