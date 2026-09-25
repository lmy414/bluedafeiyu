/* 蓝色大肥鱼 · 站点多语言层（zh 默认 / en / ja）
   --------------------------------------------------------------------------
   约定（与各页手写脚本和 tools/generate_work_pages.mjs 的模板共同成立）：
     · 中文（zh）不进词典：zh 就是各页 HTML 的原文与各处 JS 的兜底串，运行时
       首次应用时把原文缓存起来，切回 zh 直接还原，词典与页面永不漂移；
     · 静态文案：元素挂 data-i18n="key"（替换 textContent）；含行内子元素
       （<strong> / <a> / <span class="marker-highlight">）的段落，把每段纯文本
       用 <span data-i18n=...> 包住再翻，保证翻译只动文本、不动结构；
     · 带变量的文案：data-i18n-tpl="key" + data-i18n-vars='{"name":"…"}'（JSON），
       词典值里写 {name} 占位；{kindId} 是特殊变量，运行时按 kind.<id> 取品类词；
     · 属性文案：data-i18n-attr="placeholder:key,aria-label:key2"；
     · 页面级 title / meta：body 挂 data-i18n-page="<页名>"，词典 pages.<页名>.*
       提供 en/ja 的 title 与 description；详情页是数据文案，不挂此属性、不换标题；
     · 动态渲染的文案（卡片计数、排序下拉、空状态等）由页面脚本调
       SiteLang.fmt(key, 中文兜底, 变量) 取词，并监听 document 的 site:langchange 重渲染；
     · 切换器由本文件自动注入 header .topnav 末尾，选择存 localStorage
       （bluedafeiyu-lang），?lang= 参数优先并会被记住。
   作品名、Tag、详情页正文（commentary）等属于内容数据，三种语言下都保持中文原文。 */

