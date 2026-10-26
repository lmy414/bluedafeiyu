import {archiveData} from '../lib/archive.mjs';
import {downloadArchiveData} from '../lib/client-data.mjs';
export function GET() {
  return new Response(JSON.stringify(downloadArchiveData(archiveData)),{headers:{'Content-Type':'application/json'}});
}
