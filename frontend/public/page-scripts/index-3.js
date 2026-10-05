
    // 交流群弹窗：开 / 关、Esc 与点背景关闭、复制群号。图片 loading="lazy"，
    // 弹窗没打开前不拉二维码。
    (function () {
      "use strict";
      var modal = document.getElementById("qq-modal");
      var openBtn = document.getElementById("btn-qq-group");
      var copyBtn = document.getElementById("btn-qq-copy");
      var copyText = document.getElementById("btn-qq-copy-text");
      if (!modal || !openBtn) return;
      var QQ_NUMBER = copyBtn && copyBtn.dataset.copyText;

      var lastFocus = null;

      function openModal() {
        lastFocus = document.activeElement;
        modal.hidden = false;
        document.body.style.overflow = "hidden";
        var closeBtn = modal.querySelector("[data-qq-close].btn");
        if (closeBtn) closeBtn.focus();
      }

      function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = "";
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
      }

      openBtn.addEventListener("click", openModal);
      modal.addEventListener("click", function (event) {
        if (event.target.closest("[data-qq-close]")) closeModal();
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !modal.hidden) closeModal();
      });

      function done() {
        copyText.textContent = SiteLang.fmt("ui.copied", "已复制");
        window.setTimeout(function () { copyText.textContent = SiteLang.fmt("qq.copy", "复制群号"); }, 1600);
      }
      function fail() {
        copyText.textContent = SiteLang.fmt("ui.copyFail", "复制失败，请手动选择");
        window.setTimeout(function () { copyText.textContent = SiteLang.fmt("qq.copy", "复制群号"); }, 2400);
      }
      if (copyBtn) {
        copyBtn.addEventListener("click", function () {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(QQ_NUMBER).then(done).catch(fail);
            return;
          }
          try {
            var ta = document.createElement("textarea");
            ta.value = QQ_NUMBER;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand("copy");
            document.body.removeChild(ta);
            ok ? done() : fail();
          } catch (err) {
            fail();
          }
        });
      }
    })();
