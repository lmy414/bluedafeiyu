// 在样式加载前应用主题；未选择时跟随系统，手动选择后跨页面记忆。
(function () {
  'use strict';
  var key = 'bluedafeiyu-theme';
  var root = document.documentElement;
  var system = window.matchMedia('(prefers-color-scheme: dark)');
  var preference = null;
  function valid(value) { return value === 'dark' || value === 'light'; }
  try { var saved = localStorage.getItem(key); if (valid(saved)) preference = saved; } catch (_) {}
  function label() {
    var dark = root.dataset.theme === 'dark';
    var text = dark ? '切换到白天模式' : '切换到黑夜模式';
    if (window.SiteLang) text = window.SiteLang.t(dark ? 'theme.toLight' : 'theme.toDark', text);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.hidden = false;
      button.setAttribute('aria-label', text);
      button.title = text;
      button.setAttribute('aria-pressed', String(dark));
    });
  }
  function apply() {
    var theme = preference || (system.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    label();
    // 已加载的评论也同步主题；作品与二维码的颜色保持原样。
    document.querySelectorAll('iframe.giscus-frame').forEach(function (frame) {
      frame.contentWindow.postMessage({ giscus: { setConfig: { theme: theme } } }, 'https://giscus.app');
    });
    document.dispatchEvent(new CustomEvent('site:themechange', { detail: { theme: theme } }));
  }
  apply();
  document.addEventListener('DOMContentLoaded', label);
  document.addEventListener('site:langchange', label);
  document.addEventListener('click', function (event) {
    if (!event.target.closest('[data-theme-toggle]')) return;
    preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, preference); } catch (_) {}
    apply();
  });
  system.addEventListener('change', function () { if (!preference) apply(); });
  window.addEventListener('storage', function (event) {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    apply();
  });
})();
