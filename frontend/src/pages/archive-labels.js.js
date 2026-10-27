import { archiveTranslations } from '../lib/archive.mjs';
import { comicTranslations } from '../components/archive/ComicSeries.mjs';
export function GET() {
  const labels = Object.fromEntries(Object.entries(archiveTranslations).map(([language,values])=>[language,{...values,...comicTranslations[language]}]));
  return new Response('window.ArchiveLabels=' + JSON.stringify(labels).replace(/</g, '\\u003c') + ';', {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
  });
}
