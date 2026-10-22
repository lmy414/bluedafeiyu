(() => {
  const form = document.getElementById('creator-registration-form');
  if (!form) return;
  const status = document.getElementById('creator-registration-status'), button = form.querySelector('button[type="submit"]');
  let busy = false, token = '', widget = null;
  const t = (key, text) => window.SiteLang ? window.SiteLang.fmt('d.' + key, text) : text;
  const show = (key, text, ok = false) => { status.hidden = false; status.className = 'form-status ' + (ok ? 'is-ok' : 'is-error'); status.textContent = t(key, text); };
  function renderChallenge() {
    const sitekey = form.dataset.turnstileSitekey;
    if (!sitekey || !window.turnstile || widget !== null) return;
    const width = document.getElementById('creator-turnstile-slot').clientWidth;
    widget = window.turnstile.render('#creator-turnstile-slot', { sitekey, theme: 'auto', size: width > 0 && width < 300 ? 'compact' : 'flexible', callback: value => { token = value; }, 'expired-callback': () => { token = ''; }, 'error-callback': () => { token = ''; } });
  }
  document.addEventListener('turnstile:ready', renderChallenge);
  renderChallenge();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const data = new FormData(form);
    let url; try { url = new URL(String(data.get('homepage')).trim()); } catch { show('creatorUrlError', '请填写完整的 Bilibili 作者主页链接。'); return; }
    if (url.protocol !== 'https:' || url.hostname !== 'space.bilibili.com' || url.username || url.password || url.port || !/^\/[1-9]\d{0,16}(?:\/(?:upload\/)?video)?\/?$/.test(url.pathname)) { show('creatorUrlError', '当前仅开放 Bilibili，请填写 https://space.bilibili.com/数字UID。'); return; }
    if (form.dataset.turnstileSitekey && !token) { show('creatorChallenge', '请先完成人机验证。'); return; }
    busy = true; button.disabled = true;
    show('creatorSending', '正在提交登记…', true);
    try {
      const response = await fetch('/api/v1/creators', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ homepage: url.href, intro: String(data.get('intro')).trim(), confirm: data.get('confirm') === 'on', turnstileToken: token }), signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error('registration failed');
      form.reset(); show('creatorSuccess', '登记已收到。下一次更新时同步公开视频，AI 审核通过后展示。', true);
    } catch { show('creatorFailure', '登记未能确认，请稍后重试；重复提交不会重复登记或覆盖已有资料。'); }
    finally { busy = false; button.disabled = false; token = ''; if (widget !== null) window.turnstile?.reset(widget); }
  });
})();
