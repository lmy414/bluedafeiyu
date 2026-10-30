import { archiveData } from '../../lib/archive.mjs';
import { clientArchiveData } from '../../lib/client-data.mjs';
import { packArchiveCatalog } from '../../../public/components/archive-catalog.js';
export function getStaticPaths() {
  return ['zh','en','ja'].map(locale => ({params:{locale}}));
}
export function GET({params}) {
  return new Response(JSON.stringify(packArchiveCatalog(clientArchiveData(archiveData,params.locale))),{headers:{'Content-Type':'application/json'}});
}
