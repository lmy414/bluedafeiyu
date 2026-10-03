/* 作品统计来自后台同步的 GA4 聚合缓存，不在浏览器中伪造累计数。 */
(function () {
  'use strict';
  var snapshot = null;
  var T = function (key, fallback, vars) { return window.SiteLang ? SiteLang.fmt(key, fallback, vars) : fallback.replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] !== undefined ? vars[k] : _; }); };
  var esc = function (value) { return String(value || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var count = function (n) { return Number(n || 0).toLocaleString(); };
  function paint() {
    document.querySelectorAll('[data-work-stats]').forEach(function (el) {
      var metrics = snapshot && snapshot.available ? snapshot.works[el.getAttribute('data-work-stats')] || { views: 0, downloads: 0 } : null;
      el.textContent = T('stats.counts', '浏览 {views} · 下载 {downloads}', { views: metrics ? count(metrics.views) : '—', downloads: metrics ? count(metrics.downloads) : '—' });
      el.title = metrics ? T('stats.updated', '统计更新：{date}；下载为按钮点击次数', { date: new Date(snapshot.syncedAt).toLocaleString() }) : T('stats.unavailable', '统计尚未同步');
    });
    document.querySelectorAll('[data-stats-note]').forEach(function (el) {
      el.textContent = snapshot && snapshot.available
        ? T('stats.note', '统计始于 {start}，更新于 {date}；下载为按钮点击次数', { start: snapshot.startDate, date: new Date(snapshot.syncedAt).toLocaleString() }) + (snapshot.stale ? ' · ' + T('stats.stale', '统计更新延迟') : '') + (snapshot.limited ? ' · ' + T('stats.limited', '部分统计受 GA4 汇总限制') : '')
        : T('stats.unavailable', '统计尚未同步');
    });
    document.querySelectorAll('[data-sort="popular"], [data-sort="downloads"]').forEach(function (el) { el.disabled = !(snapshot && snapshot.available); });
  }
  function track(name, id) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id || '')) return;
    if (typeof window.gtag === 'function') window.gtag('event', name, { work_id: id, send_to: 'G-4LWN9Z2WT2', transport_type: 'beacon' });
  }
  var ready = fetch('/cms-api/analytics/public', { credentials: 'omit', signal: AbortSignal.timeout(10000) }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (data) { snapshot = data; paint(); return data; }).catch(function () { paint(); return null; });
  window.WorkStats = {
    ready: ready, paint: paint,
    metric: function (id, mode) { return snapshot && snapshot.available && snapshot.works[id] ? snapshot.works[id][mode === 'downloads' ? 'downloads' : 'views'] || 0 : 0; },
    available: function () { return !!(snapshot && snapshot.available); },
    cardHTML: function (slug, w, noChar) {
      var href = '/works/' + slug + '.html';
      if (window.SiteLang) href = SiteLang.url(href);
      var licenseFull = T('license.' + w.lk, w.lt);
      var licenseShort = T('v2.licenseShort.' + w.lk, w.ls || w.lt);
      var kinds = {meme:'梗图',illustration:'插画',setting:'设定',comic:'漫画'};
      var type = (w.k || []).map(function (id) { return T('v2.type.' + id, kinds[id] || id); }).join(' · ') || T('v2.work', '作品');
      return '<article class="media-card" style="--c:' + esc(w.col) + ';--cs:' + esc(w.cs) + '" data-k="' + esc((w.k || []).join(' ')) + '"><a href="' + esc(href) + '" data-work="' + esc(slug) + '"><div class="ph"' + (w.w && w.h ? ' style="aspect-ratio:' + w.w + '/' + w.h + '"' : '') + '><img loading="lazy" decoding="async" src="' + esc(w.i || w.l) + '" alt="' + esc(w.d || w.n) + '"' + (w.w && w.h ? ' width="' + w.w + '" height="' + w.h + '"' : '') + '><span class="lic" data-lic="' + esc(w.lk) + '" title="' + esc(licenseFull) + '">' + esc(licenseShort) + '</span><span class="badge">' + esc(type) + '</span>' + (w.s ? '<span class="dl">↓ ' + esc(w.s) + '</span>' : '') + '</div><div class="meta"><h3>' + esc(w.n) + '</h3><p>' + (noChar ? '' : '<span class="who"><i></i>' + esc(w.c) + '</span>') + '<span>' + esc(w.dt) + '</span></p><p class="work-stats" data-work-stats="' + esc(w.id) + '"></p></div></a></article>';
    },
  };
  document.addEventListener('work:show', function (e) { track('work_view', e.detail.id); paint(); });
  document.addEventListener('click', function (e) { var link = e.target.closest('[data-download-work]'); if (link) track('work_download', link.getAttribute('data-download-work')); });
  document.addEventListener('v2:dom', paint);
  document.addEventListener('site:langchange', paint);
  paint();
})();
