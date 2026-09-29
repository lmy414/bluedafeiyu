
    /* 首页专题轮播：DEMO.topics 是站长精选的专题（快照已按 order 排好、剔除空专题），全部放进一条横向轨道。
       每 AUTO_MS 自动前进一格，到尾回到开头；鼠标悬停、键盘聚焦、触摸拖动、切到后台时暂停；
       prefers-reduced-motion 时不自动轮换。没有专题时整段保持 hidden。 */
    (function () {
      "use strict";
      var AUTO_MS = 5000;
      var PREVIEW_THUMBS = 3;
      var DEMO = window.DEMO || {};
      var topics = Array.isArray(DEMO.topics) ? DEMO.topics : [];
      var works = Array.isArray(DEMO.works) ? DEMO.works : [];
      var section = document.getElementById("topics");
      var rail = document.getElementById("home-topics");
      var dotsEl = document.getElementById("rail-dots");
      var prevBtn = document.getElementById("rail-prev");
      var nextBtn = document.getElementById("rail-next");
      if (!section || !rail || !topics.length) return;
      var workById = new Map(works.map(function (w) { return [w.id, w]; }));

      function topicText(topic, field) {
        var lang = window.SiteLang && SiteLang.current;
        var localized = lang && topic && topic.i18n && topic.i18n[lang];
        var value = localized && localized[field];
        if (typeof value === "string" && value) return value;
        return String(topic && topic[field] || "");
      }

      function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
      }

      function cardHtml(topic, index) {
        var list = (topic.workIds || []).map(function (id) { return workById.get(id); }).filter(Boolean);
        var cover = workById.get(topic.coverWorkId) || list[0];
        var rest = list.filter(function (w) { return w !== cover; });
        var thumbs = rest.slice(0, PREVIEW_THUMBS).map(function (w) {
          return '<img src="' + escapeHtml(w.thumbUrl) + '" alt="" loading="lazy" decoding="async" />';
        }).join("");
        var more = rest.length > PREVIEW_THUMBS ? '<span class="topic-more">+' + (rest.length - PREVIEW_THUMBS) + "</span>" : "";
        return (
          '<a class="topic-card" href="topics/' + encodeURIComponent(topic.id) + '.html" aria-roledescription="slide">' +
            '<div class="topic-sheet">' +
              '<span class="tape-strip" aria-hidden="true"></span>' +
              (cover ? '<img class="topic-cover" src="' + escapeHtml(cover.thumbUrl) + '" alt="' + escapeHtml(topicText(topic, "name")) + '" loading="' + (index < 3 ? "eager" : "lazy") + '" decoding="async" />' : "") +
              (thumbs || more ? '<div class="topic-thumbs" aria-hidden="true">' + thumbs + more + "</div>" : "") +
              '<div class="topic-body">' +
                '<div class="topic-head">' +
                  '<h3 class="topic-name">' + escapeHtml(topicText(topic, "name")) + "</h3>" +
                  '<span class="topic-count">' + escapeHtml(SiteLang.fmt("topics.count", "{count} 张", { count: list.length })) + "</span>" +
                "</div>" +
                (topicText(topic, "summary") ? '<p class="topic-summary">' + escapeHtml(topicText(topic, "summary")) + "</p>" : "") +
              "</div>" +
            "</div>" +
          "</a>"
        );
      }

      function render() { rail.innerHTML = topics.map(cardHtml).join(""); }

      /* ---------- 轮换：以「第一张完整可见的卡」为当前位置，步进一张 ---------- */
      function cards() { return rail.children; }
      function step() {
        var first = cards()[0], second = cards()[1];
        if (!first) return rail.clientWidth;
        return second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
      }
      function currentIndex() { return Math.round(rail.scrollLeft / Math.max(1, step())); }
      function maxIndex() { return Math.max(0, Math.round((rail.scrollWidth - rail.clientWidth) / Math.max(1, step()))); }
      function go(index) {
        var last = maxIndex();
        var target = index > last ? 0 : index < 0 ? last : index;
        rail.scrollTo({ left: target * step() });
      }
      function renderDots() {
        var count = maxIndex() + 1;
        dotsEl.hidden = count < 2;
        prevBtn.hidden = nextBtn.hidden = count < 2;
        if (dotsEl.children.length !== count) {
          var html = "";
          for (var i = 0; i < count; i++) html += '<button type="button" class="rail-dot" tabindex="-1" data-i="' + i + '"></button>';
          dotsEl.innerHTML = html;
        }
        var now = currentIndex();
        for (var j = 0; j < dotsEl.children.length; j++) dotsEl.children[j].setAttribute("aria-current", String(j === now));
      }

      var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var timer = 0;
      var paused = false;
      function stop() { window.clearInterval(timer); timer = 0; }
      function start() {
        stop();
        if (reduceMotion || paused || document.hidden || maxIndex() < 1) return;
        timer = window.setInterval(function () { go(currentIndex() + 1); }, AUTO_MS);
      }
      function pause() { paused = true; stop(); }
      function resume() { paused = false; start(); }

      prevBtn.addEventListener("click", function () { go(currentIndex() - 1); start(); });
      nextBtn.addEventListener("click", function () { go(currentIndex() + 1); start(); });
      dotsEl.addEventListener("click", function (event) {
        var dot = event.target.closest(".rail-dot");
        if (dot) { go(Number(dot.dataset.i)); start(); }
      });
      rail.addEventListener("keydown", function (event) {
        if (event.key === "ArrowRight") { event.preventDefault(); go(currentIndex() + 1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); go(currentIndex() - 1); }
      });
      section.addEventListener("mouseenter", pause);
      section.addEventListener("mouseleave", resume);
      section.addEventListener("focusin", pause);
      section.addEventListener("focusout", function (event) { if (!section.contains(event.relatedTarget)) resume(); });
      rail.addEventListener("touchstart", pause, { passive: true });
      rail.addEventListener("touchend", function () { window.setTimeout(resume, AUTO_MS); }, { passive: true });
      var dotTick = 0;
      rail.addEventListener("scroll", function () {
        if (dotTick) return;
        dotTick = window.setTimeout(function () { dotTick = 0; renderDots(); }, 120);
      }, { passive: true });
      document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
      window.addEventListener("resize", function () { renderDots(); start(); });

      render();
      section.hidden = false;
      renderDots();
      start();
      document.addEventListener("site:langchange", function () { render(); renderDots(); });
    })();
