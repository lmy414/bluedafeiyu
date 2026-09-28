
  /* 分类页逻辑：角色、类型两级单选筛选 + 范围内搜索，状态进 URL hash（#c=&s=&q=）
     结果按 PAGE_SIZE 增量渲染：先出首批，滚动接近底部时由 IntersectionObserver 追加下一批，
     避免一次把全部作品卡片 / 图片都插进 DOM。 */
  (function () {
    "use strict";

    /* 每批渲染的卡片数：首批在状态变化后立即入 DOM，其余等观察器 /「加载更多」续接 */
    const PAGE_SIZE = 24;
    /* 首屏图片优先级：序号 < EAGER_CARDS 的卡片 eager 正常加载，其中第一张额外
       fetchpriority=high 抢 LCP；其余 lazy。序号取当前结果里的渲染位置，因此续接批次
       仍走 lazy，不会反复给新页首图 high。 */
    const EAGER_CARDS = 6;
    const DEMO = window.DEMO || {};
    const characters = Array.isArray(DEMO.characters) ? DEMO.characters : [];
    const categories = Array.isArray(DEMO.categories) ? DEMO.categories : [];
    const works = Array.isArray(DEMO.works) ? DEMO.works : [];

    const charChipsEl = document.getElementById("charChips");
    const catChipsEl = document.getElementById("catChips");
    const searchInput = document.getElementById("searchInput");
    const countEl = document.getElementById("count");
    const gridEl = document.getElementById("grid");
    const endNoteEl = document.getElementById("end-note");
    const emptyEl = document.getElementById("empty");
    const sentinel = document.getElementById("sentinel");
    const loadMoreWrap = document.getElementById("load-more-wrap");
    const loadMoreBtn = document.getElementById("load-more");

    const charById = new Map();
    const catById = new Map();
    const charByLower = new Map();
    const catByLower = new Map();
    for (const character of characters) {
      charById.set(character.id, character);
      charByLower.set(String(character.id).toLowerCase(), character.id);
    }
    for (const category of categories) {
      catById.set(category.id, category);
      catByLower.set(String(category.id).toLowerCase(), category.id);
    }

    /* 计数：角色行固定（全部 = 总数）；类型行跟随当前角色范围（全部角色 = 全站） */
    const charCounts = new Map();
    const catCounts = new Map();
    const matrix = new Map();
    for (const work of works) {
      charCounts.set(work.characterId, (charCounts.get(work.characterId) || 0) + 1);
      const ids = Array.isArray(work.categoryIds) ? work.categoryIds : [];
      for (const id of ids) {
        catCounts.set(id, (catCounts.get(id) || 0) + 1);
        if (!matrix.has(work.characterId)) matrix.set(work.characterId, new Map());
        const row = matrix.get(work.characterId);
        row.set(id, (row.get(id) || 0) + 1);
      }
    }

    /* 与站内搜索契约同口径：大小写、空格、下划线、短横线归一 */
    function normalize(value) {
      return String(value == null ? "" : value).toLocaleLowerCase("zh-CN").replace(/[\s_\-—–]+/g, "");
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
      }[char]));
    }

    /* ---------- URL hash 状态：#c=<characterId>&s=<categoryId>&q=<搜索词>，全部 / 空不写 ---------- */
    function parseHash(raw) {
      const next = { c: "", s: "", q: "" };
      const text = String(raw == null ? "" : raw).replace(/^#/, "");
      if (!text) return next;
      let params = null;
      try {
        params = new URLSearchParams(text);
      } catch (err) {
        return next;
      }
      const rawC = params.get("c");
      if (rawC) {
        const key = String(rawC).toLowerCase();
        if (charById.has(rawC)) next.c = rawC;
        else if (charByLower.has(key)) next.c = charByLower.get(key);
        // 认不出的角色 id 按「全部角色」处理
      }
      const rawS = params.get("s");
      if (rawS) {
        const key = String(rawS).toLowerCase();
        if (catById.has(rawS)) next.s = rawS;
        else if (catByLower.has(key)) next.s = catByLower.get(key);
        // 认不出的类型 id 按「全部类型」处理
      }
      next.q = params.get("q") || "";
      return next;
    }

    function buildHash(value) {
      const params = new URLSearchParams();
      if (value.c) params.set("c", value.c);
      if (value.s) params.set("s", value.s);
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
        // 受限环境（如部分浏览器的 file://）：改 hash 兜底；replace 失败就保留原 URL
        if (mode !== "replace") window.location.hash = next ? "#" + next : "";
      }
    }

    let state = parseHash(window.location.hash);
    let searchTimer = 0;

    /* ---------- 渲染 ---------- */
    function buildChips(container, items, onPick) {
      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chip";
        button.dataset.id = item.id;
        button.setAttribute("aria-pressed", "false");
        button.appendChild(document.createTextNode(item.name));
        const num = document.createElement("span");
        num.className = "num";
        button.appendChild(num);
        button.addEventListener("click", () => onPick(item.id));
        container.appendChild(button);
      }
    }

    function subCount(categoryId) {
      if (!state.c) return categoryId ? (catCounts.get(categoryId) || 0) : works.length;
      if (!categoryId) return charCounts.get(state.c) || 0;
      const row = matrix.get(state.c);
      return row ? (row.get(categoryId) || 0) : 0;
    }

    function inScope(work) {
      if (state.c && work.characterId !== state.c) return false;
      if (state.s) {
        const ids = Array.isArray(work.categoryIds) ? work.categoryIds : [];
        return ids.indexOf(state.s) !== -1;
      }
      return true;
    }

    function matches(work, needle) {
      if (!needle) return true;
      if (normalize(work.name).indexOf(needle) !== -1) return true;
      const tags = Array.isArray(work.tags) ? work.tags : [];
      return tags.some((tag) => normalize(tag).indexOf(needle) !== -1);
    }

    /* 卡片图 alt（archive/2026-09-24/docs/SEO规范.md §7 列表卡片图公式）：《{name}》{characterName}{kindWord}，{tags顿号}AI娘二创图。
       zh 保持原公式；en / ja 走 lang.js 的 alt.work 模板（{kindId} 由词典解析成品类词，不含中文 tag）。 */
    function altFor(work) {
      const character = charById.get(work.characterId);
      const characterName = character ? character.name : SiteLang.fmt("char.unknown", "未知角色");
      const kindId = (Array.isArray(work.categoryIds) ? work.categoryIds : [])[0] || "";
      const kindWord = SiteLang.fmt(
        "kind." + (kindId || "meme"),
        ({ meme: "表情包", illustration: "二创插画", setting: "立绘设定图", comic: "漫画" })[kindId] || "表情包"
      );
      if (SiteLang.current !== "zh") {
        return SiteLang.fmt("alt.work", "", { name: work.name, character: characterName, kindId: kindId || "meme" });
      }
      const tags = (Array.isArray(work.tags) ? work.tags : []).slice(0, 2).join("、");
      const text = "《" + String(work.name == null ? "" : work.name) + "》" + characterName + kindWord;
      return tags ? text + "，" + tags + " AI娘二创图" : text;
    }

    function cardMarkup(work, index) {
      const character = charById.get(work.characterId);
      const name = String(work.name == null ? "" : work.name);
      const meta = [];
      meta.push(character ? character.name : SiteLang.fmt("char.unknown", "未知角色"));
      if (work.format) meta.push(String(work.format).toUpperCase());
      if (work.width && work.height) meta.push(work.width + "×" + work.height);
      const sizeAttrs = work.width && work.height
        ? ' width="' + escapeHtml(work.width) + '" height="' + escapeHtml(work.height) + '"'
        : "";
      const tags = (Array.isArray(work.tags) ? work.tags : []).slice(0, 3)
        .map((tag) => "#" + tag)
        .join(" ");
      const loading = index < EAGER_CARDS ? "eager" : "lazy";
      const priority = index === 0 ? ' fetchpriority="high"' : "";
      return (
        `<a class="card" href="works/${work.slug}.html">` +
          '<img class="card-art" src="' + escapeHtml(work.thumbUrl) + '" alt="' + escapeHtml(altFor(work)) + '"' + sizeAttrs +
            ' loading="' + loading + '" decoding="async"' + priority + ' />' +
          '<div class="card-body">' +
            '<h2 class="card-title" title="' + escapeHtml(name) + '">' + escapeHtml(name) + "</h2>" +
            '<p class="card-meta">' + escapeHtml(meta.join(" · ")) + "</p>" +
            (tags ? '<p class="card-tags">' + escapeHtml(tags) + "</p>" : "") +
          "</div>" +
        "</a>"
      );
    }

    /* 当前筛选结果（已按渲染顺序排好）与已插入 DOM 的卡片数。观察器回调只读这两个变量，
       因此筛选重渲染时无需重建观察器：清空网格 + 归零 renderedCount 后，旧回调不会再追加旧 list。 */
    let list = [];
    let renderedCount = 0;
    /* 加载更多按钮始终保留：它既是无 IntersectionObserver 时的降级，也是触控 / 键盘用户的显式入口。 */
    let loadMoreEnabled = true;

    /* 更新计数、空状态与末尾提示。count 仍按「命中 / 当前范围」统计完整数据（元数据计算，
       不是 DOM 数量），键盘与屏幕阅读器据此读到筛选结果数。 */
    function updateStatus() {
      const total = list.length;
      const exhausted = total > 0 && renderedCount >= total;
      endNoteEl.hidden = !exhausted;
      if (exhausted) endNoteEl.textContent = SiteLang.fmt("list.end", "已经到底了 · 共 {total} 张", { total: total });
      emptyEl.hidden = total !== 0;
      if (loadMoreWrap && loadMoreBtn) {
        loadMoreWrap.hidden = !(loadMoreEnabled && !exhausted);
        loadMoreBtn.disabled = exhausted;
      }
    }

    /* 追加下一批：index 传渲染序号，首批（renderedCount=0）前 EAGER_CARDS 张才 eager，续接批次全 lazy */
    function appendNextPage() {
      if (renderedCount >= list.length) { updateStatus(); return; }
      const slice = list.slice(renderedCount, renderedCount + PAGE_SIZE);
      gridEl.insertAdjacentHTML(
        "beforeend",
        slice.map((work, i) => cardMarkup(work, renderedCount + i)).join("")
      );
      renderedCount += slice.length;
      updateStatus();
    }

    function render() {
      for (const button of charChipsEl.children) {
        const id = button.dataset.id;
        const selected = id === state.c;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
        const num = button.querySelector(".num");
        if (num) num.textContent = String(id ? (charCounts.get(id) || 0) : works.length);
      }
      for (const button of catChipsEl.children) {
        const id = button.dataset.id;
        const selected = id === state.s;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
        const num = button.querySelector(".num");
        if (num) num.textContent = String(subCount(id));
      }

      /* 范围标签随语言走：zh 用清单里的中文名，en / ja 用 lang.js 的 cat.<id> / 「全部」兜底 */
      function categoryLabel(category) {
        return category ? SiteLang.t("cat." + category.id, String(category.name == null ? "" : category.name)) : SiteLang.t("filter.allTypes", "全部类型");
      }
      const characterLabel = state.c && charById.has(state.c) ? charById.get(state.c).name : SiteLang.t("filter.allCharacters", "全部角色");
      const categoryText = state.s && catById.has(state.s) ? categoryLabel(catById.get(state.s)) : SiteLang.t("filter.allTypes", "全部类型");
      searchInput.placeholder = SiteLang.fmt("category.search.placeholder", "在 {character} · {category} 内搜索名称或 Tag", {
        character: characterLabel,
        category: categoryText
      });
      if (searchInput.value !== state.q) searchInput.value = state.q;

      const scope = works.filter(inScope);
      const needle = normalize(state.q);
      list = scope.filter((work) => matches(work, needle));
      countEl.textContent = SiteLang.fmt("list.scopedCount", "{matched} / {total} 张", { matched: list.length, total: scope.length });

      /* 状态变化：清空结果、重置批次与提示，再只渲染首批；旧观察器回调读到的已是新 list */
      gridEl.innerHTML = "";
      renderedCount = 0;
      endNoteEl.hidden = true;
      emptyEl.hidden = list.length !== 0;
      appendNextPage();
    }

    /* ---------- 交互：chips 前进后退可回溯，输入用 replace 不刷历史 ---------- */
    function commit(next, mode) {
      window.clearTimeout(searchTimer);
      state = { c: next.c, s: next.s, q: next.q };
      writeHash(state, mode);
      render();
    }

    function pick(key, id) {
      const next = { c: state.c, s: state.s, q: searchInput.value };
      next[key] = id;
      commit(next, "push");
    }

    function syncFromLocation() {
      window.clearTimeout(searchTimer);
      const next = parseHash(window.location.hash);
      const changed = next.c !== state.c || next.s !== state.s || next.q !== state.q;
      if (changed) {
        state = next;
        render();
      }
      writeHash(state, "replace"); // 顺手把脏 hash 归一化，不产生历史记录
    }

    buildChips(
      charChipsEl,
      [{ id: "", name: SiteLang.t("filter.all", "全部") }].concat(characters.map((item) => ({ id: item.id, name: String(item.name == null ? "" : item.name) }))),
      (id) => pick("c", id)
    );
    buildChips(
      catChipsEl,
      [{ id: "", name: SiteLang.t("filter.all", "全部") }].concat(categories.map((item) => ({ id: item.id, name: SiteLang.t("cat." + item.id, String(item.name == null ? "" : item.name)) }))),
      (id) => pick("s", id)
    );

    searchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        commit({ c: state.c, s: state.s, q: searchInput.value }, "replace");
      }, 200);
    });
    /* 语言切换：chips 的「全部」/ 分类名、占位提示与计数都随语言重渲染 */
    document.addEventListener("site:langchange", () => {
      charChipsEl.innerHTML = "";
      catChipsEl.innerHTML = "";
      buildChips(
        charChipsEl,
        [{ id: "", name: SiteLang.t("filter.all", "全部") }].concat(characters.map((item) => ({ id: item.id, name: String(item.name == null ? "" : item.name) }))),
        (id) => pick("c", id)
      );
      buildChips(
        catChipsEl,
        [{ id: "", name: SiteLang.t("filter.all", "全部") }].concat(categories.map((item) => ({ id: item.id, name: SiteLang.t("cat." + item.id, String(item.name == null ? "" : item.name)) }))),
        (id) => pick("s", id)
      );
      render();
    });
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);

    /* 只建一个观察器：回调读取当前 list / renderedCount，筛选重渲染不重绑，避免观察器无限增长 */
    if (typeof IntersectionObserver === "function" && sentinel) {
      const observer = new IntersectionObserver(
        (records) => {
          if (records.some((record) => record.isIntersecting)) appendNextPage();
        },
        { rootMargin: "320px 0px" }
      );
      observer.observe(sentinel);
    }
    if (loadMoreWrap && loadMoreBtn) {
      loadMoreWrap.hidden = false;
      loadMoreBtn.addEventListener("click", () => appendNextPage());
    }

    /* 某些 WebView 对 0 高度 sentinel 的 IntersectionObserver 事件不稳定；接近底部时
       用 passive scroll 做兜底。仍按 PAGE_SIZE 追加，不会回退到全量渲染。 */
    let scrollTick = 0;
    window.addEventListener("scroll", () => {
      if (scrollTick) return;
      scrollTick = window.setTimeout(() => {
        scrollTick = 0;
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 480) {
          appendNextPage();
        }
      }, 80);
    }, { passive: true });

    render();
    writeHash(state, "replace"); // 首次进入把脏 hash 归一化，不产生历史记录
  })();
