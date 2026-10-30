// Runs as the body opens, before navigation or page content can be painted.
(function () {
  'use strict';
  var key = 'bluefish-sidebar';
  function apply(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    document.querySelector('[data-sidebar-collapse]')?.setAttribute('aria-expanded', String(!collapsed));
  }
  try { apply(localStorage.getItem(key) === 'collapsed'); } catch (_) { apply(false); }
  document.addEventListener('DOMContentLoaded', function () {
    apply(document.body.classList.contains('sidebar-collapsed'));
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('[data-sidebar-collapse]')) return;
    var collapsed = !document.body.classList.contains('sidebar-collapsed');
    apply(collapsed);
    try { localStorage.setItem(key, collapsed ? 'collapsed' : 'expanded'); } catch (_) {}
    window.dispatchEvent(new Event('resize'));
  });
})();
