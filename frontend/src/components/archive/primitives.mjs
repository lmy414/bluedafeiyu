export function createPrimitives(ctx) {
const { translations, modelVendors } = ctx;
const esc = value => String(value ?? "").replace(/[&<>"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[s]);
const absolute = value => /^https?:/.test(value || "") ? value : "https://xn--pssy23gqgbz2d718b.com/" + String(value || "").replace(/^\//, "");
const tr = (key, zh, en = zh, ja = zh) => { translations.en['d.' + key] = en; translations.ja['d.' + key] = ja; return `<span data-i18n="d.${key}">${esc(zh)}</span>`; };
const modelVendorLine = id => {
  const vendor = modelVendors[id];
  return vendor ? `<p class="model-vendor">${tr('modelVendor', '模型发布厂商：', 'Model publisher:', 'モデル提供元：')} <a href="${esc(vendor.source)}" target="_blank" rel="noopener noreferrer">${tr('modelVendor.' + id, vendor.name, vendor.en || vendor.name, vendor.en || vendor.name)}</a></p>` : '';
};
const old = (key, text) => `<span data-i18n="${key}">${esc(text)}</span>`;
const icon = (name, size = 20) => {
  const paths = { home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>', grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', roles:'<circle cx="9" cy="8" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 4a4 4 0 0 1 0 8m3 9v-3a7 7 0 0 0-3-6"/>', book:'<path d="M3 4h7a2 2 0 0 1 2 2v15a4 4 0 0 0-4-2H3zm18 0h-7a2 2 0 0 0-2 2v15a4 4 0 0 1 4-2h5z"/>', search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>', upload:'<path d="m7 8 5-5 5 5M12 3v13M3 15v6h18v-6"/>', heart:'<path d="M20 4c-3-3-6-1-8 1-2-2-5-4-8-1-3 3-1 7 8 15 9-8 11-12 8-15z"/>', arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', close:'<path d="m5 5 14 14M5 19 19 5"/>', menu:'<path d="M3 6h18M3 12h18M3 18h18"/>', download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', moon:'<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10z"/>', spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>', link:'<path d="m9 15 6-6M8 17l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 5 0m4-1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-5 0"/>' };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
};
const button = (href, label, cls = '') => `<a class="button ${cls}" href="${esc(href)}">${label}</a>`;
const tagLink = tag => `<a class="tag" href="/search.html?q=${encodeURIComponent(tag)}">${esc(tag)}</a>`;
const workHref = w => '/works/' + w.slug + '.html';
const sectionHead = (title, sub = '', link = '', label = '') => `<div class="section-head"><div><h2><span class="marker-highlight">${title}</span></h2>${sub ? `<p>${sub}</p>` : ''}</div>${link ? `<a class="text-link" href="${link}">${label || tr('viewAll','查看全部','View all','すべて見る')}${icon('arrow',17)}</a>` : ''}</div>`;
const breadcrumbs = rows => `<nav class="breadcrumbs" aria-label="当前位置">${rows.map(([name,href])=>href ? `<a href="${href}">${name}</a>` : `<span>${name}</span>`).join('<span aria-hidden="true">/</span>')}</nav>`;
const pageHead = (eyebrow, title, desc = '', extra = '') => `<header class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1><span class="marker-highlight">${title}</span></h1>${desc ? `<p class="lede">${desc}</p>`:''}</div>${extra}</header>`;

return {esc, absolute, tr, old, icon, button, tagLink, workHref, sectionHead, breadcrumbs, pageHead, modelVendorLine};
}
