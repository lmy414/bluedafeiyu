import { archiveData } from '../lib/archive.mjs';
import { publicArchiveData } from '../lib/client-data.mjs';
export function GET(){return new Response(JSON.stringify(publicArchiveData(archiveData)),{headers:{'Content-Type':'application/json'}});}
