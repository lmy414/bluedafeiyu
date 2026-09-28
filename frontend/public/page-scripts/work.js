
    (function () {
      "use strict";
      var btn = document.querySelector("[data-copy-canonical]");
      if (!btn) return;
      btn.addEventListener("click", function () {
        var link = document.querySelector('link[rel="canonical"]');
        var url = link ? link.href : window.location.href;
        var flash = function () {
          btn.textContent = SiteLang.fmt("ui.copied", "已复制");
          window.setTimeout(function () { btn.textContent = SiteLang.fmt("work.copyLink", "复制链接"); }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(flash, function () { window.prompt(SiteLang.fmt("work.copyLink", "复制链接") + "：", url); });
        } else {
          window.prompt(SiteLang.fmt("work.copyLink", "复制链接") + "：", url);
        }
      });
    })();
