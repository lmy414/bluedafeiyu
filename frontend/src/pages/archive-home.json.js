import { archiveData, archiveContext } from '../lib/archive.mjs';
import { site } from '../lib/site.mjs';
import { homeArchiveData } from '../lib/client-data.mjs';
export function GET() {
  return new Response(JSON.stringify(homeArchiveData({...archiveData, works:archiveContext.galleryWorks},site)),{headers:{'Content-Type':'application/json'}});
}
