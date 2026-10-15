/* Keep existing destination controls near the page title. */
(() => {
  'use strict';
  const body = document.body;
  const main = document.querySelector('main');
  if (!body || !main) return;
  const messages = {
    zh: {filter:'筛选说明',character:'角色介绍与来源',topic:'合集介绍与作者',guide:'投稿须知与其他投稿入口',intro:'上传图片，填写名称、角色与类型，审核通过后收录。',contents:'本页目录'},
    'zh-Hant': {filter:'篩選說明',character:'角色介紹與來源',topic:'合集介紹與作者',guide:'投稿須知與其他投稿入口',intro:'上傳圖片，填寫名稱、角色與類型，審核通過後收錄。',contents:'本頁目錄'},
    en: {filter:'About filters',character:'Character notes and sources',topic:'About this collection and creator',guide:'Submission guidelines and other channels',intro:'Upload an image, add its name, characters and type. Accepted submissions enter the archive after review.',contents:'On this page'},
    ja: {filter:'絞り込みについて',character:'キャラクター紹介・出典',topic:'コレクション・作者の紹介',guide:'投稿ガイド・その他の投稿方法',intro:'画像を選び、作品名・キャラクター・種類を入力してください。審査後に収録されます。',contents:'このページの目次'}
  };
  const lang = document.documentElement.dataset.siteLang || (location.pathname.startsWith('/zh-hant/') ? 'zh-Hant' : location.pathname.startsWith('/en/') ? 'en' : location.pathname.startsWith('/ja/') ? 'ja' : 'zh');
  const t = messages[lang] || messages.zh;
  let active = false;

  function addClass(node, ...names) {
    if (!node) return;
    const missing = names.filter(name => !node.classList.contains(name));
    if (!missing.length) return;
    node.classList.add(...missing);
  }
  function create(tag, className, parent, before = null) {
    const node = document.createElement(tag);
    node.className = className;
    parent.insertBefore(node, before);
    return node;
  }
  function move(node, parent, before = null) {
    if (!node || !parent || node === before || node.parentNode === parent && node.nextSibling === before) return;
    parent.insertBefore(node, before);
  }
  function disclosure(label, className, parent, before = null) {
    const details = create('details', `fs-disclosure ${className}`, parent, before);
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.append(summary);
    const content = document.createElement('div');
    content.className = 'fs-disclosure-content';
    details.append(content);
    return {details,content};
  }
  function expandHashTarget() {
    if (!active || !location.hash) return;
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    let parent = target.parentElement;
    let expanded = false;
    while (parent && parent !== body) {
      if (parent.matches('details.fs-disclosure') && !parent.open) { parent.open = true; expanded = true; }
      parent = parent.parentElement;
    }
    if (expanded) requestAnimationFrame(() => target.scrollIntoView({block:'start'}));
  }

  function compactFilters() {
    for (const form of main.querySelectorAll('.filter-bar')) {
      addClass(form, 'fs-filter-bar');
      const help = form.querySelector('.filter-help');
      if (help) {
        const fold = disclosure(t.filter,'fs-filter-help',form,help);
        move(help,fold.content);
      }
    }
    if (main.querySelector('#search-form')) addClass(body,'fs-search-page');
    if (main.querySelector('#filter-form') && !main.querySelector('.character-hero,.topic-hero')) addClass(body,'fs-listing-page');
  }

  function characterPage() {
    const hero = main.querySelector('.character-hero');
    const allWorks = main.querySelector('#all-works');
    if (!hero || !allWorks) return;
    addClass(body,'fs-character-page');
    const info = hero.querySelector('.character-info');
    if (info) {
      const fold = disclosure(t.character,'fs-character-notes',info);
      const children = [...info.children].filter(node => node !== fold.details && !node.matches('.eyebrow,h1,.character-facts'));
      const subtitle = info.querySelector('h1 small');
      if (subtitle) move(subtitle,fold.content);
      for (const node of children) move(node,fold.content);
      const reading = main.querySelector('.role-reading');
      if (reading) move(reading,fold.content);
    }
    move(allWorks,main,hero.nextSibling);
    addClass(allWorks,'fs-primary-list');
  }

  function topicPage() {
    const hero = main.querySelector('.topic-hero');
    const works = main.querySelector('#collection-works');
    if (!hero || !works) return;
    addClass(body,'fs-topic-page');
    const info = hero.firstElementChild;
    const actions = info?.querySelector('.topic-download-actions');
    const heading = info?.querySelector('h1');
    if (actions && heading) move(actions,info,heading.nextSibling);
    const notes = info ? [...info.children].filter(node => node.matches('.lede,.author-line')) : [];
    const reading = main.querySelector('.collection-reading');
    if (notes.length || reading) {
      const fold = disclosure(t.topic,'fs-topic-notes',info);
      for (const node of notes) move(node,fold.content);
      if (reading) move(reading,fold.content);
    }
    addClass(works,'fs-primary-list');
  }

  function submissionPage() {
    const doc = main.querySelector('.document-page');
    const form = doc?.querySelector('#submission-form');
    const sheet = form?.closest('.form-sheet');
    if (!doc || !form || !sheet) return;
    addClass(body,'fs-submit-page');
    const title = doc.querySelector('.page-title');
    const lede = doc.querySelector(':scope > .lede');
    const guideHead = doc.querySelector('[data-i18n="submit.guide.title"]');
    const guide = doc.querySelector('.submit-top');
    const channelHead = doc.querySelector('[data-i18n="submit.channel.title"]');
    const channels = doc.querySelector('.grid-2');
    const formHead = doc.querySelector('[data-i18n="submit.form.title"]');
    const intro = create('p','fs-submit-intro',doc,title?.nextSibling || doc.firstChild);
    intro.textContent = t.intro;
    const fold = disclosure(t.guide,'fs-submit-guide',doc,intro.nextSibling);
    for (const node of [lede,guideHead,guide,channelHead,channels]) if (node) move(node,fold.content);
    move(sheet,doc,fold.details.nextSibling);
    if (formHead) { move(formHead,doc,sheet); addClass(formHead,'fs-form-heading'); }
    const upload = form.querySelector('#f-files')?.closest('.form-row');
    const name = form.querySelector('#f-name')?.closest('.form-row');
    const optionalDescription = form.querySelector('#f-desc')?.closest('.form-row');
    const character = form.querySelector('#f-character');
    addClass(upload,'fs-upload-field');
    addClass(name,'fs-name-field');
    if (optionalDescription && character) move(optionalDescription,form,character.nextSibling);
    for (const node of form.children) if (!node.matches('.fs-upload-field,.fs-name-field')) addClass(node,'fs-form-wide');
  }

  function workPage() {
    const article = main.querySelector('.work-detail');
    const info = article?.querySelector('.detail-info');
    if (!article || !info) return;
    addClass(body,'fs-work-page');
    addClass(info,'fs-work-notes');
    // Keep .detail-info around the real copy button and feedback node: archive.js uses closest().
    const quick = create('header','detail-info fs-work-quick',article,article.firstChild);
    for (const selector of ['.detail-roles','h1','.detail-actions','[data-image-copy-status]']) {
      const node = info.querySelector(`:scope > ${selector}`);
      if (node) move(node,quick);
    }
  }

  function communityPage() {
    const hero = main.querySelector('.community-hero');
    if (!hero) return;
    addClass(body,'fs-community-page');
    const info = hero.firstElementChild;
    const title = info?.querySelector('h2');
    const number = info?.querySelector('.group-number');
    const actions = info?.querySelector('.hero-actions');
    if (number && title) move(number,info,title.nextSibling);
    if (actions && number) move(actions,info,number.nextSibling);
  }

  function documentContents() {
    const doc = main.querySelector('.document-page');
    if (!doc || body.classList.contains('fs-submit-page')) return;
    addClass(body,'fs-document-page');
    const headings = [...doc.querySelectorAll('h2[id]')].filter(node => node.id !== 'about-group-title' && node.id !== 'special-thanks-title');
    if (headings.length < 3) return;
    const lede = doc.querySelector(':scope > .lede');
    const nav = create('nav','fs-page-contents',doc,lede?.nextSibling || doc.children[1] || null);
    nav.setAttribute('aria-label',t.contents);
    for (const heading of headings) {
      const link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = heading.textContent.trim();
      nav.append(link);
    }
  }

  function enable() {
    if (active) return;
    // Homepage sections are rendered by the shared homepage component.
    if (body.dataset.page === 'home' || !main.querySelector('.filter-bar,.work-detail,.document-page,.community-hero,.topic-hero,.role-grid,.collection-grid')) return;
    active = true;
    addClass(body,'j-first-screen');
    compactFilters();
    characterPage();
    topicPage();
    submissionPage();
    workPage();
    communityPage();
    documentContents();
    expandHashTarget();
  }
  window.addEventListener('hashchange',expandHashTarget);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',enable,{once:true});
  else enable();
})();
