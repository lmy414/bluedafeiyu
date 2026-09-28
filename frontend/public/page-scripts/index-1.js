
    (function () {
      "use strict";

      var PAGE_SIZE = 24;
      /* 首屏图片优先级：序号 < EAGER_CARDS 的卡片以 eager 正常加载（兼顾移动端 2 列时也不过多），
         其中第一张真实作品图额外 fetchpriority=high 抢 LCP；其余一律 lazy。序号取「当前筛选
         结果里的渲染序号」，因此分页续接的新页卡片仍走 lazy，不会反复给新页首图 high。 */
      var EAGER_CARDS = 6;
      var DEMO = window.DEMO || {};
      var characters = Array.isArray(DEMO.characters) ? DEMO.characters : [];
      var works = Array.isArray(DEMO.works) ? DEMO.works : [];

      var grid = document.getElementById("grid");
      var gallery = document.getElementById("gallery");
      var searchInput = document.getElementById("search");
      var sortSelect = document.getElementById("sort");
      var countEl = document.getElementById("count");
      var endNote = document.getElementById("end-note");
      var emptyEl = document.getElementById("empty");
      var sentinel = document.getElementById("sentinel");

      var characterById = new Map(characters.map(function (c) { return [c.id, c]; }));

      /* 归一：小写化并去掉空格 / 下划线 / 短横线后再比 */
      function normalize(value) {
        return String(value == null ? "" : value).toLowerCase().replace(/[\s_\-]+/g, "");
      }

      function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
      }

      /* FNV-1a：给 id 算稳定权重，「随机浏览」每次渲染顺序一致 */
      function hashId(id) {
        var h = 2166136261;
        for (var i = 0; i < id.length; i++) {
          h ^= id.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return h >>> 0;
      }

      /* entries 由语言决定（未知角色名随语言走），切换语言时重建 */
      function buildEntries() {
        return works.map(function (work, index) {
          var character = characterById.get(work.characterId) || null;
          var fields = [work.name].concat(work.tags || []);
          if (character) {
            fields.push(character.name);
            fields.push.apply(fields, character.aliases || []);
          }
          return {
            work: work,
            index: index,
            characterName: character ? character.name : SiteLang.fmt("char.unknown", "未知角色"),
            fields: fields.map(normalize),
            randomKey: hashId(String(work.id == null ? index : work.id))
          };
        });
      }
      var entries = buildEntries();

      var comparators = {
        newest: function (a, b) { return a.index - b.index; },
        oldest: function (a, b) { return b.index - a.index; },
        "name-asc": function (a, b) {
          return String(a.work.name || "").localeCompare(String(b.work.name || ""), "zh") || a.index - b.index;
        },
        "name-desc": function (a, b) {
          return String(b.work.name || "").localeCompare(String(a.work.name || ""), "zh") || a.index - b.index;
        },
        size: function (a, b) { return (a.work.fileSize - b.work.fileSize) || a.index - b.index; },
        random: function (a, b) { return a.randomKey - b.randomKey || a.index - b.index; }
      };

      function parseQuery(raw) {
        return String(raw || "").split(/\s+/).map(normalize).filter(Boolean);
      }

      function matchesQuery(entry, tokens) {
        return tokens.every(function (token) {
          return entry.fields.some(function (field) { return field.indexOf(token) !== -1; });
        });
      }

      var filtered = [];
      var renderedCount = 0;

      /* 卡片图 alt（archive/2026-09-24/docs/SEO规范.md §7 列表卡片图公式）：《{name}》{characterName}{kindWord}，{tags顿号}AI娘二创图。
         zh 保持原公式；en / ja 走 lang.js 的 alt.work 模板（{kindId} 由词典解析成品类词，不含中文 tag）。 */
      function altFor(work) {
        var character = characterById.get(work.characterId);
        var characterName = character ? character.name : SiteLang.fmt("char.unknown", "未知角色");
        var kindId = (work.categoryIds || [])[0] || "";
        var kindWord = SiteLang.fmt(
          "kind." + (kindId || "meme"),
          ({ meme: "表情包", illustration: "二创插画", setting: "立绘设定图", comic: "漫画" })[kindId] || "表情包"
        );
        if (SiteLang.current !== "zh") {
          return SiteLang.fmt("alt.work", "", { name: work.name, character: characterName, kindId: kindId || "meme" });
        }
        var tags = (work.tags || []).slice(0, 2).join("、");
        var text = "《" + String(work.name == null ? "" : work.name) + "》" + characterName + kindWord;
        return tags ? text + "，" + tags + " AI娘二创图" : text;
      }

      function cardHtml(entry, index) {
        var work = entry.work;
        var tags = (work.tags || []).slice(0, 3).map(function (tag) { return "#" + tag; }).join(" ");
        var format = String(work.format || "").toUpperCase();
        var meta = entry.characterName + " · " + format + " · " + work.width + " × " + work.height;
        var loading = index < EAGER_CARDS ? "eager" : "lazy";
        var priority = index === 0 ? ' fetchpriority="high"' : "";
        return (
          '<article class="card">' +
            `<a class="card-art-link" href="works/${work.slug}.html">` +
              '<img class="card-art" src="' + escapeHtml(work.thumbUrl) + '" alt="' + escapeHtml(altFor(work)) + '"' +
                ' width="' + escapeHtml(work.width) + '" height="' + escapeHtml(work.height) + '"' +
                ' loading="' + loading + '" decoding="async"' + priority + ' />' +
            '</a>' +
            '<div class="card-body">' +
              '<h3 class="card-title" title="' + escapeHtml(work.name) + '">' + escapeHtml(work.name) + '</h3>' +
              '<p class="card-meta">' + escapeHtml(meta) + '</p>' +
              '<p class="card-tags">' + escapeHtml(tags) + '</p>' +
            '</div>' +
          '</article>'
        );
      }

      function updateStatus() {
        var total = filtered.length;
        var shown = Math.min(renderedCount, total);
        countEl.textContent = SiteLang.fmt("list.count", "已显示 {shown} / {total} 张", { shown: shown, total: total });
        var exhausted = total > 0 && renderedCount >= total;
        endNote.hidden = !exhausted;
        if (exhausted) {
          endNote.textContent = SiteLang.fmt("list.end", "已经到底了 · 共 {total} 张", { total: total });
        }
        emptyEl.hidden = total !== 0;
      }

      function appendNextPage() {
        if (renderedCount >= filtered.length) { updateStatus(); return; }
        var slice = filtered.slice(renderedCount, renderedCount + PAGE_SIZE);
        grid.insertAdjacentHTML("beforeend", slice.map(function (entry, i) { return cardHtml(entry, renderedCount + i); }).join(""));
        renderedCount += slice.length;
        updateStatus();
      }

      function refresh() {
        var tokens = parseQuery(searchInput.value);
        var compare = comparators[sortSelect.value] || comparators.newest;
        filtered = entries.filter(function (entry) { return matchesQuery(entry, tokens); }).sort(compare);
        grid.innerHTML = "";
        renderedCount = 0;
        appendNextPage();
      }

      /* 事件只在初始化绑一次：卡片是委托处理，重渲染不重绑 */
      searchInput.addEventListener("input", refresh);
      sortSelect.addEventListener("change", refresh);
      /* 语言切换：重算未知角色名等随语言走的字段，再整列重渲染 */
      document.addEventListener("site:langchange", function () {
        entries = buildEntries();
        refresh();
      });
      var observer = new IntersectionObserver(function (records) {
        if (records.some(function (record) { return record.isIntersecting; })) { appendNextPage(); }
      }, { rootMargin: "320px 0px" });
      observer.observe(sentinel);

      refresh();
    })();
