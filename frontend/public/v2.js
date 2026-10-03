/* 蓝色大肥鱼 v2 前台交互（自 feiyufans/demo-v2 迁入）
   · 作品浮层：站内唯一的作品查看方式；地址同步为 /works/<slug>.html（冻结地址）
   · 左侧抽屉（手机）、连续下滑 + 稳定瀑布流、随机排序、搜索页、复制群号 / 图片 / 链接
   · 多语言：界面文案走 SiteLang.fmt(key, 中文兜底)，切换语言时重渲染浮层与计数
   · 评论：浮层里按作品 id 加载 Giscus（讨论串 sticker-<id>，与原详情页一致） */
(function () {
  'use strict';
  var T = function (key, zh, vars) { return window.SiteLang ? window.SiteLang.fmt(key, zh, vars) : String(zh).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var root = document.documentElement;
  var flash = function (b, t) { var o = b.textContent; b.textContent = t; setTimeout(function () { b.textContent = o; }, 1600); };
  var KIND = { meme: '梗图', illustration: '插画', setting: '设定', comic: '漫画' };
  var kindText = function (ids) { return (ids || []).map(function (id) { return T('v2.type.' + id, KIND[id] || id); }).join(' · '); };

  // 语言切换器：lang.js 注入到第一个 .topnav；抽屉里再放一份（点击转发）
  function mountLang() {
    var sw = document.getElementById('lang-switch'); if (!sw) return;
    var host = document.querySelector('[data-lang-host="drawer"]');
    if (host && !host.firstChild) {
      var copy = sw.cloneNode(true); copy.id = 'lang-switch-drawer';
      copy.addEventListener('click', function (e) { var b = e.target.closest('.lang-switch-btn'); if (!b) return; var i = [].indexOf.call(copy.children, b); sw.children[i] && sw.children[i].click(); });
      host.appendChild(copy);
    }
  }
  function syncLangCopy() {
    var sw = document.getElementById('lang-switch'), copy = document.getElementById('lang-switch-drawer'); if (!sw || !copy) return;
    [].forEach.call(copy.children, function (b, i) { b.setAttribute('aria-pressed', sw.children[i] ? sw.children[i].getAttribute('aria-pressed') : 'false'); });
  }
  // lang.js 在 DOMContentLoaded 时注入切换器；v2.js 是 defer 脚本，可能先于它运行，所以两个时机都试一次
  mountLang(); document.addEventListener('DOMContentLoaded', mountLang); addEventListener('load', mountLang);
  document.addEventListener('site:langchange', syncLangCopy);

  // 快捷键：/ 聚焦搜索
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { var q = document.getElementById('q') || document.getElementById('q-top'); if (q) { e.preventDefault(); q.focus(); } }
  });

  // —— 复制：群号、图片 ——
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-copy-text]');
    if (t) {
      navigator.clipboard.writeText(t.getAttribute('data-copy-text')).then(function () { flash(t, T('ui.copied', '已复制')); }, function () { flash(t, T('v2.copyManual', '请手动复制')); });
      return;
    }
    var im = e.target.closest('[data-copy-img]');
    if (im) {
      // 剪贴板只接受 PNG：先画到 canvas 再转
      fetch(im.getAttribute('data-copy-img')).then(function (r) { return r.blob(); }).then(createImageBitmap).then(function (bmp) {
        var cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0);
        return new Promise(function (r) { cv.toBlob(r, 'image/png'); });
      }).then(function (png) { return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); })
        .then(function () { flash(im, T('v2.copiedImg', '已复制图片')); }, function () { flash(im, T('v2.copyImgFail', '浏览器不支持，请长按保存')); });
    }
  });

  // —— 搜索页 ——
  var res = document.getElementById('sres');
  if (res) {
    var input = document.getElementById('q'), count = document.getElementById('scount'), idx = null, searchSort = 'latest';
    var run = function () {
      var q = input.value.trim().toLowerCase();
      history.replaceState(history.state, '', q ? '?q=' + encodeURIComponent(input.value.trim()) : location.pathname);
      var words = q.split(/\s+/).filter(Boolean);
      if (!idx) { count.textContent = T('v2.loading', '正在加载'); return; }
      var hit = words.length ? idx.filter(function (r) { var hay = (r.n + ' ' + r.c + ' ' + r.a + ' ' + r.t + ' ' + r.d).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) >= 0; }); }) : [];
      if (searchSort === 'popular' || searchSort === 'downloads') hit.sort(function (a, b) { return WorkStats.metric(b.id, searchSort) - WorkStats.metric(a.id, searchSort); });
      if (searchSort === 'random') for (var j = hit.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var temp = hit[j]; hit[j] = hit[k]; hit[k] = temp; }
      count.textContent = words.length ? T('v2.found', '找到 {count} 件', { count: hit.length }) : T('v2.typeToSearch', '输入关键词开始搜索');
      res.innerHTML = hit.map(function (r) {
        return '<article class="media-card"><a href="/works/' + esc(r.s) + '.html" data-work="' + esc(r.s) + '"><div class="ph"' + (r.w && r.h ? ' style="aspect-ratio:' + r.w + '/' + r.h + '"' : '') + '><img loading="lazy" src="' + esc(r.i) + '" alt="' + esc(r.n) + '"><span class="badge">' + esc(kindText(r.k) || T('v2.work', '作品')) + '</span></div><div class="meta"><h3>' + esc(r.n) + '</h3><p><span class="who"><i></i>' + esc(r.c) + '</span></p><p class="work-stats" data-work-stats="' + esc(r.id) + '"></p></div></a></article>';
      }).join('');
      document.dispatchEvent(new CustomEvent('v2:dom'));
    };
    input.value = new URLSearchParams(location.search).get('q') || '';
    var top = document.getElementById('q-top'); if (top) top.value = input.value;
    fetch('/search-index.json').then(function (r) { return r.json(); }).then(function (d) { idx = d; run(); });
    var tm; input.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(run, 150); });
    document.getElementById('sform').addEventListener('submit', function (e) { e.preventDefault(); run(); });
    document.addEventListener('site:langchange', run);
    var searchBar = document.querySelector('.sort-bar'), searchSortTouched = false;
    if (searchBar) searchBar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sort]'); if (!btn || btn.disabled) return;
      searchSortTouched = true;
      searchSort = btn.getAttribute('data-sort');
      searchBar.querySelectorAll('[data-sort]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); }); run();
    });
    if (searchBar && window.WorkStats) WorkStats.ready.then(function () {
      if (!searchSortTouched && WorkStats.available() && searchBar.getAttribute('data-default-sort') === 'downloads') {
        searchSort = 'downloads'; searchBar.querySelectorAll('[data-sort]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-sort') === searchSort)); }); run();
      }
    });
  }

  // —— 连续下滑 + 稳定瀑布流 ——
  var feedEl = document.querySelector('[data-feed]');
  if (feedEl && 'IntersectionObserver' in window) (function () {
    var total = +feedEl.getAttribute('data-total');
    var next = feedEl.getAttribute('data-next'), busy = false, fails = 0;
    var cards = [].slice.call(feedEl.querySelectorAll('.media-card'));
    var initialCards = cards.slice(), initialNext = next, virtual = null, sorting = false;
    var cols = [];
    var colCount = function () { var w = feedEl.clientWidth; return w < 520 ? 2 : Math.max(2, Math.min(5, Math.floor(w / 250))); };
    var place = function (list) { list.forEach(function (c) { var m = cols[0]; cols.forEach(function (col) { if (col.offsetHeight < m.offsetHeight) m = col; }); m.appendChild(c); }); };
    var layout = function () {
      var n = colCount(); if (n === cols.length) return;
      feedEl.classList.add('js-masonry'); feedEl.style.setProperty('--cols', n);
      cols = []; for (var i = 0; i < n; i++) { var d = document.createElement('div'); d.className = 'mcol'; cols.push(d); }
      feedEl.replaceChildren.apply(feedEl, cols); place(cards);
    };
    layout();
    var rt; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(layout, 150); });

    var sentinel = document.createElement('div'); sentinel.className = 'feed-sentinel'; sentinel.setAttribute('aria-hidden', 'true');
    var bar = document.createElement('div'); bar.className = 'feed-more'; bar.setAttribute('aria-live', 'polite');
    feedEl.after(sentinel, bar);
    var setBar = function (state, html) { bar.setAttribute('data-state', state); bar.innerHTML = html; };
    var cta = document.getElementById('group-cta-tpl');
    var idle = function () {
      if (next) return setBar('idle', '');
      setBar('end', '<span class="sr">' + esc(T('v2.allLoaded', '已全部加载，共 {count} 件', { count: total })) + '</span>');
      if (cta && !(bar.nextElementSibling && bar.nextElementSibling.classList.contains('group-cta'))) {
        var node = cta.content.firstElementChild.cloneNode(true); node.classList.add('end'); bar.after(node);
        if (window.SiteLang) document.dispatchEvent(new CustomEvent('v2:dom'));
      }
    };
    var loaded = 0;
    var save = function () { if (root.classList.contains('wm-open') || (history.state && history.state.wm)) return; history.replaceState(Object.assign({}, history.state || {}, { feedLoaded: virtual ? 0 : loaded, feedY: virtual ? 0 : scrollY }), ''); };
    var st; addEventListener('scroll', function () { clearTimeout(st); st = setTimeout(save, 200); }, { passive: true });

    function load() {
      if (!next || busy) return Promise.resolve(false);
      if (virtual) {
        var batch = virtual.slugs.slice(virtual.position, virtual.position + 24);
        var holder = document.createElement('div');
        holder.innerHTML = batch.map(function (slug) { return WorkStats.cardHTML(slug, virtual.data[slug], feedEl.getAttribute('data-no-char') === 'true'); }).join('');
        var add = [].slice.call(holder.children);
        cards.push.apply(cards, add); place(add); virtual.position += batch.length;
        next = virtual.position < virtual.slugs.length ? '#stats-next' : null;
        loaded++; idle(); document.dispatchEvent(new CustomEvent('v2:dom')); save();
        return Promise.resolve(true);
      }
      busy = true; setBar('loading', '<span class="sr">' + esc(T('v2.loading', '正在加载')) + '</span>');
      return fetch(next, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var grid = doc.querySelector('[data-feed]'); if (!grid) throw new Error('no feed');
        var add = [].slice.call(grid.querySelectorAll('.media-card')).map(function (c) { return document.importNode(c, true); });
        add.forEach(function (c) { c.querySelectorAll('img').forEach(function (i) { i.loading = 'eager'; i.fetchPriority = 'low'; }); });
        cards.push.apply(cards, add); place(add);
        next = grid.getAttribute('data-next'); fails = 0; loaded++; busy = false; idle(); save();
        document.dispatchEvent(new CustomEvent('v2:dom'));
        return true;
      }).catch(function () {
        busy = false; fails++;
        setBar('error', esc(T('v2.loadFail', '加载失败')) + ' · <button type="button" class="btn btn-line btn-sm" data-more>' + esc(T('v2.retry', '重试')) + '</button>' + (fails > 1 ? ' · <a href="' + esc(next) + '">' + esc(T('v2.openNext', '打开下一页')) + '</a>' : ''));
        return false;
      });
    }
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting && !fails && !sorting) load(); }, { rootMargin: '0px 0px 200% 0px' });
    bar.addEventListener('click', function (e) { if (e.target.closest('[data-more]')) { fails = 0; load(); } });

    // 统计排序读取完整范围的作品元数据，再按批次显示；不抓全站图片。
    var sortBar = document.querySelector('.sort-bar'), order = null, sortTouched = false, defaulting = false;
    var relayout = function (list) { cols.forEach(function (c) { c.replaceChildren(); }); place(list); };
    if (sortBar) sortBar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sort]'); if (!btn || btn.disabled) return;
      if (!defaulting) sortTouched = true;
      if (sorting || busy || btn.getAttribute('aria-pressed') === 'true') return;
      var mode = btn.getAttribute('data-sort');
      if (mode === 'popular' || mode === 'downloads') {
        sorting = true; setBar('loading', esc(T('v2.loading', '正在加载')));
        Promise.all([fetch('/works-v2.json').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }), WorkStats.ready]).then(function (result) {
          if (!WorkStats.available()) throw new Error();
          var data = result[0], slugs = JSON.parse(feedEl.getAttribute('data-slugs') || '[]').filter(function (slug) { return !!data[slug]; });
          var ranks = {}; slugs.forEach(function (slug, i) { ranks[slug] = i; });
          slugs.sort(function (a, b) { return WorkStats.metric(data[b].id, mode) - WorkStats.metric(data[a].id, mode) || ranks[a] - ranks[b]; });
          virtual = { data: data, slugs: slugs, position: 0 }; cards = []; loaded = 0; fails = 0;
          cols.forEach(function (c) { c.replaceChildren(); });
          next = slugs.length ? '#stats-next' : null;
          sortBar.querySelectorAll('[data-sort]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
          return load();
        }).catch(function () { idle(); setBar('error', esc(T('stats.sortFail', '统计排序暂不可用，请稍后重试'))); }).finally(function () { sorting = false; });
        return;
      }
      if (virtual) {
        virtual = null; cards = initialCards.slice(); next = initialNext; loaded = 0; order = null; fails = 0;
        relayout(cards); idle();
      }
      sortBar.querySelectorAll('[data-sort]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      var go = function () {
        if (btn.getAttribute('data-sort') === 'random') {
          order = order || cards.slice();
          var list = order.slice();
          for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = list[i]; list[i] = list[j]; list[j] = t; }
          relayout(list);
        } else relayout(order || cards.slice());
        scrollTo({ top: feedEl.getBoundingClientRect().top + scrollY - 140 });
      };
      if (btn.getAttribute('data-sort') === 'random') {
        var step = function () { return next ? load().then(function (ok) { return ok ? step() : null; }) : Promise.resolve(); };
        step().then(go);
      } else go();
    });

    var s = history.state;
    var restore = s && s.feedLoaded ? (function () {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      var i = 0, step = function () { return i++ < s.feedLoaded ? load().then(function (ok) { return ok ? step() : null; }) : Promise.resolve(); };
      return step().then(function () { scrollTo(0, s.feedY || 0); });
    })() : Promise.resolve();
    Promise.all([restore, window.WorkStats ? WorkStats.ready : Promise.resolve()]).then(function () {
      idle();
      if (sortBar && !sortTouched && window.WorkStats && WorkStats.available() && sortBar.getAttribute('data-default-sort') === 'downloads') {
        defaulting = true; sortBar.querySelector('[data-sort="downloads"]').click(); defaulting = false;
      }
      io.observe(sentinel);
    });
  })();

  // —— 手机左侧抽屉 ——
  (function () {
    var btn = document.querySelector('.drawer-btn'), drawer = document.getElementById('site-drawer'), back = document.querySelector('.drawer-back');
    if (!btn || !drawer) return;
    var isOpen = function () { return root.classList.contains('drawer-open'); };
    var set = function (open) {
      root.classList.toggle('drawer-open', open); btn.setAttribute('aria-expanded', String(open)); if (back) back.hidden = !open;
      if (open) { var x = drawer.querySelector('.drawer-x'); if (x) x.focus(); } else btn.focus();
    };
    btn.addEventListener('click', function () { set(true); });
    document.addEventListener('click', function (e) { if (isOpen() && e.target.closest('[data-drawer-close]')) set(false); });
    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape') set(false);
      else if (e.key === 'Tab') {
        var f = [].filter.call(drawer.querySelectorAll('a[href],button'), function (x) { return x.offsetParent; }); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    matchMedia('(min-width: 961px)').addEventListener('change', function (m) { if (m.matches && isOpen()) set(false); });
  })();

  // —— 开屏活动弹窗 ——
  // 每个活动在同一浏览器只自动弹一次；活动截止后、活动页本身、直接打开作品地址时不弹。任何 [data-ev-open] 都能再次打开
  (function () {
    var pop = document.getElementById('event-popup'); if (!pop) return;
    var key = 'ev-seen:' + pop.getAttribute('data-event'), until = Date.parse(pop.getAttribute('data-until') || ''), lastFocus = null;
    var store = function (v) { try { if (v === undefined) return localStorage.getItem(key); localStorage.setItem(key, v); } catch (e) { return null; } };
    function open() {
      if (!pop.hidden) return;
      lastFocus = document.activeElement; pop.hidden = false; root.classList.add('ev-open');
      pop.querySelector('.ev-x').focus({ preventScroll: true });
    }
    function close() {
      if (pop.hidden) return;
      pop.hidden = true; root.classList.remove('ev-open'); store('1');
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }
    pop.addEventListener('click', function (e) {
      if (e.target.closest('[data-ev-close]')) close();
      else if (e.target.closest('a[href]')) store('1');
    });
    document.addEventListener('click', function (e) { var t = e.target.closest('[data-ev-open]'); if (t) { e.preventDefault(); open(); } });
    document.addEventListener('keydown', function (e) {
      if (pop.hidden) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
      else if (e.key === 'Tab') {
        var f = [].filter.call(pop.querySelectorAll('a[href],button'), function (x) { return x.offsetParent; }); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }, true);
    var onEventPage = location.pathname === pop.getAttribute('data-href');
    var workDirect = feedEl && feedEl.getAttribute('data-open');
    if (!onEventPage && !workDirect && !store() && !(until && Date.now() > until)) setTimeout(open, 400);
  })();

  // —— 作品浮层 ——
  (function () {
    if (!window.fetch || !('replaceState' in history)) return;
    var dataP = null, list = [], idx = -1, lastFocus = null, scope = null, current = null;
    var load = function () { return dataP || (dataP = fetch('/works-v2.json').then(function (r) { return r.json(); })); };
    var slugOf = function (a) { var d = a.getAttribute('data-work'); if (d) return d; var m = (a.getAttribute('href') || '').match(/^\/works\/([^/?#]+)\.html$/); return m ? m[1] : null; };
    var autoOpen = feedEl ? feedEl.getAttribute('data-open') : null;
    var listUrl = autoOpen ? '/index.html' : location.pathname + location.search;
    var workUrl = function (slug) { return '/works/' + slug + '.html'; };

    var box = document.createElement('div');
    box.className = 'wm'; box.hidden = true;
    box.innerHTML = '<div class="wm-back" data-close></div><div class="wm-panel" role="dialog" aria-modal="true" aria-labelledby="wm-title">' +
      '<button type="button" class="wm-x" data-close>×</button>' +
      '<figure class="wm-stage"><img alt=""><button type="button" class="wm-nav prev" data-step="-1">‹</button><button type="button" class="wm-nav next" data-step="1">›</button></figure>' +
      '<div class="wm-info"></div></div>';
    document.body.appendChild(box);
    var panel = box.querySelector('.wm-panel'), stageEl = box.querySelector('.wm-stage'), img = stageEl.querySelector('img'), info = box.querySelector('.wm-info');
    var labels = function () {
      box.querySelector('.wm-x').setAttribute('aria-label', T('index.qq.close', '关闭'));
      box.querySelector('.prev').setAttribute('aria-label', T('v2.prev', '上一张'));
      box.querySelector('.next').setAttribute('aria-label', T('v2.next', '下一张'));
    };
    labels();

    // 当前可以左右切换的作品：点击所在的列表
    var collect = function () {
      var seen = {}, out = [];
      [].forEach.call((scope || document).querySelectorAll('a[href^="/works/"], [data-work]'), function (a) { var s = slugOf(a); if (s && !seen[s]) { seen[s] = 1; out.push(s); } });
      return out;
    };
    var ORIGIN_KEY = { 'self-created': 'origin.self-created', 'author-submitted': 'origin.author-submitted', 'internet-found': 'origin.internet-found', 'community-created': 'origin.community-created', 'github-issue': 'v2.origin.issue', 'qq-group': 'v2.origin.qq', 'site-form': 'v2.origin.site', unknown: 'origin.unknown' };
    var ORIGIN_ZH = { 'self-created': '自己创作或生成', 'author-submitted': '原作者本人投稿', 'internet-found': '网络整理', 'community-created': '社区成员创作', 'github-issue': 'GitHub Issue 投稿', 'qq-group': 'QQ 群投稿', 'site-form': '站内投稿', unknown: '来源不明' };

    function render(slug, w) {
      var fact = function (k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>'; };
      var cta = document.getElementById('group-cta-tpl');
      var src = T(ORIGIN_KEY[w.ok] || 'origin.unknown', ORIGIN_ZH[w.ok] || ORIGIN_ZH.unknown);
      info.innerHTML = '<a class="who big" href="/characters/' + esc(w.cid) + '.html" style="--c:' + esc(w.col) + '"><i></i>' + esc(w.c) + '</a>' +
        '<h2 id="wm-title">' + esc(w.n) + '</h2>' + (w.cm ? '<blockquote class="wm-quote">' + esc(w.cm) + '</blockquote>' : '') + (w.d ? '<p class="desc">' + esc(w.d) + '</p>' : '') +
        '<p class="work-stats" data-work-stats="' + esc(w.id) + '"></p>' +
        '<div class="acts"><a class="btn btn-ink" data-download-work="' + esc(w.id) + '" href="' + esc(w.o) + '" target="_blank" rel="noopener">' + esc(T('work.download', '下载原图')) + (w.f ? ' · ' + esc(w.f) : '') + (w.s ? ' ' + esc(w.s) : '') + '</a>' +
        '<button class="btn btn-line" type="button" data-copy-img="' + esc(w.l) + '">' + esc(T('v2.copyImg', '复制图片')) + '</button>' +
        '<button class="btn btn-line" type="button" data-copy-url="' + esc(location.origin + workUrl(slug)) + '">' + esc(T('work.copyLink', '复制链接')) + '</button></div>' +
        '<dl class="wm-facts">' +
          fact(T('work.field.license', '授权状态'), '<span class="lic-inline" data-lic="' + esc(w.lk) + '">' + esc(T('license.' + w.lk, w.lt)) + '</span>' + (w.ln ? '<small class="lic-note">' + esc(w.ln) + '</small>' : '')) +
          fact(w.ac ? T('v2.credit', '署名') : T('v2.author', '作者'), w.a && /^https?:\/\//i.test(w.au || '') ? '<a href="' + esc(w.au) + '" target="_blank" rel="nofollow noopener noreferrer">' + esc(w.a) + '</a>' : esc(w.a || (w.ac ? T('submit.form.anonymous', '不署名') : T('work.unlabeled', '未标注')))) + fact(T('work.field.type', '类型'), esc(kindText(w.k) || T('v2.work', '作品'))) + (w.w && w.h ? fact(T('work.field.size', '尺寸'), w.w + ' × ' + w.h) : '') +
          (w.ac && w.sa ? fact(T('work.field.originAuthor', '来源作者'), esc(w.sa)) : '') +
          fact(T('v2.source', '来源'), w.su ? '<a href="' + esc(w.su) + '" target="_blank" rel="nofollow noopener">' + esc(src) + '</a>' : esc(src)) + fact(T('work.field.date', '收录时间'), esc(w.dt)) +
        '</dl>' +
        (w.tg && w.tg.length ? '<p class="wm-tags">' + w.tg.map(function (t) { return '<a href="/search.html?q=' + encodeURIComponent(t) + '">#' + esc(t) + '</a>'; }).join('') + '</p>' : '') +
        (cta ? cta.innerHTML : '') +
        '<p class="wm-more"><a href="https://github.com/lmy414/ai-girl-stickers/issues/new?template=takedown-request.yml" target="_blank" rel="noopener">' + esc(T('v2.takedown', '这是你的作品？申请署名或下架')) + '</a></p>' +
        '<section class="wm-comments"><h3>' + esc(T('section.comments', '评论')) + '</h3><button type="button" class="btn btn-line btn-sm" data-comments="' + esc(w.id) + '">' + esc(T('v2.loadComments', '展开评论')) + '</button></section>';
      // 模板里的 data-i18n 文案按当前语言补一次
      [].forEach.call(info.querySelectorAll('[data-i18n]'), function (el) { el.textContent = T(el.getAttribute('data-i18n'), el.textContent); });
      [].forEach.call(info.querySelectorAll('[data-i18n-attr]'), function (el) { el.getAttribute('data-i18n-attr').split(',').forEach(function (p) { var kv = p.split(':'); if (kv[1]) el.setAttribute(kv[0], T(kv[1], el.getAttribute(kv[0]) || '')); }); });
    }
    // Giscus：按需加载，避免每翻一张都拉评论
    function comments(btn) {
      var sec = btn.parentNode, lang = (window.SiteLang && window.SiteLang.current) || 'zh';
      var s = document.createElement('script');
      s.src = 'https://giscus.app/client.js'; s.async = true; s.crossOrigin = 'anonymous';
      var attrs = { repo: 'lmy414/lmy414-blog-comments', 'repo-id': 'R_kgDOTUvnVw', category: 'Announcements', 'category-id': 'DIC_kwDOTUvnV84DF4fs', mapping: 'specific', term: 'sticker-' + btn.getAttribute('data-comments'), 'reactions-enabled': '1', 'input-position': 'bottom', theme: 'light', lang: lang === 'zh' ? 'zh-CN' : lang };
      Object.keys(attrs).forEach(function (k) { s.setAttribute('data-' + k, attrs[k]); });
      btn.replaceWith(s);
      sec.classList.add('on');
    }

    // 大图加载前：按作品宽高比撑开占位（不再先缩成一条再展开），先铺列表卡片里已经加载好的缩略图，大图到了再盖上
    function setStage(slug, w) {
      var dim = !!(w.w && w.h), sel = window.CSS && CSS.escape ? CSS.escape(slug) : slug;
      var card = document.querySelector('[data-work="' + sel + '"] img'), thumb = card ? (card.currentSrc || card.src) : '';
      img.onload = img.onerror = null;
      img.removeAttribute('src');
      stageEl.classList.add('is-loading'); stageEl.classList.toggle('has-dim', dim);
      if (dim) { img.width = w.w; img.height = w.h; img.style.setProperty('--r', String(w.w / w.h)); img.style.setProperty('--w', w.w + 'px'); }
      else { img.removeAttribute('width'); img.removeAttribute('height'); img.style.removeProperty('--r'); img.style.removeProperty('--w'); }
      img.style.backgroundImage = thumb ? 'url("' + thumb.replace(/["\\]/g, encodeURIComponent) + '")' : '';
      var src = w.l;
      img.onload = function () { if (img.getAttribute('src') !== src) return; stageEl.classList.remove('is-loading'); img.style.backgroundImage = ''; };
      img.onerror = function () { if (img.getAttribute('src') === src) stageEl.classList.remove('is-loading'); };
      img.src = src; img.alt = w.d || w.n;
      if (img.complete && img.naturalWidth) img.onload();
    }
    function show(i) {
      return load().then(function (d) {
        list = collect(); if (!list.length) return;
        idx = (i + list.length) % list.length;
        var slug = list[idx], w = d[slug]; if (!w) return;
        var changed = current !== slug;
        current = slug;
        setStage(slug, w);
        render(slug, w);
        if (changed) document.dispatchEvent(new CustomEvent('work:show', { detail: { id: w.id } }));
        info.scrollTop = 0; panel.scrollTop = 0;
        box.querySelector('.prev').hidden = box.querySelector('.next').hidden = list.length < 2;
        history.replaceState(Object.assign({}, history.state || {}, { wm: slug }), '', workUrl(slug));
        document.title = w.n + ' - ' + w.c + ' | 蓝色大肥鱼';
      });
    }
    var baseTitle = autoOpen ? T('v2.homeTitle', '蓝色大肥鱼 - AI 娘二创图库') : document.title;
    function open(slug, from, push) {
      scope = (from && from.closest('[data-feed], .feed-grid, #sres')) || feedEl || null;
      if (push) history.pushState(Object.assign({}, history.state || {}, { wm: slug }), '', workUrl(slug));
      lastFocus = from || lastFocus; box.hidden = false; root.classList.add('wm-open');
      var pos = collect().indexOf(slug);
      var p = pos < 0 ? load().then(function (d) { if (d[slug]) { list = [slug]; } }).then(function () { return show(0); }) : show(pos);
      box.querySelector('.wm-x').focus({ preventScroll: true });
      return p;
    }
    function hide() {
      if (box.hidden) return;
      box.hidden = true; root.classList.remove('wm-open'); document.title = baseTitle; current = null;
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    }
    // 关闭 = 回到列表那条历史记录；直接打开的作品地址没有上一条，就原地换成列表地址
    function close() {
      if (box.hidden) return;
      if (history.state && history.state.wm && history.state.fromList) history.back();
      else { hide(); history.replaceState(Object.assign({}, history.state || {}, { wm: null, fromList: false }), '', listUrl); }
    }
    addEventListener('popstate', function (e) {
      var slug = e.state && e.state.wm;
      if (slug) open(slug, lastFocus, false); else hide();
    });
    // 页面上所有作品链接都走浮层（Ctrl / 中键仍在新标签打开作品地址，会自动弹出浮层）
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button) return;
      var a = e.target.closest('a[href^="/works/"], [data-work]');
      if (!a || box.contains(a)) return;
      var slug = slugOf(a); if (!slug) return;
      e.preventDefault();
      history.replaceState(Object.assign({}, history.state || {}), '');
      history.pushState({ wm: slug, fromList: true }, '', workUrl(slug));
      open(slug, a, false);
    });
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) return close();
      var u = e.target.closest('[data-copy-url]');
      if (u) { navigator.clipboard.writeText(u.getAttribute('data-copy-url')).then(function () { flash(u, T('ui.copied', '已复制')); }, function () { flash(u, T('v2.copyManual', '请手动复制')); }); return; }
      var s = e.target.closest('[data-step]'); if (s) { show(idx + +s.getAttribute('data-step')); return; }
      var c = e.target.closest('[data-comments]'); if (c) { comments(c); return; }
      // 浮层内的站内链接（角色、标签、社群）：先收起浮层再跳转
      var a = e.target.closest('a[href^="/"]');
      if (a) { box.hidden = true; root.classList.remove('wm-open'); }
    });
    document.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'Tab') {
        var f = [].filter.call(box.querySelectorAll('a[href],button'), function (x) { return !x.hidden && x.offsetParent; }); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    // 手机：在图片上左右滑动切换
    var sx = null, sy = null, stage = box.querySelector('.wm-stage');
    stage.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (sx === null) return; var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = sy = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(idx + (dx < 0 ? 1 : -1));
    });
    // 切换语言：浮层按新语言重画（评论区收起，下次展开用新语言）
    document.addEventListener('site:langchange', function () {
      labels();
      if (current) load().then(function (d) { if (d[current]) render(current, d[current]); });
    });
    // 直接打开的作品地址：自动弹出
    if (autoOpen) {
      history.replaceState(Object.assign({}, history.state || {}, { wm: autoOpen, fromList: false }), '', workUrl(autoOpen));
      open(autoOpen, feedEl.querySelector('[data-work="' + autoOpen + '"]'), false);
    }
  })();
})();