(function () {
  "use strict";

  var STORAGE_KEY = "bluedafeiyu-lang";
  var CHANGE_EVENT = "site:langchange";

  var LANGS = [
    { id: "zh", label: "中", title: "中文", htmlLang: "zh-CN" },
    { id: "en", label: "EN", title: "English", htmlLang: "en" },
    { id: "ja", label: "日", title: "日本語", htmlLang: "ja" }
  ];

  /* 词典：只存 en / ja。zh 走页面原文。改文案时同步改页面里的中文与这里两份。 */
  var DICT = {
    en: {
      "nav.home": "Home",
      "nav.category": "Categories",
      "nav.submit": "Submit",
      "nav.about": "About",
      "nav.projects": "Projects",
      "brand.tagline": "An open archive of AI-girl fan stickers",
      "footer.disclaimer":
        "An unofficial fan-curated project. All images belong to their original authors. This site uses minimal Google Analytics to understand traffic and performance, and builds no popularity rankings.",
      "footer.changelog": "Changelog",
      "footer.privacy": "Analytics & privacy",
      "footer.source": "Site source repo",
      "footer.content": "Content & submissions repo",
      "ui.switchLang": "Switch language",
      "ui.workType": "work type",
      "section.comments": "Comments",
      "char.unknown": "Unknown character",
      "kind.meme": "Sticker",
      "kind.illustration": "Fan illustration",
      "kind.setting": "Character sheet",
      "kind.comic": "Comic",
      "filter.all": "All",
      "filter.characters": "Character",
      "filter.types": "Type",
      "filter.allCharacters": "All characters",
      "filter.allTypes": "All types",
      "cat.meme": "Meme",
      "cat.illustration": "Illustration",
      "cat.setting": "Character sheet",
      "cat.comic": "Comic",
      "list.count": "Showing {shown} / {total}",
      "list.scopedCount": "{matched} / {total}",
      "list.end": "That's everything · {total} works in total",
      "list.emptyIndex": "No matching works — try another keyword.",
      "list.emptyCategory": "No works match the current filters",
      "list.loadMore": "Load more",
      "ui.copied": "Copied",
      "ui.copyFail": "Copy failed — please select it manually",
      "qq.copy": "Copy group number",
      "qq.scan": "Scan to join",
      "qq.qrAlt": "QR code for joining the QQ group \u201c鱼之饭盆\u201d (group number 1060898801)",
      "alt.work": "\u201c{name}\u201d — {character} {kindId} fan art",

      "page.index.title": "蓝色大肥鱼 - AI-Girl Fan Stickers, Memes & Character Art Downloads",
      "page.index.desc":
        "蓝色大肥鱼 archives AI-girl fan stickers, memes, illustrations, character sheets and multi-panel comics featuring DeepSeek, Claude, Qwen, GLM and more — browse by character, search by tag, view in high resolution and download originals.",
      "page.category.title": "AI-Girl Sticker Categories - Browse Memes, Illustrations & Comics by Character | 蓝色大肥鱼",
      "page.category.desc":
        "Browse AI-girl memes, stickers, fan illustrations, character sheets and comics by character (DeepSeek, Claude, Qwen, GLM and more), and search names & tags within each category.",
      "page.submit.title": "Submit AI-Girl Fan Stickers - Simplified GitHub Form | 蓝色大肥鱼",
      "page.submit.desc":
        "Submitting an AI-girl fan sticker only takes an image upload plus its name and character — an optional one-line note. Tags, source, license and category are added by maintainers during review.",
      "page.about.title": "About 蓝色大肥鱼 - AI-Girl Sticker Archive, Licensing & Privacy",
      "page.about.desc":
        "What the 蓝色大肥鱼 AI-girl sticker archive is, image copyright & licensing, Google Analytics privacy, comments, the official QQ group, character-design credits, and how to request attribution or removal.",
      "page.projects.title": "Projects - The Owner's Other Projects & Sites | 蓝色大肥鱼",
      "page.projects.desc": "Other projects and websites by the owner of 蓝色大肥鱼 — cards are being curated.",
      "page.changelog.title": "Changelog - 蓝色大肥鱼 Site Updates & Archive Records",
      "page.changelog.desc":
        "Redesigns, data migrations, new works, SEO and performance changes on the 蓝色大肥鱼 AI-girl sticker site.",
      "page.notfound.title": "404 - Page Lost at Sea | 蓝色大肥鱼",
      "page.notfound.desc":
        "The 蓝色大肥鱼 404 page: nothing lives at this address — the link may be mistyped, the work taken down, or the URL outdated. Head back home or browse by category.",

      "index.hero.lede": "Collect and download AI-girl fan stickers, archived by character and searchable by tag.",
      "index.cta.browse": "Start browsing",
      "index.cta.submit": "Submit artwork",
      "index.cta.group": "Join the group chat",
      "index.section.all": "All works",
      "index.search.placeholder": "Search names, tags, characters or aliases",
      "sort.label": "Sort",
      "sort.newest": "Newest",
      "sort.oldest": "Oldest",
      "sort.nameAsc": "Name A→Z",
      "sort.nameDesc": "Name Z→A",
      "sort.size": "File size",
      "sort.random": "Random",
      "index.qq.lede1": "QQ group \u201c鱼之饭盆\u201d",
      "index.qq.lede2": "Group number",
      "index.qq.close": "Close",

      "category.h1": "Browse by category",
      "category.lede.a": "Browse by ",
      "category.lede.b": ", then group by ",
      "category.lede.c": " within each character.",
      "category.search.aria": "Search names or tags",
      "category.search.placeholder": "Search names or tags in {character} · {category}",

      "submit.h1": "Submit",
      "submit.lede":
        "Hand your AI-girl fan stickers to us for archiving. Submissions currently go through the GitHub form: upload the image and fill in its name and character — a note is optional; the rest of the catalog info is completed by maintainers during review.",
      "submit.guide.title": "Submission guide",
      "submit.what.a": "This site collects ",
      "submit.what.b": "humanized fan stickers of AI characters",
      "submit.what.c":
        ": memes, illustrations, character sheets and multi-panel comics are all welcome, as long as the star is a gijinka (humanized) character of a major AI product (DeepSeek娘, 豆包娘, Kimi娘…).",
      "submit.notTitle": "The following four categories are not accepted:",
      "submit.not1":
        "Real-person portraits, unauthorized commercial assets, and generic stickers unrelated to AI characters;",
      "submit.not2": "Illegal content, hate speech or harassment;",
      "submit.not3":
        "Images whose source and license can't be clarified, where the submitter refuses to provide details;",
      "submit.not4": "Gore, nudity and other clearly disturbing content.",
      "submit.boundary":
        "For anything not covered above we use common sense, and maintainers keep the final say on whether a work is archived.",
      "submit.format.a": "Format requirements:",
      "submit.format.b":
        " PNG / JPG / GIF / WebP / APNG, up to 10 MB per image; upload the original whenever possible — avoid chat-window screenshots or recompressed copies.",
      "submit.onlyTitle": "When submitting you only need to:",
      "submit.onlyBody":
        " Upload the image and fill in its name and character; a one-line note is optional. Tags, category, source, license and the detail-page copy are filled in by maintainers after visual review; if you know the source or license, mention it in the note or in a comment on the Issue.",
      "submit.confirmTitle": "You must confirm three items before submitting:",
      "submit.confirm1":
        "I confirm I have the right to submit this image, or have obtained the original author's permission.",
      "submit.confirm2":
        "I agree that maintainers may archive it after verification, and edit its info or remove it upon a copyright request.",
      "submit.confirm3":
        "I understand this is an unofficial fan-curated project, and image copyright always stays with the original author.",
      "submit.qq.title": "Submit via QQ group",
      "submit.qq.a": "The QQ group is called \u201c鱼之饭盆\u201d, group number ",
      "submit.qq.c":
        ". Posting the image in the group and @-ing a maintainer counts as a submission too.",
      "submit.qq.hint":
        "The submission form remains the canonical channel: images posted in the group are filed through the form by maintainers, with source & license filled in afterwards.",
      "submit.channel.title": "Submission channels",
      "submit.channel.github": "GitHub submission form",
      "submit.channel.githubOn": "Open · recommended",
      "submit.channel.githubDesc":
        "Drag & drop the image right in; just fill in its name and character — the note is optional.",
      "submit.channel.open": "Open the form",
      "submit.channel.feishu": "Feishu submission",
      "submit.channel.feishuTag": "Placeholder · coming soon",
      "submit.channel.feishuDesc":
        "The Feishu channel is still in preparation — please use the GitHub form above for now.",
      "submit.channel.soon": "Coming soon",
      "submit.form.title": "Quick submit",
      "submit.form.noticeA": "On-site quick submit is not open yet",
      "submit.form.noticeB": " · please use the GitHub form above for now",
      "submit.form.files": "Image files",
      "submit.form.filesHint":
        "Drag & drop the image directly in the GitHub form; on-site quick submit is not open yet.",
      "submit.form.name": "Image name",
      "submit.form.desc": "One-line note",
      "submit.form.character": "Character",
      "submit.form.metaHint":
        "Tags, work type, source, license and contact info are added by maintainers during review; if you know the source or license, put it in the note above or in a comment on the Issue.",
      "submit.form.confirmLabel": "Confirm before submitting",
      "submit.form.confirmHint": "All three boxes must be checked to submit.",
      "submit.form.submit": "On-site submit · not open yet",
      "submit.form.select": "Select a character",
      "submit.note1":
        "On-site quick submit is not open yet — please use the GitHub submission form for now.",
      "submit.note2":
        "Submissions don't go live immediately: maintainers review each image and fill in tags, category, source and license before archiving; they may ask you questions on the Issue.",

      "about.h1": "About",
      "about.lede":
        "蓝色大肥鱼 is an unofficial fan-curated project. This page explains what it does, who owns the images, and which of your data we don't collect.",
      "about.site.title": "About this site",
      "about.site.p1a": "\u201c蓝色大肥鱼\u201d is an open archive of ",
      "about.site.p1b": "AI-girl fan stickers",
      "about.site.p1c":
        ": works are archived by character and searchable by name, tag and character alias; every work has its own detail page where you can check source & license, download the original, and leave comments in a dedicated thread. The changelog is linked in the footer.",
      "about.site.p2a":
        "Here's what you can do here: browse all works by character and category; search by name, tag or alias; open a detail page to grab the original; discuss under each work; or ",
      "about.site.p2link": "submit your own work",
      "about.site.p2b": ".",
      "about.license.title": "License & copyright",
      "about.license.p1a": "This site's ",
      "about.license.p1b": "source code",
      "about.license.p1c": " is released under the ",
      "about.license.p1d": " license — use it freely.",
      "about.license.p2a": "But stickers submitted or archived here ",
      "about.license.p2b": "do not automatically get an ",
      "about.license.p2b2": " license",
      "about.license.p2c":
        " just for being in this site's repo — image copyright always belongs to the original author. What you may do with each image is governed by the source & license noted on its detail page.",
      "about.license.p3":
        "For works marked \u201clicense status unclear\u201d, contact the original author for permission first — don't use them commercially.",
      "about.privacy.title": "Analytics & privacy",
      "about.privacy.li1a": "This site uses ",
      "about.privacy.li1c":
        " to collect aggregated page-visit, source, device and performance data, in order to spot loading issues and improve pages; Google may set first-party analytics cookies.",
      "about.privacy.li2a": "Ads personalization, Google Signals and ad storage are all disabled",
      "about.privacy.li2c":
        "; this site builds no user profiles, and never turns analytics data into popularity scores or rankings.",
      "about.privacy.li3a": "Google Fonts load from Google's font service; comments are hosted on ",
      "about.privacy.li3c":
        " — the site itself doesn't store commenter identities.",
      "about.comments.p1a": "Comments are hosted on ",
      "about.comments.p1c": " (",
      "about.comments.p1d":
        ") and require signing in with a GitHub account; each work has its own independent thread, and threads never mix.",
      "about.credits.title": "Credits",
      "about.credits.p":
        "Thanks to the following creators for the character designs our archived characters are based on:",
      "about.credits.design": " character design;",
      "about.credits.redesign": " character redesign.",
      "about.takedown.title": "Attribution & takedown",
      "about.takedown.p1":
        "Original authors who need credit added, source info corrected, or a work taken down can use the GitHub \u201cattribution & takedown request\u201d form; maintainers will handle it as soon as possible.",
      "about.takedown.p2a": "Upon a valid copyright complaint we ",
      "about.takedown.p2b": "take the work down first, then look into it",
      "about.takedown.p2c": ".",
      "about.takedown.btn": "Open attribution & takedown request",
      "about.group.title": "Community group",
      "about.group.a": "Our QQ group is called \u201c鱼之饭盆\u201d, group number ",
      "about.group.c":
        ". Search that number in QQ to join — whether you want to chat about images, nudge for updates, report bugs, or just come look at the fish, you're welcome.",

      "projects.h1": "Projects",
      "projects.lede": "My own other projects and sites will gradually move here.",
      "projects.recruit.a": "Projects wanted",
      "projects.recruit.b": " · placeholder for now",
      "projects.slot": "To be added",

      "changelog.h1": "Changelog",
      "changelog.lede": "Every change to this site gets a note here, big or small.",
      "changelog.note":
        "This page is an excerpt; the complete changelog is archived at archive/2026-09-24/CHANGELOG.md in the repo.",

      "notfound.h1": "404 · This fish got away",
      "notfound.lede":
        "There's nothing at this address: the link may be mistyped, the work may have been taken down, or it was never archived in the first place.",
      "notfound.text": "I dredged the whole fish pond and still couldn't net the image you're after.",
      "notfound.reasonsTitle": "Likely causes",
      "notfound.reason1a":
        "A character is missing or mistyped — a work's detail-page URL looks like ",
      "notfound.reason1c": ".",
      "notfound.reason2":
        "The author asked for this work to be taken down, and it has been removed from the site.",
      "notfound.reason3":
        "You followed a pre-redesign URL that has moved on; the home, category and changelog pages are all still there.",
      "notfound.exitHome": "Back to the home page",
      "notfound.exitCategory": "Browse by character or category",
      "notfound.exitSubmit": "Got an image? Submit it",
      "notfound.noteA":
        "If you arrived here from a link on this site, that's my mistake — feel free to mention it on ",
      "notfound.noteC": ".",

      "work.breadcrumbLabel": "Breadcrumb",
      "work.download": "Download original",
      "work.copyLink": "Copy link",
      "work.info": "Work info",
      "work.field.type": "Type",
      "work.field.format": "Format",
      "work.field.size": "Dimensions",
      "work.field.volume": "File size",
      "work.field.submitter": "Submitter",
      "work.field.origin": "Source type",
      "work.field.originAuthor": "Source author",
      "work.field.sourceUrl": "Source link",
      "work.field.license": "License",
      "work.field.date": "Archived on",
      "work.unlabeled": "Unmarked",
      "work.aka": "aka {aliases}",
      "work.count": "{count} works",
      "work.tags": "Tags",
      "work.licenseTitle": "License notes",
      "work.licenseFootnoteA": "Images belong to their original authors; ",
      "work.licenseFootnoteLink": "request attribution, edits or removal",
      "work.more": "More {name} stickers",
      "work.guess": "You may also like",
      "work.emptySame": "No more works from this character yet",
      "work.emptyGuess": "No more recommendations",
      "work.figcaption": "\u201c{name}\u201d · {character}",
      "work.cardMeta": "{character} · {kindId}",
      "origin.self-created": "Self-created or AI-generated",
      "origin.author-submitted": "Submitted by the original author",
      "origin.internet-found": "Curated from the web",
      "origin.community-created": "Created by a community member",
      "origin.unknown": "Unknown source",
      "license.submitter-permission": "Submitter confirmed archiving & download",
      "license.author-permission": "Explicitly licensed by the original author",
      "license.cc0": "CC0 public domain",
      "license.cc-by": "CC BY attribution",
      "license.cc-by-nc": "CC BY-NC attribution · non-commercial",
      "license.unknown": "License status unclear",
      "license.removed": "Taken down"
    },

    ja: {
      "nav.home": "ホーム",
      "nav.category": "カタログ",
      "nav.submit": "投稿",
      "nav.about": "About",
      "nav.projects": "プロジェクト",
      "brand.tagline": "AI娘スタンプのオープンアーカイブ",
      "footer.disclaimer":
        "非公式のファン整理プロジェクトです。画像の著作権は各原作者に帰属します。当サイトはページとパフォーマンスの把握のため最小限の Google Analytics を使用しており、人気ランキングは作成していません。",
      "footer.changelog": "更新履歴",
      "footer.privacy": "統計とプライバシー",
      "footer.source": "サイトのソースリポジトリ",
      "footer.content": "コンテンツと投稿のリポジトリ",
      "ui.switchLang": "言語を切り替える",
      "ui.workType": "作品タイプ",
      "section.comments": "コメント",
      "char.unknown": "キャラ不明",
      "kind.meme": "スタンプ",
      "kind.illustration": "ファンアート",
      "kind.setting": "設定画",
      "kind.comic": "漫画",
      "filter.all": "すべて",
      "filter.characters": "キャラ",
      "filter.types": "タイプ",
      "filter.allCharacters": "全キャラ",
      "filter.allTypes": "全タイプ",
      "cat.meme": "ネタ画",
      "cat.illustration": "イラスト",
      "cat.setting": "設定画",
      "cat.comic": "漫画",
      "list.count": "{shown} / {total} 件を表示",
      "list.scopedCount": "{matched} / {total} 件",
      "list.end": "すべて表示しました · 全 {total} 件",
      "list.emptyIndex": "一致する作品がありません。キーワードを変えてみてください。",
      "list.emptyCategory": "条件に合う作品がありません",
      "list.loadMore": "もっと見る",
      "ui.copied": "コピーしました",
      "ui.copyFail": "コピーに失敗しました。手動で選択してください",
      "qq.copy": "グループ番号をコピー",
      "qq.scan": "QRコードで参加",
      "qq.qrAlt": "QQグループ「鱼之饭盆」（グループ番号 1060898801）への参加用QRコード",
      "alt.work": "《{name}》{character}{kindId}、AI娘二次創作画像",

      "page.index.title": "蓝色大肥鱼 - AI娘スタンプ・DeepSeek娘ネタ画・二次創作イラスト集",
      "page.index.desc":
        "蓝色大肥魚は DeepSeek娘・Claude娘・Qwen娘・GLM娘 などの AI娘スタンプ・ネタ画・イラスト・設定画・多コマ漫画を収録。キャラ別の分類、タグ検索、高解像度表示、原図ダウンロードに対応しています。",
      "page.category.title": "AI娘スタンプのカタログ - キャラ別にネタ画・イラスト・設定画・漫画を閲覧 | 蓝色大肥鱼",
      "page.category.desc":
        "DeepSeek娘・Claude娘・Qwen娘・GLM娘 などのキャラ別に、AI娘のネタ画・スタンプ・ファンアート・設定画・多コマ漫画を閲覧。カテゴリ内で名前やタグを検索できます。",
      "page.submit.title": "AI娘スタンプの投稿 - 簡略化された GitHub フォーム | 蓝色大肥鱼",
      "page.submit.desc":
        "AI娘スタンプの投稿は、画像のアップロードと画像名・キャラの記入だけ。ひとこと説明は任意です。タグ・出所・ライセンス・分類はメンテナーが審査時に補完します。",
      "page.about.title": "蓝色大肥鱼について - AI娘スタンプのオープンアーカイブと著作権について",
      "page.about.desc":
        "AI娘スタンプアーカイブ「蓝色大肥魚」の概要、画像の著作権とライセンス、Google Analytics のプライバシー、コメントの仕組み、公式 QQ グループ、キャラデザのクレジット、署名・削除の申請方法。",
      "page.projects.title": "プロジェクト紹介 - 管理人の他のプロジェクトとサイト | 蓝色大肥鱼",
      "page.projects.desc": "蓝色大肥魚の管理人による他のプロジェクト・サイトの紹介ページ。カードは準備中です。",
      "page.changelog.title": "更新履歴 - 蓝色大肥鱼のサイト改修と収録記録",
      "page.changelog.desc":
        "AI娘スタンプサイト「蓝色大肥魚」の改版・データ移行・作品収録・SEO・パフォーマンス改善の記録。",
      "page.notfound.title": "404 - ページが迷子になりました | 蓝色大肥鱼",
      "page.notfound.desc":
        "蓝色大肥魚の 404 ページ。このアドレスにはコンテンツがありません。リンクの打ち間違い・削除済み・旧アドレスの可能性があります。ホームに戻るか、カテゴリから探してください。",

      "index.hero.lede":
        "AI娘の二次創作スタンプを収集・ダウンロード。キャラ別にアーカイブし、タグで検索できます。",
      "index.cta.browse": "見てみる",
      "index.cta.submit": "作品を投稿",
      "index.cta.group": "交流グループに参加",
      "index.section.all": "すべての作品",
      "index.search.placeholder": "名前・タグ・キャラ・別名を検索",
      "sort.label": "並び順",
      "sort.newest": "新着順",
      "sort.oldest": "古い順",
      "sort.nameAsc": "名前昇順",
      "sort.nameDesc": "名前降順",
      "sort.size": "ファイルサイズ",
      "sort.random": "ランダム",
      "index.qq.lede1": "QQグループ「鱼之饭盆」",
      "index.qq.lede2": "グループ番号",
      "index.qq.close": "閉じる",

      "category.h1": "カタログ",
      "category.lede.a": "",
      "category.lede.b": "ごとに閲覧し、さらに",
      "category.lede.c": "でグループ分け。",
      "category.search.aria": "名前やタグを検索",
      "category.search.placeholder": "{character} · {category} の中で名前・タグを検索",

      "submit.h1": "投稿",
      "submit.lede":
        "あなたの AI娘二次創作スタンプを私たちのアーカイブにどうぞ。現在の投稿は GitHub フォームから。画像のアップロードと画像名・キャラの記入だけで、説明は任意です。その他の収録情報はメンテナーが審査時に補完します。",
      "submit.guide.title": "投稿ガイド",
      "submit.what.a": "当サイトが収録するのは",
      "submit.what.b": "AIキャラの擬人化二次創作スタンプ",
      "submit.what.c":
        "です。ネタ画・イラスト・設定画・多コマ漫画、どれでも OK。主人公は各種 AI 製品の擬人化キャラ（DeepSeek娘、豆包娘、Kimi娘…）なら何でも。",
      "submit.notTitle": "以下の 4 種類は収録しません：",
      "submit.not1": "実在の人物の肖像、無断の商用素材、AI キャラと無関係な汎用スタンプ。",
      "submit.not2": "違法コンテンツ、ヘイトや嫌がらせにあたるもの。",
      "submit.not3": "出所とライセンスが不明なまま、補足も拒否される画像。",
      "submit.not4": "グロテスク・裸露・猎奇的など、明らかに不快なコンテンツ。",
      "submit.boundary":
        "書かれていない境界は常識で判断します。収録するかどうかの最終決定はメンテナーが行います。",
      "submit.format.a": "フォーマット：",
      "submit.format.b":
        "PNG / JPG / GIF / WebP / APNG、1 枚 10 MB まで。できるだけ元画像をアップロードし、チャット画面のスクショや再圧縮した画像は避けてください。",
      "submit.onlyTitle": "投稿時に必要なもの：",
      "submit.onlyBody":
        "画像のアップロード、画像名とキャラの記入だけ。ひとこと説明は任意です。タグ・分類・出所・ライセンス・詳細ページの文案は、メンテナーが画像を確認したうえで補完します。出所やライセンスをご存じなら、説明欄や Issue のコメントに書いてください。",
      "submit.confirmTitle": "送信前に次の 3 つに同意してください：",
      "submit.confirm1":
        "この画像を投稿する権利を持ち、または原作者の許諾を得ていることを確認します。",
      "submit.confirm2":
        "メンテナーが確認後に収録すること、著作権の申し立てがあれば情報修正や削除が行われることに同意します。",
      "submit.confirm3":
        "当サイトが非公式のファン整理プロジェクトであり、画像の著作権は原作者に帰属することを理解しています。",
      "submit.qq.title": "グループで投稿",
      "submit.qq.a": "QQグループは「鱼之饭盆」、グループ番号は ",
      "submit.qq.c":
        "。グループに画像を投稿してメンテナーに @ をつければ、それも投稿として扱われます。",
      "submit.qq.hint":
        "収録はあくまで投稿フォーム基準です。グループ投稿の画像はメンテナーがフォーム手続きを代行し、出所とライセンスは後ほど補完します。",
      "submit.channel.title": "投稿の入口",
      "submit.channel.github": "GitHub 投稿フォーム",
      "submit.channel.githubOn": "開通済み · おすすめ",
      "submit.channel.githubDesc":
        "画像をドラッグして直接アップロードできます。記入は画像名とキャラだけで、説明は任意。",
      "submit.channel.open": "フォームを開く",
      "submit.channel.feishu": "Feishu 投稿",
      "submit.channel.feishuTag": "準備中 · もうすぐ開通",
      "submit.channel.feishuDesc":
        "Feishu の投稿窓口は準備中です。今は上の GitHub 投稿フォームをご利用ください。",
      "submit.channel.soon": "もうすぐ開通",
      "submit.form.title": "クイック投稿",
      "submit.form.noticeA": "サイト内クイック投稿はまだ開放していません",
      "submit.form.noticeB": " · 上の GitHub 投稿フォームをご利用ください",
      "submit.form.files": "画像ファイル",
      "submit.form.filesHint":
        "GitHub フォームでは画像をそのままドラッグしてください。サイト内クイック投稿は未開放です。",
      "submit.form.name": "画像の名前",
      "submit.form.desc": "ひとこと説明",
      "submit.form.character": "キャラ",
      "submit.form.metaHint":
        "タグ・作品タイプ・出所・ライセンス・連絡先はメンテナーが審査時に補完します。出所やライセンスをご存じなら、上の説明欄か Issue のコメントに書いてください。",
      "submit.form.confirmLabel": "送信前の確認",
      "submit.form.confirmHint": "3 つすべてチェックしないと送信できません。",
      "submit.form.submit": "サイト内送信 · 未開放",
      "submit.form.select": "キャラを選択",
      "submit.note1":
        "サイト内クイック投稿は未開放です。現段階では GitHub 投稿フォームを優先的にご利用ください。",
      "submit.note2":
        "投稿はすぐには公開されません。メンテナーが画像を確認してタグ・分類・出所・ライセンスを補完し、確認後に収録します。その間に Issue で質問することがあります。",

      "about.h1": "About",
      "about.lede":
        "「蓝色大肥鱼」は非公式のファン整理プロジェクトです。何をしているサイトか、画像の権利は誰にあるか、どんなデータを収集しないかを説明します。",
      "about.site.title": "このサイトについて",
      "about.site.p1a": "「蓝色大肥鱼」は",
      "about.site.p1b": "AI娘の二次創作スタンプ",
      "about.site.p1c":
        "のオープンアーカイブです。作品はキャラ別にアーカイブされ、名前・タグ・別名で検索できます。各作品に詳細ページがあり、出所とライセンスの確認、原図のダウンロード、独立したコメント欄を備えています。更新履歴はフッターから。",
      "about.site.p2a":
        "できること：キャラやカテゴリで全作品を閲覧する。名前・タグ・別名で検索する。詳細ページで原図を手に入れる。作品の下でコメントする。あるいは自分の作品を",
      "about.site.p2link": "投稿する",
      "about.site.p2b": "こともできます。",
      "about.license.title": "ライセンスと著作権",
      "about.license.p1a": "当サイトの",
      "about.license.p1b": "ソースコード",
      "about.license.p1c": "は",
      "about.license.p1d": "ライセンスで公開しています。ご自由にどうぞ。",
      "about.license.p2a": "ただし投稿・収録された",
      "about.license.p2b": "スタンプは、当サイトのリポジトリに入ったからといって自動的に",
      "about.license.p2b2": "ライセンスになるわけではありません",
      "about.license.p2c":
        "。画像の著作権は常に原作者に帰属します。使えるかどうかは、各作品の詳細ページに記載の出所とライセンスに従ってください。",
      "about.license.p3":
        "「ライセンス状態不明」の作品は、まず原作者に連絡して許諾を得てください。商用利用はしないでください。",
      "about.privacy.title": "統計とプライバシー",
      "about.privacy.li1a": "当サイトは ",
      "about.privacy.li1c":
        " を使って、ページ訪問・参照元・端末・パフォーマンスの集計データを収集します。読み込み問題の発見とページ改善のためであり、Google はファーストパーティの分析 Cookie を設定することがあります。",
      "about.privacy.li2a": "広告のパーソナライズ、Google Signals、広告ストレージはすべて無効化しています",
      "about.privacy.li2c":
        "。アカウントのプロファイリングは行わず、統計データを人気スコアやランキングにすることもありません。",
      "about.privacy.li3a": "Google Fonts は Google のフォントサービスから読み込みます。コメントは ",
      "about.privacy.li3c": " にホストされ、当サイトがコメント者の情報を保存することはありません。",
      "about.comments.p1a": "コメントは ",
      "about.comments.p1c": "（",
      "about.comments.p1d":
        "）でホストされています。コメントには GitHub アカウントでのログインが必要です。作品ごとに独立したスレッドが立ち、混線しません。",
      "about.credits.title": "クレジット",
      "about.credits.p":
        "当サイトの収録キャラのデザイン基礎を作ってくださったクリエイターの皆さんに感謝します：",
      "about.credits.design": "：キャラクターデザイン；",
      "about.credits.redesign": "：キャラクター二次デザイン。",
      "about.takedown.title": "署名と削除",
      "about.takedown.p1":
        "原作者による署名の追加・出所情報の修正・作品の削除のご依頼は、GitHub の「署名と削除申請」フォームからどうぞ。メンテナーができるだけ早く対応します。",
      "about.takedown.p2a": "有効な著作権の申し立てを受けた場合は",
      "about.takedown.p2b": "まず該当作品を下架してから状況を確認します",
      "about.takedown.p2c": "。",
      "about.takedown.btn": "署名・削除申請を開く",
      "about.group.title": "交流グループ",
      "about.group.a": "当サイトの QQ グループは「鱼之饭盆」、グループ番号は ",
      "about.group.c":
        "。QQ でこの番号を検索すれば参加できます。画像の話、更新の催促、バグ報告、単に魚を見に来るだけでも歓迎です。",

      "projects.h1": "プロジェクト",
      "projects.lede": "私の他のプロジェクトやサイトを、少しずつここに載せていきます。",
      "projects.recruit.a": "プロジェクト募集中",
      "projects.recruit.b": " · 現在はプレースホルダー",
      "projects.slot": "追って追加",

      "changelog.h1": "更新履歴",
      "changelog.lede": "当サイトの変更記録です。大きなものも小さなものも一筆書いています。",
      "changelog.note":
        "このページは抜粋です。完全な変更履歴はリポジトリの archive/2026-09-24/CHANGELOG.md にアーカイブされています。",

      "notfound.h1": "404 · お探しの魚は見つかりません",
      "notfound.lede":
        "このアドレスの下は空です。リンクの打ち間違い、作品がすでに削除済み、あるいはまだ収録されていない可能性があります。",
      "notfound.text": "魚の池をくまなく探しましたが、お探しの一枚は見つかりませんでした。",
      "notfound.reasonsTitle": "考えられる原因",
      "notfound.reason1a":
        "アドレスの 1 文字が抜けているか間違っているのかも。作品詳細ページのアドレスはこの形です：",
      "notfound.reason1c": "。",
      "notfound.reason2": "この作品は作者の要請により削除され、サイトから撤去されました。",
      "notfound.reason3":
        "リニューアル前の旧アドレスを開いています。ページは移動しました。ホーム・カタログ・更新履歴はまだあります。",
      "notfound.exitHome": "ホームへ戻る",
      "notfound.exitCategory": "キャラやカテゴリから探す",
      "notfound.exitSubmit": "画像があれば投稿しよう",
      "notfound.noteA":
        "サイト内のリンクから来たのでしたら、こちらの貼り間違いです。お手数ですが ",
      "notfound.noteC": " でお知らせください。",

      "work.breadcrumbLabel": "パンくずリスト",
      "work.download": "原図をダウンロード",
      "work.copyLink": "リンクをコピー",
      "work.info": "作品情報",
      "work.field.type": "タイプ",
      "work.field.format": "形式",
      "work.field.size": "サイズ",
      "work.field.volume": "ファイルサイズ",
      "work.field.submitter": "投稿者",
      "work.field.origin": "出所タイプ",
      "work.field.originAuthor": "出所の作者",
      "work.field.sourceUrl": "出所リンク",
      "work.field.license": "ライセンス状態",
      "work.field.date": "収録日",
      "work.unlabeled": "未記入",
      "work.aka": "別名：{aliases}",
      "work.count": "作品 {count} 件",
      "work.tags": "タグ",
      "work.licenseTitle": "ライセンスについて",
      "work.licenseFootnoteA": "画像の著作権は原作者に帰属します。",
      "work.licenseFootnoteLink": "署名・修正・削除を申請",
      "work.more": "{name}のスタンプをもっと",
      "work.guess": "おすすめ",
      "work.emptySame": "このキャラの作品はまだ他にありません",
      "work.emptyGuess": "おすすめはまだありません",
      "work.figcaption": "《{name}》· {character}",
      "work.cardMeta": "{character} · {kindId}",
      "origin.self-created": "自作・自生成",
      "origin.author-submitted": "原作者本人による投稿",
      "origin.internet-found": "ネット収集",
      "origin.community-created": "コミュニティメンバー制作",
      "origin.unknown": "出所不明",
      "license.submitter-permission": "投稿者が収録・ダウンロードを許諾",
      "license.author-permission": "原作者が明確に許諾",
      "license.cc0": "CC0 パブリックドメイン",
      "license.cc-by": "CC BY 表示",
      "license.cc-by-nc": "CC BY-NC 表示・非営利",
      "license.unknown": "ライセンス状態不明",
      "license.removed": "削除済み"
    }
  };

  /* 各页 title / description（en / ja）按 body[data-i18n-page] 取用 */
  var PAGES = {
    index: true, category: true, submit: true, about: true,
    projects: true, changelog: true, notfound: true
  };

  // ---------- 语言检测与持久化 ----------
  function normalize(raw) {
    var text = String(raw || "").toLowerCase();
    if (text.indexOf("en") === 0) return "en";
    if (text.indexOf("ja") === 0 || text.indexOf("jp") === 0) return "ja";
    if (text.indexOf("zh") === 0) return "zh";
    return "";
  }

  function detect() {
    try {
      var fromUrl = normalize(new URLSearchParams(window.location.search).get("lang"));
      if (fromUrl) {
        try { window.localStorage.setItem(STORAGE_KEY, fromUrl); } catch (err) { /* 隐私模式等：只影响记忆 */ }
        return fromUrl;
      }
      var saved = normalize(window.localStorage.getItem(STORAGE_KEY));
      if (saved) return saved;
    } catch (err) { /* localStorage 不可用：继续浏览器语言检测 */ }
    var candidates = window.navigator.languages || [window.navigator.language || ""];
    for (var i = 0; i < candidates.length; i += 1) {
      var hit = normalize(candidates[i]);
      if (hit) return hit;
    }
    return "zh";
  }

  var current = detect();
  var originals = new WeakMap(); // element -> { text, attrs: { attr: value } }

  // ---------- 取词 ----------
  function interpolate(text, params) {
    if (!params) return String(text);
    return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      if (name === "kindId") {
        var kindId = String(params.kindId || "meme");
        return lookup("kind." + kindId, kindId);
      }
      return params[name] === undefined ? whole : String(params[name]);
    });
  }

  function lookup(key, fallback) {
    if (current !== "zh") {
      var table = DICT[current];
      if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    }
    return fallback;
  }

  function fmt(key, fallback, params) {
    return interpolate(lookup(key, fallback), params);
  }

  // ---------- 应用翻译 ----------
  function cacheOriginal(el) {
    if (!originals.has(el)) {
      originals.set(el, { text: el.textContent, attrs: {} });
    }
    return originals.get(el);
  }

  function applyElement(el) {
    var original = cacheOriginal(el);
    var tplKey = el.getAttribute("data-i18n-tpl");
    var plainKey = el.getAttribute("data-i18n");
    var vars = null;
    var rawVars = el.getAttribute("data-i18n-vars");
    if (rawVars) {
      try { vars = JSON.parse(rawVars); } catch (err) { vars = null; }
    }
    if (tplKey) {
      el.textContent = current === "zh" ? original.text : interpolate(lookup(tplKey, original.text), vars);
    } else if (plainKey) {
      el.textContent = current === "zh" ? original.text : lookup(plainKey, original.text);
    }
    var attrSpec = el.getAttribute("data-i18n-attr");
    if (attrSpec) {
      String(attrSpec).split(",").forEach(function (pair) {
        var parts = pair.split(":");
        var attr = String(parts[0] || "").trim();
        var key = String(parts[1] || "").trim();
        if (!attr || !key) return;
        if (!Object.prototype.hasOwnProperty.call(original.attrs, attr)) {
          original.attrs[attr] = el.getAttribute(attr);
        }
        if (current === "zh") {
          el.setAttribute(attr, original.attrs[attr] == null ? "" : original.attrs[attr]);
        } else {
          var fallback = original.attrs[attr] == null ? "" : original.attrs[attr];
          el.setAttribute(attr, interpolate(lookup(key, fallback), vars));
        }
      });
    }
  }

  function applyPageMeta() {
    var page = document.body ? document.body.getAttribute("data-i18n-page") : null;
    if (!page || !PAGES[page]) return;
    if (!applyPageMeta.cached) applyPageMeta.cached = {};
    var cache = applyPageMeta.cached;
    if (!cache[page]) {
      cache[page] = {
        title: document.title,
        description: (document.querySelector('meta[name="description"]') || {}).content || "",
        ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content || "",
        ogDescription: (document.querySelector('meta[property="og:description"]') || {}).content || ""
      };
    }
    var original = cache[page];
    if (current === "zh") {
      document.title = original.title;
      setMeta('meta[name="description"]', original.description);
      setMeta('meta[property="og:title"]', original.ogTitle);
      setMeta('meta[property="og:description"]', original.ogDescription);
      return;
    }
    var table = DICT[current] || {};
    var title = table["page." + page + ".title"];
    var description = table["page." + page + ".desc"];
    if (title) document.title = title;
    setMeta('meta[name="description"]', description);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description);
  }

  function setMeta(selector, value) {
    if (!value) return;
    var el = document.querySelector(selector);
    if (el) el.setAttribute("content", value);
  }

  function apply() {
    var nodes = document.querySelectorAll("[data-i18n],[data-i18n-tpl],[data-i18n-attr]");
    for (var i = 0; i < nodes.length; i += 1) applyElement(nodes[i]);
    var htmlLang = "zh-CN";
    for (var j = 0; j < LANGS.length; j += 1) {
      if (LANGS[j].id === current) htmlLang = LANGS[j].htmlLang;
    }
    document.documentElement.lang = htmlLang;
    applyPageMeta();
  }

  // ---------- 语言切换器（注入 header .topnav 末尾） ----------
  function injectSwitcher() {
    var nav = document.querySelector(".topnav");
    if (!nav || document.getElementById("lang-switch")) return;
    var box = document.createElement("div");
    box.id = "lang-switch";
    box.className = "lang-switch";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", fmt("ui.switchLang", "切换语言"));
    LANGS.forEach(function (lang) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "lang-switch-btn";
      button.textContent = lang.label;
      button.title = lang.title;
      button.lang = lang.htmlLang;
      button.setAttribute("aria-pressed", String(lang.id === current));
      button.addEventListener("click", function () { setLang(lang.id); });
      box.appendChild(button);
    });
    nav.appendChild(box);
  }

  function refreshSwitcher() {
    var box = document.getElementById("lang-switch");
    if (!box) return;
    var buttons = box.querySelectorAll(".lang-switch-btn");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute("aria-pressed", String(LANGS[i] && LANGS[i].id === current));
    }
    box.setAttribute("aria-label", fmt("ui.switchLang", "切换语言"));
  }

  function setLang(id) {
    var next = normalize(id);
    if (!next || next === current) return;
    current = next;
    try { window.localStorage.setItem(STORAGE_KEY, current); } catch (err) { /* 忽略 */ }
    apply();
    refreshSwitcher();
    document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { lang: current } }));
  }

  // ---------- 对外接口 ----------
  window.SiteLang = {
    get current() { return current; },
    t: fmt,
    fmt: fmt,
    setLang: setLang
  };

  function init() {
    apply();
    injectSwitcher();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
