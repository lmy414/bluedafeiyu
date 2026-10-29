const requests = new Map();
export function loadArchiveData() {
  const locale = /^\/(en|ja)(?:\/|$)/.exec(location.pathname)?.[1] || 'zh';
  if (!requests.has(locale)) {
    const request = fetch(`/archive-data/${locale}.json?v=2`).then(response => {
      if (!response.ok) throw new Error('data');
      return response.json();
    }).catch(error => { requests.delete(locale); throw error; });
    requests.set(locale,request);
  }
  return requests.get(locale);
}
