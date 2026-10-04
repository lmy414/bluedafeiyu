import { archiveTranslations } from '../lib/archive.mjs';
export function GET() {
  return new Response('window.ArchiveLabels=' + JSON.stringify(archiveTranslations).replace(/</g, '\\u003c') + ';', {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
  });
}
