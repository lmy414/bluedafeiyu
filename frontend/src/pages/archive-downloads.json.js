import {archiveData, archiveContext} from '../lib/archive.mjs';
import {downloadArchiveData} from '../lib/client-data.mjs';
export function GET() {
  return new Response(JSON.stringify(downloadArchiveData({...archiveData, works:archiveContext.galleryWorks})),{headers:{'Content-Type':'application/json'}});
}
