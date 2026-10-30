import {unpackArchiveCatalog} from '../components/archive-catalog.js';
const requests = new Map();
export function loadArchiveData() {
  const locale = /^\/(en|ja)(?:\/|$)/.exec(location.pathname)?.[1] || 'zh';
  if (!requests.has(locale)) {
    const request = fetch(`/archive-catalog/${locale}.json?v=2`).then(response => {
      if (!response.ok) throw new Error('data');
      return response.json().then(unpackArchiveCatalog);
    }).catch(error => { requests.delete(locale); throw error; });
    requests.set(locale,request);
  }
  return requests.get(locale);
}
