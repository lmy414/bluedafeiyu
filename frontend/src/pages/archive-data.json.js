import { archiveData } from '../lib/archive.mjs';
export function GET(){return new Response(JSON.stringify(archiveData),{headers:{'Content-Type':'application/json'}});}
