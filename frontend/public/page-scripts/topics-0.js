
  /* 专题页：DEMO.topics 由 tools/build_site_snapshot.mjs 从 data/topics.json 生成（已剔除下架作品、按 order 排好）。
     专题由站长人工精选、不分类。状态进 URL hash：目录 #q=<搜索词>，详情 #t=<topicId>&q=<专题内搜索词>；
     t 认不出时回到目录。目录与详情都是瀑布流；详情按 PAGE_SIZE 增量追加，与分类页同一套观察器 + 按钮 + 滚动兜底。 */
  (function () {
    "use strict";

    const PAGE_SIZE = 24;
    const EAGER_CARDS = 6;
    const PREVIEW_THUMBS = 3;
    const DEMO = window.DEMO || {};
    const characters = Array.isArray(DEMO.characters) ? DEMO.characters : [];
    const works = Array.isArray(DEMO.works) ? DEMO.works : [];
    const topics = Array.isArray(DEMO.topics) ? DEMO.topics : [];

    const indexEl = document.getElementById("topic-index");
    const detailEl = document.getElementById("topic-detail");
    const topicGridEl = document.getElementById("topic-grid");
    const noneEl = document.getElementById("topic-none");
    const missEl = document.getElementById("topic-miss");
    const topicSearch = document.getElementById("topicSearch");
    const topicCountEl = document.getElementById("topic-count");
    const coverEl = document.getElementById("topic-cover");
    const totalEl = document.getElementById("topic-total");
    const titleEl = document.getElementById("topic-title");
    const summaryEl = document.getElementById("topic-summary");
    const chipsEl = document.getElementById("topic-chips");
    const searchInput = document.getElementById("searchInput");
    const countEl = document.getElementById("count");
    const gridEl = document.getElementById("grid");
    const endNoteEl = document.getElementById("end-note");
    const emptyEl = document.getElementById("empty");
    const sentinel = document.getElementById("sentinel");
    const loadMoreWrap = document.getElementById("load-more-wrap");
    const loadMoreBtn = document.getElementById("load-more");

    const charById = new Map(characters.map((item) => [item.id, item]));
    const workById = new Map(works.map((item) => [item.id, item]));
    const topicById = new Map(topics.map((item) => [item.id, item]));

    function normalize(value) {
      return String(value == null ? "" : value).toLocaleLowerCase("zh-CN").replace(/[\s_\-—–]+/g, "");
    }
    function escapeHtml(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
      }[char]));
    }
    function topicWorks(topic) {
      return (topic.workIds || []).map((id) => workById.get(id)).filter(Boolean);
    }
    /* 专题的可见名称与简介按当前界面语言取 i18n，缺失时回落中文。 */
    function topicText(topic, field) {
      const lang = window.SiteLang && SiteLang.current;
      const localized = lang && topic && topic.i18n && topic.i18n[lang];
      const value = localized && localized[field];
      if (typeof value === "string" && value) return value;
      return String(topic && topic[field] || "");
    }
    /* 目录搜索口径：当前语言的专题名 + 简介 + 收录作品的名称与 Tag。 */
    function topicSearchFields(topic) {
      return [topicText(topic, "name"), topicText(topic, "summary")]
        .concat(...topicWorks(topic).map((work) => [work.name].concat(Array.isArray(work.tags) ? work.tags : [])))
        .map(normalize);
    }
    function topicMatches(topic, tokens) {
      const fields = topicSearchFields(topic);
      return tokens.every((token) => fields.some((field) => field.indexOf(token) !== -1));
    }

    /* 卡片图 alt：与分类页同一公式（archive/2026-09-24/docs/SEO规范.md §7） */
    function altFor(work) {
      const character = charById.get(work.characterId);
      const characterName = character ? character.name : SiteLang.fmt("char.unknown", "未知角色");
      const kindId = (Array.isArray(work.categoryIds) ? work.categoryIds : [])[0] || "";
      const kindWord = SiteLang.fmt(
        "kind." + (kindId || "meme"),
        ({ meme: "表情包", illustration: "二创插画", setting: "设定图", comic: "漫画", standing: "立绘", other: "其他作品" })[kindId] || "表情包"
      );
      if (SiteLang.current !== "zh") {
        return SiteLang.fmt("alt.work", "", { name: work.name, character: characterName, kindId: kindId || "meme" });
      }
      const tags = (Array.isArray(work.tags) ? work.tags : []).slice(0, 2).join("、");
      const text = "《" + String(work.name == null ? "" : work.name) + "》" + characterName + kindWord;
      return tags ? text + "，" + tags + " AI娘二创图" : text;
    }

    /* ---------- 专题目录卡（与首页入口同一结构，样式在 styles.css .topic-*） ---------- */
    function topicCardMarkup(topic, index) {
      const list = topicWorks(topic);
      const cover = workById.get(topic.coverWorkId) || list[0];
      const rest = list.filter((work) => work !== cover);
      const thumbs = rest.slice(0, PREVIEW_THUMBS).map((work) =>
        '<img src="' + escapeHtml(work.thumbUrl) + '" alt="" loading="lazy" decoding="async" />'
      ).join("");
      const more = rest.length > PREVIEW_THUMBS ? '<span class="topic-more">+' + (rest.length - PREVIEW_THUMBS) + "</span>" : "";
      return (
        '<a class="topic-card" href="topics/' + encodeURIComponent(topic.id) + '.html">' +
          '<div class="topic-sheet">' +
            '<span class="tape-strip" aria-hidden="true"></span>' +
            (cover ? '<img class="topic-cover" src="' + escapeHtml(cover.thumbUrl) + '" alt="' + escapeHtml(altFor(cover)) + '"' +
              (cover.width && cover.height ? ' width="' + escapeHtml(cover.width) + '" height="' + escapeHtml(cover.height) + '"' : "") +
              ' loading="' + (index < 3 ? "eager" : "lazy") + '" decoding="async" />' : "") +
            (thumbs || more ? '<div class="topic-thumbs" aria-hidden="true">' + thumbs + more + "</div>" : "") +
            '<div class="topic-body">' +
              '<div class="topic-head">' +
                '<h2 class="topic-name">' + escapeHtml(topicText(topic, "name")) + "</h2>" +
                '<span class="topic-count">' + escapeHtml(SiteLang.fmt("topics.count", "{count} 张", { count: list.length })) + "</span>" +
              "</div>" +
              (topicText(topic, "summary") ? '<p class="topic-summary">' + escapeHtml(topicText(topic, "summary")) + "</p>" : "") +
            "</div>" +
          "</div>" +
        "</a>"
      );
    }

    function cardMarkup(work, index) {
      const character = charById.get(work.characterId);
      const name = String(work.name == null ? "" : work.name);
      const meta = [character ? character.name : SiteLang.fmt("char.unknown", "未知角色")];
      if (work.format) meta.push(String(work.format).toUpperCase());
      if (work.width && work.height) meta.push(work.width + "×" + work.height);
      const sizeAttrs = work.width && work.height
        ? ' width="' + escapeHtml(work.width) + '" height="' + escapeHtml(work.height) + '"'
        : "";
      const tags = (Array.isArray(work.tags) ? work.tags : []).slice(0, 3).map((tag) => "#" + tag).join(" ");
      const loading = index < EAGER_CARDS ? "eager" : "lazy";
      return (
        '<a class="card" href="works/' + encodeURIComponent(work.slug) + '.html">' +
          '<img class="card-art" src="' + escapeHtml(work.thumbUrl) + '" alt="' + escapeHtml(altFor(work)) + '"' + sizeAttrs +
            ' loading="' + loading + '" decoding="async" />' +
          '<div class="card-body">' +
            '<h2 class="card-title" title="' + escapeHtml(name) + '">' + escapeHtml(name) + "</h2>" +
            '<p class="card-meta">' + escapeHtml(meta.join(" · ")) + "</p>" +
            (tags ? '<p class="card-tags">' + escapeHtml(tags) + "</p>" : "") +
          "</div>" +
        "</a>"
      );
    }

    /* ---------- URL hash：#t=<topicId>&q=<搜索词> ---------- */
    function parseHash(raw) {
      const next = { t: "", q: "" };
      const text = String(raw == null ? "" : raw).replace(/^#/, "");
      if (!text) return next;
      let params = null;
      try { params = new URLSearchParams(text); } catch (err) { return next; }
      const id = String(params.get("t") || "").trim().toLowerCase();
      if (topicById.has(id)) next.t = id;
      next.q = params.get("q") || "";
      return next;
    }
    function buildHash(value) {
      const params = new URLSearchParams();
      if (value.t) params.set("t", value.t);
      if (value.q) params.set("q", value.q);
      return params.toString();
    }
    function writeHash(value, mode) {
      const next = buildHash(value);
      const current = String(window.location.hash || "").replace(/^#/, "");
      if (next === current) return;
      const target = next ? "#" + next : window.location.pathname + window.location.search;
      try {
        if (mode === "replace") window.history.replaceState(null, "", target);
        else window.history.pushState(null, "", target);
      } catch (err) {
        if (mode !== "replace") window.location.hash = next ? "#" + next : "";
      }
    }

    let state = parseHash(window.location.hash);
    let searchTimer = 0;
    let list = [];
    let renderedCount = 0;

    function updateStatus() {
      const total = list.length;
      const exhausted = total > 0 && renderedCount >= total;
      endNoteEl.hidden = !exhausted;
      if (exhausted) endNoteEl.textContent = SiteLang.fmt("list.end", "已经到底了 · 共 {total} 张", { total: total });
      emptyEl.hidden = total !== 0;
      loadMoreWrap.hidden = exhausted || total === 0;
      loadMoreBtn.disabled = exhausted;
    }
    function appendNextPage() {
      if (!state.t) return;
      if (renderedCount >= list.length) { updateStatus(); return; }
      const slice = list.slice(renderedCount, renderedCount + PAGE_SIZE);
      gridEl.insertAdjacentHTML("beforeend", slice.map((work, i) => cardMarkup(work, renderedCount + i)).join(""));
      renderedCount += slice.length;
      updateStatus();
    }

    function renderIndex() {
      const tokens = state.t ? [] : String(state.q || "").split(/\s+/).map(normalize).filter(Boolean);
      const shown = topics.filter((topic) => topicMatches(topic, tokens));
      if (!state.t && topicSearch.value !== state.q) topicSearch.value = state.q;
      topicGridEl.innerHTML = shown.map(topicCardMarkup).join("");
      topicCountEl.textContent = SiteLang.fmt("topics.indexCount", "{matched} / {total} 个专题", { matched: shown.length, total: topics.length });
      topicCountEl.hidden = topics.length === 0;
      noneEl.hidden = topics.length !== 0;
      missEl.hidden = topics.length === 0 || shown.length !== 0;
    }

    function renderChips() {
      chipsEl.innerHTML = "";
      for (const topic of topics) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chip";
        button.dataset.id = topic.id;
        button.appendChild(document.createTextNode(topicText(topic, "name")));
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = String(topicWorks(topic).length);
        button.appendChild(num);
        button.addEventListener("click", () => {
          if (topic.id === state.t) return;
          commit({ t: topic.id, q: "" }, "push");
          window.scrollTo(0, 0);
        });
        chipsEl.appendChild(button);
      }
    }

    function render() {
      const topic = state.t ? topicById.get(state.t) : null;
      indexEl.hidden = !!topic;
      detailEl.hidden = !topic;
      if (!topic) {
        list = [];
        gridEl.innerHTML = "";
        renderIndex();
        return;
      }
      const scope = topicWorks(topic);
      const cover = workById.get(topic.coverWorkId) || scope[0];
      if (cover) {
        coverEl.src = cover.thumbUrl;
        coverEl.alt = altFor(cover);
      }
      totalEl.textContent = SiteLang.fmt("topics.count", "{count} 张", { count: scope.length });
      titleEl.textContent = topicText(topic, "name");
      summaryEl.textContent = topicText(topic, "summary");
      summaryEl.hidden = !summaryEl.textContent;
      for (const button of chipsEl.children) {
        const selected = button.dataset.id === topic.id;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      }
      if (searchInput.value !== state.q) searchInput.value = state.q;
      const needle = normalize(state.q);
      list = needle ? scope.filter((work) =>
        normalize(work.name).indexOf(needle) !== -1 ||
        (Array.isArray(work.tags) ? work.tags : []).some((tag) => normalize(tag).indexOf(needle) !== -1)
      ) : scope;
      countEl.textContent = SiteLang.fmt("list.scopedCount", "{matched} / {total} 张", { matched: list.length, total: scope.length });
      gridEl.innerHTML = "";
      renderedCount = 0;
      endNoteEl.hidden = true;
      appendNextPage();
      updateStatus();
    }

    function commit(next, mode) {
      window.clearTimeout(searchTimer);
      state = { t: next.t, q: next.q };
      writeHash(state, mode);
      render();
    }
    function syncFromLocation() {
      window.clearTimeout(searchTimer);
      const next = parseHash(window.location.hash);
      const topicChanged = next.t !== state.t;
      if (topicChanged || next.q !== state.q) {
        state = next;
        render();
        if (topicChanged) window.scrollTo(0, 0);
      }
      writeHash(state, "replace");
    }

    topicSearch.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => commit({ t: "", q: topicSearch.value }, "replace"), 200);
    });
    searchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => commit({ t: state.t, q: searchInput.value }, "replace"), 200);
    });
    document.addEventListener("site:langchange", () => { renderChips(); render(); });
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);

    if (typeof IntersectionObserver === "function" && sentinel) {
      const observer = new IntersectionObserver((records) => {
        if (records.some((record) => record.isIntersecting)) appendNextPage();
      }, { rootMargin: "320px 0px" });
      observer.observe(sentinel);
    }
    loadMoreBtn.addEventListener("click", () => appendNextPage());
    let scrollTick = 0;
    window.addEventListener("scroll", () => {
      if (scrollTick) return;
      scrollTick = window.setTimeout(() => {
        scrollTick = 0;
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 480) appendNextPage();
      }, 80);
    }, { passive: true });

    renderChips();
    render();
    writeHash(state, "replace");
  })();
