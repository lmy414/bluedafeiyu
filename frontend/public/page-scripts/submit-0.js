
    // 站内快速投稿：前端校验 → multipart POST 到投稿 API（默认同源 /api/v1/submissions，
    // 可用表单的 data-api-endpoint 覆盖）。成功核对 ok，ZIP 另核对计数，绝不回显
    // 服务器内部路径、sha256 或 AI 结果；失败一律给本地化的通用文案。
    // Turnstile 为可选：表单挂 data-turnstile-sitekey 时才加载控件并回传 turnstileToken。
    (function () {
      var MAX_BYTES = 10 * 1024 * 1024;
      var MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
      var MAX_NAME = 120;
      var MAX_DESC = 500;
      var DEFAULT_ENDPOINT = "/api/v1/submissions";
      var TIMEOUT_MS = 60000;
      var ARCHIVE_TIMEOUT_MS = 180000;
      var ALLOWED_TYPES = { "image/png": 1, "image/jpeg": 1, "image/gif": 1, "image/webp": 1, "image/apng": 1 };
      var ALLOWED_EXT = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, apng: 1 };

      var form = document.getElementById("submission-form");
      var fileInput = document.getElementById("f-files");
      var nameInput = document.getElementById("f-name");
      var descInput = document.getElementById("f-desc");
      var characterChoices = document.getElementById("character-choices");
      var selectedCharacters = function () { return Array.from(characterChoices.querySelectorAll('input:checked')).map(function (input) { return input.value; }); };
      var typeSelect = document.getElementById("f-type");
      var nonAiCheckbox = document.getElementById("f-non-ai");
      var typeHint = document.getElementById("type-hint");
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
      var idleText = submitLabel.textContent;
      var statusEl = document.getElementById("form-status");
      var turnstileInput = document.getElementById("f-turnstile-token");
      var turnstileRow = document.getElementById("turnstile-row");
      var turnstileSlot = document.getElementById("turnstile-slot");
      var turnstileSitekey = form.getAttribute("data-turnstile-sitekey") || "";
      var turnstileWidgetId = null;

      var busy = false;
      var lastStatus = null;

      function t(key, fallback, params) { return window.SiteLang ? SiteLang.fmt(key, fallback, params) : String(fallback).replace(/\{(\w+)\}/g, function (_, name) { return params && params[name] !== undefined ? params[name] : ''; }); }

      function labelIdle() { submitLabel.textContent = t("submit.form.submit", idleText); }
      function labelBusy() { submitLabel.textContent = t("submit.form.submitting", "提交中…"); }

      function renderStatus() {
        if (!lastStatus) { statusEl.hidden = true; statusEl.textContent = ""; return; }
        statusEl.hidden = false;
        statusEl.className = "form-status " + (lastStatus.kind === "ok" ? "is-ok" : "is-error");
        statusEl.textContent = t(lastStatus.key, lastStatus.fallback, lastStatus.params);
      }
      function setStatus(kind, key, fallback, params) {
        lastStatus = { kind: kind, key: key, fallback: fallback, params: params };
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
          return { key: "submit.form.err.fileRequired", fallback: "请先选择一张图片或一个 ZIP 压缩包。", field: fileInput };
        }
        if (files.length > 1) {
          return { key: "submit.form.err.fileCount", fallback: "一次只能提交一张图片或一个 ZIP 压缩包。", field: fileInput };
        }
        var file = files[0];
        var type = String(file.type || "").toLowerCase();
        var archive = extOf(file.name) === "zip";
        if (!archive && !ALLOWED_TYPES[type] && !(!type && ALLOWED_EXT[extOf(file.name)])) {
          return { key: "submit.form.err.fileType", fallback: "只支持 PNG / JPG / GIF / WebP / APNG 图片或 ZIP 压缩包。", field: fileInput };
        }
        if (archive && file.size > MAX_ARCHIVE_BYTES) {
          return { key: "submit.form.err.archiveSize", fallback: "ZIP 压缩包不能超过 32 MiB。", field: fileInput };
        }
        if (!archive && file.size > MAX_BYTES) {
          return { key: "submit.form.err.fileSize", fallback: "单张图片不能超过 10 MiB。", field: fileInput };
        }
        if (file.size === 0) {
          return { key: "submit.form.err.fileEmpty", fallback: "文件内容为空，请重新选择。", field: fileInput };
        }
        var name = nameInput.value.trim();
        if (!name || name.length > MAX_NAME) {
          return { key: "submit.form.err.name", fallback: "请填写图片或图集名称，且不超过 120 字。", field: nameInput };
        }
        if (!selectedCharacters().length) {
          return { key: "submit.form.err.character", fallback: "请选择角色。", field: characterChoices.querySelector('input') };
        }
        if (!typeSelect.value || !typeSelect.selectedOptions[0]) {
          return { key: "submit.form.err.type", fallback: "请选择一个作品类型。", field: typeSelect };
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

      /* 仅识别固定错误码与 HTTP 状态，不回显服务端错误原文。 */
      function errorForStatus(status, payload) {
        if (payload && payload.code === "INVALID_ARCHIVE") return { key: "submit.form.err.archiveInvalid", fallback: "ZIP 校验未通过：请使用未加密、仅含图片的 ZIP，最多 100 张，包内单图 ≤ 16 MiB、解压总量 ≤ 64 MiB；不支持嵌套压缩包。" };
        if (payload && payload.code === "ARCHIVE_RETRY") return { key: "submit.form.err.archiveRetry", fallback: "图集尚未完整接收，请保留文件并重试；已接收的图片会自动去重。" };
        if (status === 413) return { key: "submit.form.err.tooLarge", fallback: "文件超过大小上限，请检查单图或 ZIP 的大小后重试。" };
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
        var archive = extOf(fileInput.files[0].name) === "zip";
        var data = new FormData();
        data.append("image", fileInput.files[0], fileInput.files[0].name);
        data.append("name", nameInput.value.trim());
        data.append("character", selectedCharacters()[0]);
        data.append("characterIds", JSON.stringify(selectedCharacters()));
        data.append("categoryId", typeSelect.value);
        if (nonAiCheckbox && nonAiCheckbox.checked) data.append("nonAi", "true");
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
        var timer = controller ? window.setTimeout(function () { controller.abort(); }, archive ? ARCHIVE_TIMEOUT_MS : TIMEOUT_MS) : null;

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
              if (archive && !validArchiveCounts(outcome.payload)) {
                resetTurnstile();
                setStatus("error", "submit.form.err.archiveRetry", "图集尚未完整接收，请保留文件并重试；已接收的图片会自动去重。");
                return;
              }
              form.reset();
              updateTypeHint();
              updateCredit();
              resetTurnstile();
              if (archive) {
                setStatus("ok", "submit.form.archiveSuccess", "已接收 {count} 张：新投稿 {created} 张，重复 {duplicates} 张。新投稿将逐张审核，通过后批量发布。", { count: outcome.payload.count, created: outcome.payload.created, duplicates: outcome.payload.duplicates });
              } else {
                setStatus("ok", "submit.form.success", "提交成功，感谢！审核通过后会批量发布。");
              }
            } else {
              resetTurnstile();
              var mapped = errorForStatus(outcome.response.status, outcome.payload);
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

      function validArchiveCounts(payload) {
        return Number.isInteger(payload.count) && payload.count >= 1 && payload.count <= 100
          && Number.isInteger(payload.created) && payload.created >= 0
          && Number.isInteger(payload.duplicates) && payload.duplicates >= 0
          && payload.created + payload.duplicates === payload.count;
      }

      labelIdle();
      var defaultTypeHint = typeHint.textContent;

      function updateTypeHint() {
        var option = typeSelect.selectedOptions[0];
        var key = typeSelect.value ? "submit.typeDesc." + typeSelect.value : "submit.form.typeHint";
        typeHint.setAttribute("data-i18n", key);
        typeHint.textContent = t(key, typeSelect.value ? option.getAttribute('data-description') : defaultTypeHint);
      }
      typeSelect.addEventListener("change", updateTypeHint);
      updateTypeHint();

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
        turnstileScript.onload = function () { renderTurnstile(); document.dispatchEvent(new Event('turnstile:ready')); };
        document.head.appendChild(turnstileScript);
      }

      document.addEventListener("site:langchange", function () {
        updateTypeHint();
        characterChoices.querySelectorAll('[data-character-name]').forEach(function (label) {
          label.textContent = SiteLang.characterName(label.getAttribute('data-character-name'), label.getAttribute('data-character-label'));
        });
        if (busy) labelBusy(); else labelIdle();
        renderStatus();
      });
    })();

    // 群内投稿卡：复制群号。
    (function () {
      var copyBtn = document.getElementById("btn-qq-copy");
      var copyText = document.getElementById("btn-qq-copy-text");
      if (!copyBtn) return;
      var QQ_NUMBER = copyBtn.dataset.copyText;
      var copyIdle = copyText.textContent;
      function t(key, fallback) { return window.SiteLang ? SiteLang.fmt(key, fallback) : fallback; }
      function done() {
        copyText.textContent = t("ui.copied", "已复制");
        window.setTimeout(function () { copyText.textContent = t("qq.copy", copyIdle); }, 1600);
      }
      function fail() {
        copyText.textContent = t("ui.copyFail", "复制失败，请手动选择");
        window.setTimeout(function () { copyText.textContent = t("qq.copy", copyIdle); }, 2400);
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
          SiteComponents.clipboardField(ta);

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
