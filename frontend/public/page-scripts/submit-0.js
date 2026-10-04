
    // 站内快速投稿：前端校验 → multipart POST 到投稿 API（默认同源 /api/v1/submissions，
    // 可用表单的 data-api-endpoint 覆盖）。只看响应的 ok 字段判定成功，绝不回显
    // 服务器内部路径、sha256 或 AI 结果；失败一律给本地化的通用文案。
    // Turnstile 为可选：表单挂 data-turnstile-sitekey 时才加载控件并回传 turnstileToken。
    (function () {
      var MAX_BYTES = 10 * 1024 * 1024;
      var MAX_NAME = 120;
      var MAX_DESC = 500;
      var DEFAULT_ENDPOINT = "/api/v1/submissions";
      var TIMEOUT_MS = 60000;
      var ALLOWED_TYPES = { "image/png": 1, "image/jpeg": 1, "image/gif": 1, "image/webp": 1, "image/apng": 1 };
      var ALLOWED_EXT = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, apng: 1 };

      var form = document.getElementById("submission-form");
      var fileInput = document.getElementById("f-files");
      var nameInput = document.getElementById("f-name");
      var descInput = document.getElementById("f-desc");
      var characterSelect = document.getElementById("f-character");
      var creditSelect = document.getElementById("f-credit");
      var creditFields = document.getElementById("credit-fields");
      var creditName = document.getElementById("f-credit-name");
      var creditUrl = document.getElementById("f-credit-url");
      var confirmBoxes = [
        document.getElementById("f-confirm-1"),
        document.getElementById("f-confirm-2"),
        document.getElementById("f-confirm-3")
      ];
      var submitBtn = document.getElementById("btn-generate");
      var submitLabel = document.getElementById("btn-generate-text");
      var statusEl = document.getElementById("form-status");
      var turnstileInput = document.getElementById("f-turnstile-token");
      var turnstileRow = document.getElementById("turnstile-row");
      var turnstileSlot = document.getElementById("turnstile-slot");
      var turnstileSitekey = form.getAttribute("data-turnstile-sitekey") || "";
      var turnstileWidgetId = null;

      var busy = false;
      var lastStatus = null;

      function t(key, fallback, params) { return SiteLang.fmt(key, fallback, params); }

      function labelIdle() { submitLabel.textContent = t("submit.form.submit", "站内提交"); }
      function labelBusy() { submitLabel.textContent = t("submit.form.submitting", "提交中…"); }

      function renderStatus() {
        if (!lastStatus) { statusEl.hidden = true; statusEl.textContent = ""; return; }
        statusEl.hidden = false;
        statusEl.className = "form-status " + (lastStatus.kind === "ok" ? "is-ok" : "is-error");
        statusEl.textContent = t(lastStatus.key, lastStatus.fallback, lastStatus.params);
      }
      function setStatus(kind, key, fallback) {
        lastStatus = { kind: kind, key: key, fallback: fallback };
        renderStatus();
      }
      function clearStatus() { lastStatus = null; renderStatus(); }

      function updateCredit() {
        var named = creditSelect.value === "named";
        creditFields.hidden = !named;
        creditName.required = named;
      }
      creditSelect.addEventListener("change", updateCredit);
      updateCredit();

      function extOf(filename) {
        var match = /\.([a-z0-9]+)$/i.exec(String(filename || ""));
        return match ? match[1].toLowerCase() : "";
      }

      /* 返回 { key, fallback, field }；全部通过返回 null。 */
      function validate() {
        var files = fileInput.files;
        if (!files || files.length === 0) {
          return { key: "submit.form.err.fileRequired", fallback: "请先选择一张图片。", field: fileInput };
        }
        if (files.length > 1) {
          return { key: "submit.form.err.fileCount", fallback: "一次只能提交一张图片。", field: fileInput };
        }
        var file = files[0];
        var type = String(file.type || "").toLowerCase();
        if (!ALLOWED_TYPES[type] && !(!type && ALLOWED_EXT[extOf(file.name)])) {
          return { key: "submit.form.err.fileType", fallback: "只支持 PNG / JPG / GIF / WebP / APNG 格式。", field: fileInput };
        }
        if (file.size > MAX_BYTES) {
          return { key: "submit.form.err.fileSize", fallback: "单张图片不能超过 10 MB。", field: fileInput };
        }
        if (file.size === 0) {
          return { key: "submit.form.err.fileEmpty", fallback: "图片内容为空，请重新选择。", field: fileInput };
        }
        var name = nameInput.value.trim();
        if (!name || name.length > MAX_NAME) {
          return { key: "submit.form.err.name", fallback: "请填写图片名称，且不超过 120 字。", field: nameInput };
        }
        if (!characterSelect.value) {
          return { key: "submit.form.err.character", fallback: "请选择角色。", field: characterSelect };
        }
        if (descInput.value.trim().length > MAX_DESC) {
          return { key: "submit.form.err.desc", fallback: "说明不能超过 500 字。", field: descInput };
        }
        if (creditSelect.value !== "named" && creditSelect.value !== "anonymous") {
          return { key: "submit.form.err.credit", fallback: "请选择是否署名。", field: creditSelect };
        }
        if (creditSelect.value === "named") {
          if (!creditName.value.trim() || creditName.value.trim().length > 120) {
            return { key: "submit.form.err.creditName", fallback: "请填写署名名字，且不超过 120 字。", field: creditName };
          }
          var homepage = creditUrl.value.trim();
          if (homepage) {
            try {
              var parsedUrl = new URL(homepage);
              if (!/^https?:$/.test(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || /\s/.test(homepage) || homepage.length > 2048) throw new Error("invalid homepage");
            } catch (err) {
              return { key: "submit.form.err.creditUrl", fallback: "个人主页链接须为有效的 http:// 或 https:// 地址。", field: creditUrl };
            }
          }
        }
        for (var i = 0; i < confirmBoxes.length; i += 1) {
          if (!confirmBoxes[i].checked) {
            return { key: "submit.form.err.confirm", fallback: "请先勾选全部三条确认。", field: confirmBoxes[i] };
          }
        }
        if (turnstileSitekey && !String(turnstileInput.value || "").trim()) {
          return { key: "submit.form.err.turnstile", fallback: "请先完成人机验证。", field: turnstileRow };
        }
        return null;
      }

      /* 只按 HTTP 状态给通用文案，不回显服务器返回的任何正文。 */
      function errorForStatus(status) {
        if (status === 413) return { key: "submit.form.err.tooLarge", fallback: "图片超过大小上限，请压缩后重试。" };
        if (status === 403) return { key: "submit.form.err.rejected", fallback: "提交未被接受，请稍后重试或改用 GitHub 投稿表单。" };
        if (status === 429) return { key: "submit.form.err.busy", fallback: "提交过于频繁：每个 IP 每小时最多投稿 10 次，请稍后再试。" };
        if (status === 400) return { key: "submit.form.err.invalid", fallback: "提交信息未通过校验，请检查后重试。" };
        return { key: "submit.form.err.server", fallback: "提交失败，请稍后重试或改用 GitHub 投稿表单。" };
      }

      function resetTurnstile() {
        if (turnstileWidgetId !== null && window.turnstile && window.turnstile.reset) {
          try { window.turnstile.reset(turnstileWidgetId); } catch (err) { /* 控件已失效：忽略 */ }
        }
        if (turnstileInput) turnstileInput.value = "";
      }

      function finish() {
        busy = false;
        submitBtn.disabled = false;
        submitBtn.removeAttribute("aria-busy");
        labelIdle();
      }

      function submitForm() {
        var endpoint = form.getAttribute("data-api-endpoint") || DEFAULT_ENDPOINT;
        var data = new FormData();
        data.append("image", fileInput.files[0], fileInput.files[0].name);
        data.append("name", nameInput.value.trim());
        data.append("character", characterSelect.value);
        data.append("description", descInput.value.trim());
        data.append("credit", creditSelect.value);
        if (creditSelect.value === "named") {
          data.append("creditName", creditName.value.trim());
          data.append("creditUrl", creditUrl.value.trim());
        }
        data.append("turnstileToken", String(turnstileInput.value || ""));

        busy = true;
        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-busy", "true");
        labelBusy();
        clearStatus();

        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = controller ? window.setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

        fetch(endpoint, {
          method: "POST",
          body: data,
          credentials: "same-origin",
          headers: { "Accept": "application/json" },
          signal: controller ? controller.signal : undefined
        })
          .then(function (response) {
            return response.json()
              .catch(function () { return null; })
              .then(function (payload) { return { response: response, payload: payload }; });
          })
          .then(function (outcome) {
            if (outcome.response.ok && outcome.payload && outcome.payload.ok === true) {
              form.reset();
              updateCredit();
              resetTurnstile();
              setStatus("ok", "submit.form.success", "提交成功，感谢！维护者审核通过后会批量发布。");
            } else {
              resetTurnstile();
              var mapped = errorForStatus(outcome.response.status);
              setStatus("error", mapped.key, mapped.fallback);
            }
          })
          .catch(function () {
            resetTurnstile();
            var mapped = errorForStatus(0);
            setStatus("error", mapped.key, mapped.fallback);
          })
          .then(function () {
            if (timer) window.clearTimeout(timer);
            finish();
          });
      }

      /* 角色下拉：复用站点数据，只列进投稿表单的角色。 */
      var characters = DEMO.characters.filter(function (c) { return c.inSubmissionForm; });
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = t("submit.form.select", "请选择角色");
      characterSelect.innerHTML = "";
      characterSelect.appendChild(placeholder);
      characters.forEach(function (character) {
        var option = document.createElement("option");
        option.value = character.id;
        option.textContent = character.name;
        characterSelect.appendChild(option);
      });
      labelIdle();

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy) return;
        var invalid = validate();
        if (invalid) {
          setStatus("error", invalid.key, invalid.fallback);
          if (invalid.field && invalid.field.focus) invalid.field.focus();
          return;
        }
        submitForm();
      });

      /* 改动任一字段就清掉上一次的报错，避免旧提示误导。 */
      form.addEventListener("input", function () { if (lastStatus && lastStatus.kind === "error") clearStatus(); });
      form.addEventListener("change", function () { if (lastStatus && lastStatus.kind === "error") clearStatus(); });

      /* Turnstile：只有配了 sitekey 才加载，失败不阻塞表单，由服务端最终判定。 */
      function renderTurnstile() {
        if (!turnstileSitekey || !window.turnstile || turnstileWidgetId !== null) return;
        turnstileRow.hidden = false;
        try {
          turnstileWidgetId = window.turnstile.render(turnstileSlot, {
            sitekey: turnstileSitekey,
            theme: "light",
            size: turnstileSlot.clientWidth > 0 && turnstileSlot.clientWidth < 300 ? "compact" : "normal",
            callback: function (token) { turnstileInput.value = token || ""; },
            "expired-callback": function () { turnstileInput.value = ""; },
            "error-callback": function () { turnstileInput.value = ""; }
          });
        } catch (err) {
          turnstileWidgetId = null;
        }
      }
      if (turnstileSitekey) {
        var turnstileScript = document.createElement("script");
        turnstileScript.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        turnstileScript.async = true;
        turnstileScript.defer = true;
        turnstileScript.onload = renderTurnstile;
        document.head.appendChild(turnstileScript);
      }

      /* 语言切换：重写动态文案（占位选项、按钮、当前提示）。 */
      document.addEventListener("site:langchange", function () {
        placeholder.textContent = t("submit.form.select", "请选择角色");
        if (busy) labelBusy(); else labelIdle();
        renderStatus();
      });
    })();

    // 群内投稿卡：复制群号。
    (function () {
      var QQ_NUMBER = "1060898801";
      var copyBtn = document.getElementById("btn-qq-copy");
      var copyText = document.getElementById("btn-qq-copy-text");
      if (!copyBtn) return;
      function done() {
        copyText.textContent = SiteLang.fmt("ui.copied", "已复制");
        window.setTimeout(function () { copyText.textContent = SiteLang.fmt("qq.copy", "复制群号"); }, 1600);
      }
      function fail() {
        copyText.textContent = SiteLang.fmt("ui.copyFail", "复制失败，请手动选择");
        window.setTimeout(function () { copyText.textContent = SiteLang.fmt("qq.copy", "复制群号"); }, 2400);
      }
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
    })();
