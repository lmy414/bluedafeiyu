// 演示站点的增强脚本。页面内容全部在 HTML 里；脚本失效时链接、分页、翻页、目录照常可用。
// 功能对齐线上：作品预览（上一张/下一张、键盘、滑动、放大）、收藏、下载、复制图片/链接、分享卡片、QQ 群、评论、
// 无限下滑的不对齐瀑布流、排序与多选角色、视频筛选、连载进度与连续阅读、搜索、收藏页、友链分类。
(() => {
  const SITE = 'https://xn--pssy23gqgbz2d718b.com';
  const ROOT = (window.DEMO_ROOT || 'assets/').replace(/assets\/$/, '');
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const abs = p => /^https?:/.test(p || '') ? p : SITE + (p || '');
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const ICON = {
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6m-7.6 7 7.6 4.6"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', back: '<path d="M19 12H5m5-5-5 5 5 5"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M11 8v6M8 11h6"/>', image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  };
  const icon = (n, s = 16) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
  const root = document.documentElement;
  if (store.get('theme', '')) root.dataset.theme = store.get('theme', '');
  document.body.classList.add('js');

  // 提示条
  const toastEl = $('.toast'); let toastTimer;
  const toast = text => { if (!toastEl) return; toastEl.textContent = text; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200); };

  // 数据：首次需要时才加载（预览、下滑到底、改排序、搜索、收藏页）。
  let dataPromise;
  const loadData = () => dataPromise ??= new Promise((ok, fail) => {
    if (window.WORKS_DATA) return ok(window.WORKS_DATA);
    const s = document.createElement('script'); s.src = ROOT + 'assets/works-data.js';
    s.onload = () => ok(window.WORKS_DATA); s.onerror = fail; document.head.append(s);
  }).then(d => {
    d.bySlug ??= new Map(d.works.map(w => [w.s, w]));
    for (const w of d.works) w.t ??= [w.n, w.d, w.cm, ...w.tg, ...w.r.map(id => d.alias[id] || ''), w.a].join(' ').toLowerCase();
    return d;
  });

  // 收藏（只存在本浏览器，与线上一致）
  const saved = new Set(store.get('saved', []));
  const paint = () => {
    $$('[data-save]').forEach(b => { const on = saved.has(b.dataset.save); b.setAttribute('aria-pressed', on); const t = $('span', b); if (t) t.textContent = on ? '已收藏' : (b.dataset.save.startsWith('creator:') ? '收藏' : '收藏作品'); });
    $$('[data-saved-count]').forEach(b => { b.textContent = saved.size; b.hidden = !saved.size; });
  };
  paint();

  // ---------- 作品卡（与 gen/layout.mjs 的 card() 结构相同） ----------
  const LIC = {cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-nc': 'CC BY-NC', 'author-permission': '作者授权', 'submitter-permission': '投稿者授权'};
  const cardHTML = (w, d, {showKind = true} = {}) => {
    const sized = w.w > 0 && w.h > 0, r0 = w.r[0];
    const badges = (w.g ? '<span class="tag">GIF</span>' : '') + (LIC[w.lk] ? `<span class="tag lic">${LIC[w.lk]}</span>` : '');
    return `<article class="card${sized && w.h / w.w > 2.2 ? ' long' : ''}" data-slug="${esc(w.s)}"><a class="art" href="${ROOT}works/${esc(w.s)}.html" data-preview="${esc(w.s)}" aria-haspopup="dialog"><div class="media"${sized ? '' : ' data-ratio="unknown"'}><img src="${esc(abs(w.i))}" alt="${esc(w.n)}"${sized ? ` width="${w.w}" height="${w.h}"` : ''} loading="lazy" decoding="async"></div><h3 class="t">${esc(w.n)}</h3></a><p class="m"><span class="roles">${r0 ? `<span class="role-dot r-${esc(r0)}">${esc(d.roles[r0] || '')}</span>${w.r.length > 1 ? `<small>+${w.r.length - 1}</small>` : ''}` : ''}</span>${showKind ? `<span class="kind">${esc(d.kinds[w.k[0]] || '')}</span>` : ''}<time>${esc(w.dt.slice(5))}</time></p>${badges ? `<div class="badges">${badges}</div>` : ''}<button class="save-mini" type="button" data-save="${esc(w.s)}" aria-pressed="${saved.has(w.s)}" aria-label="收藏">${icon('heart')}</button></article>`;
  };

  // ---------- 不对齐瀑布流：按最短列放卡片，DOM 顺序 = 阅读顺序（从左到右、从新到旧） ----------
  // 卡片高度：图片已加载就用真实比例，否则用宽高属性；都没有时按 4:5 估算。高度上限与 CSS 的长图裁切一致。
  const estimate = el => {
    const img = $('img', el), w = img?.naturalWidth || +img?.getAttribute('width'), h = img?.naturalHeight || +img?.getAttribute('height');
    return (w && h ? Math.min(h / w, 2.2) : 1.25) + .28;
  };
  function masonry(grid) {
    if (grid.masonry) return grid.masonry;
    const cards = $$(':scope > .card', grid);
    const st = grid.masonry = {cards, cols: [], n: 0};
    grid.classList.add('is-js');
    const count = () => { const w = grid.clientWidth; return w < 520 ? 2 : Math.max(2, Math.min(6, Math.floor((w + 14) / 234))); };
    // 放到当前实际最矮的一列。读 offsetHeight 会触发排版，刚放进去的卡片也已按宽高属性或 4:5 占位计入。
    // 页面隐藏或列宽为 0 时退回估算高度。
    const place = el => {
      let best = st.cols[0], bestH = Infinity;
      for (const c of st.cols) { const h = c.el.offsetHeight || c.est; if (h < bestH) { bestH = h; best = c; } }
      best.el.append(el); best.est += estimate(el) * 200;
    };
    st.layout = () => {
      const n = count(); if (n === st.n) return; st.n = n;
      grid.replaceChildren(); st.cols = Array.from({length: n}, () => { const el = document.createElement('div'); el.className = 'col'; grid.append(el); return {el, est: 0}; });
      st.cards.forEach(place);
    };
    st.append = html => { const box = document.createElement('div'); box.innerHTML = html; for (const el of [...box.children]) { st.cards.push(el); place(el); } paint(); };
    st.reset = html => { st.cards = []; st.n = 0; st.layout(); st.append(html); };
    st.layout();
    return st;
  }
  const grids = $$('.masonry').map(masonry);
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => grids.forEach(g => { g.n = 0; g.layout(); }), 120); });
  // 尺寸未知的图片（线上 447 件）加载后按真实比例展开；页面刚打开的几秒内据此重新分列一次，避免某一列特别长。
  const started = performance.now(); let lt;
  document.addEventListener('load', e => {
    const img = e.target; if (img.tagName !== 'IMG') return;
    const box = img.closest('[data-ratio="unknown"]'); if (!box) return;
    box.setAttribute('data-ratio', 'loaded');
    if (img.naturalHeight / img.naturalWidth > 2.2) box.closest('.card')?.classList.add('long');
    if (performance.now() - started < 4000 && scrollY < 400) { clearTimeout(lt); lt = setTimeout(() => grids.forEach(g => { g.n = 0; g.layout(); }), 200); }
  }, true);

  // ---------- 无限下滑 + 排序 / 多选角色 / 只看 GIF ----------
  const feedGrid = $('.masonry[data-feed]');
  const status = $('[data-feed-status]'), pagerEl = $('[data-pager]'), tools = $('[data-list-tools]');
  const feed = feedGrid && {spec: feedGrid.dataset.feed, offset: +feedGrid.dataset.offset, sort: 'latest', roles: new Set(), gif: false, list: null, busy: false, custom: false};
  const seed = store.get('seed', 0) || (() => { const s = Math.floor(Math.random() * 1e9); store.set('seed', s); return s; })();
  const shuffle = arr => { let x = seed; const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) % 2147483648; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function feedList(d) {
    const [kind, a, b] = feed.spec.split(':');
    let list = kind === 'topic' ? (d.topics[a] || []).map(s => d.bySlug.get(s)) : d.works.filter(w => !w.c && (
      kind === 'browse' ? true : kind === 'gif' ? w.g : kind === 'type' ? w.k.includes(a) : kind === 'char' ? w.r.includes(a) && (!b || w.k.includes(b)) : false));
    if (feed.roles.size) list = list.filter(w => w.r.some(r => feed.roles.has(r)));
    if (feed.gif) list = list.filter(w => w.g);
    if (feed.sort === 'oldest') list = [...list].sort((x, y) => x.at - y.at);
    else if (feed.sort === 'random') list = shuffle(list);
    else if (kind !== 'topic') list = [...list].sort((x, y) => y.at - x.at);
    return list;
  }
  async function more() {
    if (!feed || feed.busy) return; feed.busy = true;
    try {
      const d = await loadData(); feed.list ??= feedList(d);
      const next = feed.list.slice(feed.offset, feed.offset + 24);
      if (next.length) { feedGrid.masonry.append(next.map(w => cardHTML(w, d)).join('')); feed.offset += next.length; }
      // 改了排序或筛选后，静态页码与当前列表不再对应，就收起；默认浏览时保留页码，方便直接跳页。
      if (pagerEl) pagerEl.hidden = feed.custom;
      status.hidden = false;
      status.innerHTML = feed.offset >= feed.list.length ? `<span>已经到底了 · 共 ${feed.list.length} 件</span>` : `<span class="spin"></span><span>已加载 ${feed.offset} / ${feed.list.length} 件，继续下滑</span>`;
    } catch { toast('数据加载失败，可以用下方分页继续浏览。'); return; } finally { feed.busy = false; }
    // 追加后加载提示仍在视口附近（屏幕很高或图片很矮）就继续加载，直到填满或到底。
    if (feed.offset < feed.list.length && status.getBoundingClientRect().top < innerHeight + 900) requestAnimationFrame(more);
  }
  async function refeed() {
    const d = await loadData(); feed.list = feedList(d); feed.offset = 0; feed.custom = true;
    feedGrid.masonry.reset(''); await more();
    const n = feed.roles.size; const b = $('[data-filter-count]'); if (b) { b.textContent = n; b.hidden = !n; }
  }
  if (feed && status) {
    if (tools) tools.hidden = false;
    new IntersectionObserver(es => es.forEach(e => e.isIntersecting && more()), {rootMargin: '900px 0px'}).observe(status);
    addEventListener('scroll', () => { if (!feed.busy && status.getBoundingClientRect().top < innerHeight + 900) more(); }, {passive: true});
    status.hidden = false; status.innerHTML = '<span>继续下滑加载更多</span>';
    $('[data-sort]')?.addEventListener('change', e => { feed.sort = e.target.value; refeed(); });
    $('[data-gif-only]')?.addEventListener('change', e => { feed.gif = e.target.checked; refeed(); });
  }

  // 多选角色弹层
  async function roleFilter() {
    const d = await loadData();
    const dlg = sheet('role-filter', `<div class="sheet-head"><b>按角色筛选（可多选）</b><button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close', 18)}</button></div>
      <div class="choices">${Object.entries(d.roles).map(([id, n]) => `<label class="choice r-${id}"><input type="checkbox" value="${id}" ${feed.roles.has(id) ? 'checked' : ''}><span><i class="dot"></i>${esc(n)}</span></label>`).join('')}</div>
      <div class="row"><button class="btn primary" type="button" data-apply>应用</button><button class="btn" type="button" data-clear>清除</button></div>`);
    dlg.onclick = e => {
      if (e.target.closest('[data-apply]')) { feed.roles = new Set($$('input:checked', dlg).map(i => i.value)); dlg.close(); refeed(); }
      if (e.target.closest('[data-clear]')) { $$('input', dlg).forEach(i => { i.checked = false; }); }
    };
    dlg.showModal();
  }
  function sheet(id, html) {
    let dlg = document.getElementById(id);
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = id; dlg.className = 'sheet-dialog'; document.body.append(dlg); }
    dlg.innerHTML = `<div class="sheet-body">${html}</div>`;
    return dlg;
  }

  // ---------- 作品预览：与线上一致的信息与操作，左右切换，键盘 ← →，手机左右滑 ----------
  let pv, pvList = [], pvIndex = 0, pvScope;
  const scopeOf = el => el.closest('.masonry, .picks, .short-strip, .section, main');
  // 瀑布流分列后 DOM 顺序是按列的；切换顺序用卡片的原始顺序（从左到右、从新到旧）。
  const scopeList = () => [...new Set((pvScope.masonry ? pvScope.masonry.cards.map(c => $('[data-preview]', c)) : $$('[data-preview]', pvScope)).filter(Boolean).map(a => a.dataset.preview))];
  async function openPreview(slug, opener) {
    pvScope = opener ? scopeOf(opener) : pvScope;
    pvList = scopeList();
    pvIndex = Math.max(0, pvList.indexOf(slug));
    pv ??= Object.assign(document.createElement('dialog'), {className: 'preview', id: 'preview-dialog'});
    pv.setAttribute('aria-label', '作品预览');
    if (!pv.isConnected) document.body.append(pv);
    const quick = opener?.closest('.card')?.querySelector('img') || opener?.querySelector('img');
    if (!pv.open) {
      pv.innerHTML = `<div class="pv"><header class="pv-head">${icon('image', 18)}<b>作品预览</b><span class="pv-pos" role="status">正在加载…</span><button class="icon-btn" type="button" data-pv-close aria-label="关闭">${icon('close', 20)}</button></header><div class="pv-art">${quick?.src ? `<img src="${esc(quick.src)}" alt="">` : ''}</div></div>`;
      pv.showModal(); document.body.classList.add('lock');
    }
    const d = await loadData().catch(() => null);
    if (!pv.open) return;
    const w = d?.bySlug.get(slug);
    if (!w) { location.href = opener?.href || ROOT + 'works/' + slug + '.html'; return; }
    const detail = `${ROOT}works/${esc(w.s)}.html`;
    // 与详情页同一组来源信息：署名者有站外主页就链过去，站内有创作者页也给入口；值已转义，链接单独拼装。
    const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}↗</a>`;
    const credit = w.a ? (w.au ? ext(w.au, w.a) : esc(w.a)) + (w.ow ? ` · <a href="${ROOT}${esc(w.ow.slice(1))}">站内作品集</a>` : '') : (w.ow ? `<a href="${ROOT}${esc(w.ow.slice(1))}">${esc(w.sa || '作者作品集')}</a>` : '');
    const facts = [['来源作者', esc(w.sa || '原作者未标注')], ['图片署名', credit], ['来源', w.su ? ext(w.su, '查看原始来源') : '来源未标注'],
      ['使用许可', esc(w.lt || w.ls) + (w.ln ? `<small>${esc(w.ln)}</small>` : '')], ['原图', esc([w.f, w.sz, w.w ? `${w.w} × ${w.h}` : ''].filter(Boolean).join(' · '))], ['收录时间', esc(w.dt)]].filter(([, v]) => v);
    pv.innerHTML = `<div class="pv">
      <header class="pv-head">${icon('image', 18)}<b>作品预览</b><span class="pv-pos"><b>${String(pvIndex + 1).padStart(2, '0')}</b> / ${String(pvList.length).padStart(2, '0')}</span><a class="btn sm" href="${detail}">查看详情${icon('arrow', 15)}</a><button class="icon-btn" type="button" data-pv-close aria-label="关闭">${icon('close', 20)}</button></header>
      <div class="pv-body">
        <div class="pv-art" data-pv-art><img src="${esc(abs(w.l || w.i))}" alt="${esc(w.d || w.n)}"${w.w ? ` width="${w.w}" height="${w.h}"` : ''}><button class="pv-zoom icon-btn" type="button" data-pv-zoom aria-label="放大">${icon('zoom', 18)}</button>
          <button class="pv-step prev" type="button" data-step="-1" aria-label="上一张" ${pvIndex ? '' : 'disabled'}>${icon('back', 22)}</button><button class="pv-step next" type="button" data-step="1" aria-label="下一张" ${pvIndex < pvList.length - 1 || feed?.list?.length > feed?.offset ? '' : 'disabled'}>${icon('arrow', 22)}</button></div>
        <aside class="pv-info" aria-label="作品信息和操作"><div class="pv-content" role="region" aria-label="作品信息" tabindex="0">
          <p class="roles">${w.r.map(r => `<a class="role-chip r-${r}" href="${ROOT}characters/${r}.html"><i class="dot"></i>${esc(d.roles[r] || r)}</a>`).join('')}<span class="note">${w.k.map(k => esc(d.kinds[k] || k)).join(' · ')}${w.c ? ' · 连载' : ''}</span></p>
          <h2>${esc(w.n)}</h2>
          ${w.cm || w.d ? `<div class="fish"><img src="${SITE}/avatar.png" alt="" width="32" height="32"><div><p class="eyebrow">大肥鱼说</p><p>${esc(w.cm || w.d)}</p></div></div>` : ''}
          ${w.tg.length ? `<p class="tags">${w.tg.slice(0, 8).map(t => `<a href="${ROOT}search.html?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</p>` : ''}
          <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
          <p class="note">收录和下载不等于授予转载或商用许可。</p></div>
          <div class="pv-actions"><a class="btn primary" href="${esc(w.o || abs(w.l))}" target="_blank" rel="noopener" download>${icon('download')}下载原图</a><button class="btn" type="button" data-save="${esc(w.s)}" aria-pressed="${saved.has(w.s)}">${icon('heart')}<span>收藏作品</span></button><button class="btn" type="button" data-copy-img="${esc(abs(w.l || w.i))}">${icon('copy')}复制图片</button><button class="btn" type="button" data-copy-link="${esc(SITE + '/works/' + w.s + '.html')}">${icon('link')}复制链接</button><button class="btn" type="button" data-share="${esc(w.s)}">${icon('share')}分享卡片</button></div>
        </aside></div></div>`;
    paint();
  }
  async function stepPreview(dir) {
    if (dir > 0 && pvIndex === pvList.length - 1 && feed && pvScope === feedGrid) { await more(); pvList = scopeList(); }
    const slug = pvList[pvIndex + dir]; if (slug) openPreview(slug);
  }
  const closePreview = () => { pv?.close(); document.body.classList.remove('lock'); };
  let touchX = 0;
  document.addEventListener('touchstart', e => { if (e.target.closest('.pv-art, .reader .sheet')) touchX = e.touches[0].clientX; }, {passive: true});
  document.addEventListener('touchend', e => {
    if (!touchX) return; const dx = e.changedTouches[0].clientX - touchX; touchX = 0; if (Math.abs(dx) < 50) return;
    if (pv?.open) stepPreview(dx < 0 ? 1 : -1);
    else { const a = $(`.reader-nav a[rel="${dx < 0 ? 'next' : 'prev'}"]`); if (a) location.href = a.href; }
  });

  // 放大查看（详情页大图、预览大图）
  function zoom(src) {
    const dlg = sheet('zoom-dialog', `<button class="icon-btn zoom-close" type="button" data-close aria-label="关闭">${icon('close', 22)}</button><div class="zoom-stage" data-zoom-stage><img src="${esc(src)}" alt=""></div><p class="note center">点击图片切换适应屏幕 / 原始尺寸 · Esc 关闭</p>`);
    dlg.classList.add('zoom'); dlg.showModal();
  }

  // ---------- 复制、分享、群、评论 ----------
  const copyText = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch { prompt('复制下面的内容', text); } };
  async function copyImage(src) {
    try {
      const blob = await (await fetch(src, {mode: 'cors'})).blob();
      const png = blob.type === 'image/png' ? blob : await new Promise(res => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); c.toBlob(res, 'image/png'); }; img.src = URL.createObjectURL(blob); });
      await navigator.clipboard.write([new ClipboardItem({'image/png': png})]); toast('图片已复制，可以直接粘贴到聊天里');
    } catch { copyText(src, '浏览器不允许直接复制图片，已复制图片地址'); }
  }
  async function shareCard(slug) {
    const d = slug ? await loadData().catch(() => null) : null, w = d?.bySlug.get(slug);
    const title = w ? w.n : document.title.replace(/ [—|-] .*$/, ''), url = w ? SITE + '/works/' + w.s + '.html' : (document.querySelector('link[rel=canonical]')?.href || SITE);
    const img = w ? abs(w.i) : (document.querySelector('meta[property="og:image"]')?.content || SITE + '/avatar.png');
    const dlg = sheet('share-dialog', `<div class="sheet-head"><b>分享卡片</b><button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close', 18)}</button></div>
      <figure class="share-card"><img src="${esc(img)}" alt=""><figcaption><b>${esc(title)}</b><span>蓝色大肥鱼 · AI 娘二创档案</span><small>${esc(url.replace('https://', ''))}</small></figcaption></figure>
      <div class="row">${navigator.share ? `<button class="btn primary" type="button" data-native-share>${icon('share')}系统分享</button>` : ''}<button class="btn" type="button" data-copy-link="${esc(url)}">${icon('link')}复制链接</button></div>
      <p class="note">正式站点沿用现有的分享卡片生成（带二维码，可保存为图片）。</p>`);
    dlg.onclick = e => { if (e.target.closest('[data-native-share]')) navigator.share({title, url}).catch(() => {}); };
    dlg.showModal();
  }
  function comments(btn) {
    const s = document.createElement('script'); s.src = 'https://giscus.app/client.js'; s.async = true; s.crossOrigin = 'anonymous';
    const dark = (root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    Object.entries({repo: 'lmy414/lmy414-blog-comments', 'repo-id': 'R_kgDOTUvnVw', category: 'Announcements', 'category-id': 'DIC_kwDOTUvnV84DF4fs', mapping: 'specific', term: 'sticker-' + btn.dataset.comments,
      'reactions-enabled': '1', 'input-position': 'bottom', theme: dark ? 'dark' : 'light', lang: 'zh-CN'}).forEach(([k, v]) => s.setAttribute('data-' + k, v));
    s.onerror = () => toast('评论暂时无法加载，请稍后重试。');
    btn.closest('#comments-container').append(s); btn.hidden = true;
  }

  // ---------- 全局点击 ----------
  document.addEventListener('click', e => {
    const t = e.target;
    $$('details.pop[open]').forEach(d => d.contains(t) || d.removeAttribute('open'));
    const hit = s => t.closest(s);
    if (hit('[data-theme]')) { const dark = (root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'; root.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', root.dataset.theme); return; }
    const save = hit('[data-save]');
    if (save) { e.preventDefault(); const k = save.dataset.save; saved.has(k) ? saved.delete(k) : saved.add(k); store.set('saved', [...saved]); paint(); toast(saved.has(k) ? '已收藏，在右上角“收藏”里查看' : '已取消收藏'); return; }
    if (hit('[data-pv-close]') || (pv && t === pv)) { closePreview(); return; }
    const step = hit('[data-step]'); if (step) { stepPreview(+step.dataset.step); return; }
    if (hit('[data-pv-zoom]')) { zoom($('.pv-art img', pv).src); return; }
    const z = hit('[data-zoom]'); if (z) { zoom(z.dataset.zoom); return; }
    if (hit('[data-zoom-stage]')) { hit('[data-zoom-stage]').classList.toggle('actual'); return; }
    const closer = hit('[data-close]'); if (closer) { closer.closest('dialog')?.close(); return; }
    if (t.tagName === 'DIALOG' && t.open) { t.close(); return; }
    if (hit('[data-group]')) { $('#group-dialog')?.showModal(); return; }
    const ct = hit('[data-copy-text]'); if (ct) { copyText(ct.dataset.copyText, '已复制'); return; }
    const cl = hit('[data-copy-link]'); if (cl) { copyText(cl.dataset.copyLink, '链接已复制'); return; }
    const ci = hit('[data-copy-img]'); if (ci) { copyImage(ci.dataset.copyImg); return; }
    const sh = hit('[data-share]'); if (sh) { shareCard(sh.dataset.share || (location.pathname.match(/works\/([^/]+)\.html$/) || [])[1]); return; }
    const cm = hit('[data-comments]'); if (cm) { comments(cm); return; }
    if (hit('[data-download-topic]')) { toast('正式站点沿用现有的专题 ZIP 打包（只打包已收录页）'); return; }
    if (hit('[data-open-filter]')) { roleFilter(); return; }
    const open = hit('a[data-preview]');
    if (open && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); openPreview(open.dataset.preview, open); }
  });
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); $('.hero-search input, .topbar .search input')?.focus(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const previewOnTop = pv?.open && !document.querySelector('dialog[open]:not(.preview)');
    if (previewOnTop && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); stepPreview(e.key === 'ArrowRight' ? 1 : -1); return; }
    if (e.key === 'Escape' && previewOnTop) { e.preventDefault(); closePreview(); return; }
    if (!document.querySelector('dialog[open]') && reader?.dataset.page) {
      const a = $(`.reader-nav a[rel="${{ArrowLeft: 'prev', ArrowRight: 'next'}[e.key]}"]`); if (a) location.href = a.href;
    }
  });
  addEventListener('close', () => { if (!pv?.open) document.body.classList.remove('lock'); }, true);

  // ---------- 连载：阅读进度、继续阅读、连续阅读 ----------
  const reader = $('.reader[data-reader]');
  const progressKey = id => 'reader:' + id;
  if (reader) store.set(progressKey(reader.dataset.reader), +reader.dataset.page);
  $$('[data-continue]').forEach(a => {
    const n = store.get(progressKey(a.dataset.continue), 0); if (!n) return;
    a.href = a.href.replace(/\.html(#.*)?$/, '') + '/page/' + n + '.html'; a.textContent = '继续阅读 · 第 ' + n + ' 页'; a.hidden = false;
  });
  const strip = $('[data-strip]');
  if (strip) {
    const openStrip = () => {
      strip.hidden = false; $$('img[data-src]', strip).forEach(img => { img.loading = 'lazy'; img.src = img.dataset.src; img.removeAttribute('data-src'); });
      const last = store.get(progressKey(strip.dataset.reader), 0);
      (document.getElementById(location.hash.slice(1)) || (last && document.getElementById('p' + last)) || strip).scrollIntoView();
    };
    $('[data-strip-open]')?.addEventListener('click', openStrip);
    $('[data-strip-close]')?.addEventListener('click', () => { strip.hidden = true; history.replaceState(null, '', location.pathname); scrollTo(0, 0); });
    const pos = $('[data-strip-pos]');
    const seen = new IntersectionObserver(es => es.forEach(x => {
      if (!x.isIntersecting || strip.hidden) return;
      const n = +x.target.dataset.page; store.set(progressKey(strip.dataset.reader), n);
      history.replaceState(null, '', '#p' + n); if (pos) pos.textContent = `原稿第 ${n} 页`;
    }), {rootMargin: '-45% 0px -45% 0px'});
    $$('[data-page]', strip).forEach(el => seen.observe(el));
    if (/^#p\d+$/.test(location.hash)) openStrip();
  }

  // ---------- 视频：按角色筛选 + 排序（不按作者分组，作者再多也不会挤爆筛选条） ----------
  const vbox = $('[data-videos]');
  if (vbox) {
    const cards = $$('.vcard', vbox), countEl = $('[data-vcount]'); let role = '';
    const apply = () => {
      const sort = $('[data-vsort]').value;
      const list = cards.filter(c => !role || c.dataset.roles.split(' ').includes(role));
      list.sort((a, b) => sort === 'old' ? a.dataset.date.localeCompare(b.dataset.date) : sort === 'long' ? b.dataset.dur - a.dataset.dur : sort === 'short' ? a.dataset.dur - b.dataset.dur : b.dataset.date.localeCompare(a.dataset.date));
      vbox.replaceChildren(...list); countEl.textContent = `${role ? '筛选后 ' : '共 '}${list.length} 个视频`;
    };
    $$('[data-vrole]').forEach(b => b.addEventListener('click', () => { role = b.dataset.vrole; $$('[data-vrole]').forEach(x => x.setAttribute('aria-pressed', x === b)); apply(); }));
    $('[data-vsort]').addEventListener('change', apply);
  }

  // ---------- 友情链接墙分类 ----------
  const tabs = $$('[data-friend-filter]');
  if (tabs.length) {
    const show = id => { tabs.forEach(t => t.toggleAttribute('aria-current', t.dataset.friendFilter === id)); $$('[data-friend-section]').forEach(s => { s.hidden = id !== 'all' && s.dataset.friendSection !== id; }); };
    tabs.forEach(t => t.addEventListener('click', e => { e.preventDefault(); show(t.dataset.friendFilter); history.replaceState(null, '', '#' + t.dataset.friendFilter); }));
    show(['project', 'website'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'all');
  }

  // ---------- 搜索与收藏页 ----------
  const form = $('[data-search-page]');
  if (form) {
    const params = new URLSearchParams(location.search);
    form.q.value = params.get('q') || ''; form.role.value = params.get('role') || '';
    $$('.topbar .search input').forEach(i => { i.value = form.q.value; });
    const terms = form.q.value.toLowerCase().split(/\s+/).filter(Boolean), role = form.role.value;
    if (terms.length || role) loadData().then(d => {
      const hits = d.works.filter(w => (!role || w.r.includes(role)) && terms.every(t => w.t.includes(t)));
      $('[data-search-status]').textContent = `“${form.q.value || d.roles[role]}” 找到 ${hits.length} 件${hits.length > 60 ? '，显示前 60 件' : ''}${hits.some(w => w.c) ? '（含连载漫画页，标为“连载”）' : ''}。`;
      masonry($('[data-search-results]')).reset(hits.slice(0, 60).map(w => cardHTML(w, d)).join(''));
      $('[data-search-empty]').hidden = hits.length > 0;
    });
  }
  const savedBox = $('[data-saved-results]');
  if (savedBox) loadData().then(d => {
    const list = d.works.filter(w => saved.has(w.s));
    masonry(savedBox).reset(list.map(w => cardHTML(w, d)).join(''));
    $('[data-saved-empty]').hidden = list.length > 0;
  });

  // 角色横条：鼠标滚轮横向滚动
  $$('[data-rail]').forEach(r => r.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { r.scrollLeft += e.deltaY; e.preventDefault(); } }, {passive: false}));
})();
