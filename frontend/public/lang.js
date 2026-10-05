/* 蓝色大肥鱼 · 站点多语言层（zh 默认 / zh-Hant / en / ja）
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
     · 发布页面的 data-site-lang 固定 URL 对应的语言，菜单跳转到语言版本；
       旧 ?lang= 链接兼容跳转。未标记的开发页面仍支持原地切换。
   作品名、Tag、详情页正文（commentary）等属于内容数据，保持原文。 */

(function () {
  "use strict";

  var STORAGE_KEY = "bluedafeiyu-lang";
  var CHANGE_EVENT = "site:langchange";

  var LANGS = [
    { id: "zh", label: "简体中文", title: "简体中文", htmlLang: "zh-CN" },
    { id: "zh-Hant", label: "繁體中文", title: "繁體中文", htmlLang: "zh-Hant" },
    { id: "en", label: "English", title: "English", htmlLang: "en" },
    { id: "ja", label: "日本語", title: "日本語", htmlLang: "ja" }
  ];

  /* 词典：只存 en / ja。zh 走页面原文。改文案时同步改页面里的中文与这里两份。 */
  var DICT = {
    en: {
      "v2.licenseShort.unknown": "Unclear",
      "v2.licenseShort.author-permission": "Author permission",
      "v2.licenseShort.submitter-permission": "Submitter permission",
      "page.work.title": "{name} - {character} {kindId} | 蓝色大肥鱼",
      "page.work.desc": "View {name}, a {kindId} featuring {character}. Check attribution and image permissions, view the full-size image, download the original and discuss the work.",
      "page.characterDetail.title": "{name} stickers and fan art | 蓝色大肥鱼",
      "page.characterDetail.desc": "Browse {count} AI-girl fan works featuring {name}. View images, check their sources and download originals.",
      "page.categoryDetail.title": "{name} works | 蓝色大肥鱼",
      "page.categoryDetail.desc": "Browse {count} AI-girl fan works in {name}. View full-size images and check sources and permissions.",
      "page.topicDetail.title": "{name} collection | 蓝色大肥鱼",
      "page.topicDetail.desc": "A hand-picked collection of {count} AI-girl fan works: {name}.",
      "work.imageCreditText": "{credit}蓝色大肥鱼 (archive)",
      "work.copyright.cc0": "Recorded as CC0 public domain; check the work's permission notes.",
      "work.copyright.named": "Image copyright belongs to the original author {creator}.",
      "work.copyright.unknown": "Image copyright belongs to its original author, who is not identified.",
      "theme.toLight": "Switch to light mode",
      "theme.toDark": "Switch to dark mode",
      "v2.sort.popular": "Popular",
      "v2.sort.downloads": "Downloads",
      "v2.sort.curated": "Curated order",
      "stats.counts": "Views {views} · Downloads {downloads}",
      "stats.updated": "Updated: {date}; downloads count button clicks",
      "stats.unavailable": "Statistics have not synced yet",
      "stats.note": "Since {start}, updated {date}; downloads count button clicks",
      "stats.stale": "Statistics update delayed",
      "stats.limited": "Some counts are limited by GA4 aggregation",
      "stats.sortFail": "Statistics sorting is unavailable. Please try again later.",
      "nav.home": "Home",
      "nav.category": "Categories",
      "nav.submit": "Submit",
      "nav.about": "About",
      "nav.projects": "Projects",
      "nav.topics": "Collections",
      "page.topics.title": "AI-Girl Sticker Collections - Hand-Picked Series & Themed Sets | 蓝色大肥鱼",
      "page.topics.desc": "Hand-picked AI-girl sticker collections: works from the same series or on the same joke, gathered so you can browse them in a row, view in high resolution and download originals.",
      "topics.h1": "Collections",
      "topics.lede.a": "Hand-picked: works on the same joke or from the same series, stacked together to ",
      "topics.lede.b": "read in a row",
      "topics.lede.c": ". Pick any collection to start.",
      "topics.none": "Collections are still being hand-picked — try the category page for now.",
      "topics.back": "All collections",
      "topics.switch": "Switch collection",
      "topics.search": "Search names or tags in this collection",
      "topics.count": "{count} works",
      "topics.searchAll": "Search collection names, blurbs or included works",
      "topics.miss": "No matching collections — try another keyword.",
      "topics.indexCount": "{matched} / {total} collections",
      "index.topics.prev": "Previous collections",
      "index.topics.next": "Next collections",
      "index.section.topics": "Collections",
      "index.topics.more": "All collections",
      "brand.tagline": "An open archive of AI-girl fan stickers",
      "footer.disclaimer":
        "An unofficial fan-curated project. All images belong to their original authors. This site uses minimal Google Analytics to understand traffic and performance, and displays aggregate work views and download clicks.",
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
      "qq.join": "Join the QQ group",
      "qq.scan": "Scan to join",
      "qq.qrAlt": "QR code for joining the QQ group \u201cAAAA肥鱼批发市场\u201d (group number 1003728058)",
      "alt.work": "\u201c{name}\u201d — {character} {kindId} fan art",

      "page.index.title": "蓝色大肥鱼 - AI-Girl Fan Stickers, Memes & Character Art Downloads",
      "page.index.desc":
        "蓝色大肥鱼 archives AI-girl fan stickers, memes, illustrations, character sheets and multi-panel comics featuring DeepSeek, Claude, Qwen, GLM and more — browse by character, search by tag, view in high resolution and download originals.",
      "page.category.title": "AI-Girl Sticker Categories - Browse Memes, Illustrations & Comics by Character | 蓝色大肥鱼",
      "page.category.desc":
        "Browse AI-girl memes, stickers, fan illustrations, character sheets and comics by character (DeepSeek, Claude, Qwen, GLM and more), and search names & tags within each category.",
      "page.submit.title": "Submit AI-Girl Fan Stickers - On-Site Form & GitHub | 蓝色大肥鱼",
      "page.submit.desc":
        "Submitting an AI-girl fan sticker only takes an image upload plus its name and character — an optional one-line note. Use the on-site form or the GitHub form; approved works are published in batches, and tags, source, license and category are added by maintainers during review.",
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
      "index.qq.lede1": "QQ group \u201cAAAA肥鱼批发市场\u201d",
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
        "Submit your AI character fan art on this page or through GitHub: upload an image, enter its name and character, and choose whether to display credit. A note is optional. Maintainers review the remaining information and publish approved submissions in batches.",
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
        "Upload an image, enter its name and character, and choose whether to display credit. A credit name is required if selected; a personal homepage and note are optional. Maintainers add tags, categories, source, license and detail text during review. Put any known source or license information in the note or an Issue comment.",
      "submit.confirmTitle": "You must confirm three items before submitting:",
      "submit.confirm1":
        "I confirm I have the right to submit this image, or have obtained the original author's permission.",
      "submit.confirm2":
        "I agree that maintainers may archive it after verification, and edit its info or remove it upon a copyright request.",
      "submit.confirm3":
        "I understand this is an unofficial fan-curated project, and image copyright always stays with the original author.",
      "submit.qq.title": "Submit via QQ group",
      "submit.qq.a": "The QQ group is called \u201cAAAA肥鱼批发市场\u201d, group number ",
      "submit.qq.c":
        ". Posting the image in the group and @-ing a maintainer counts as a submission too.",
      "submit.qq.hint":
        "The submission form remains the canonical channel: images posted in the group are filed through the form by maintainers, with source & license filled in afterwards.",
      "submit.channel.title": "Submission channels",
      "submit.channel.github": "GitHub submission form",
      "submit.channel.githubOn": "Open · recommended",
      "submit.channel.githubDesc":
        "Drag and drop the image, enter its name and character, and choose whether to display credit. A credit name is required if selected; a homepage and note are optional.",
      "submit.channel.open": "Open the form",
      "submit.channel.feishu": "Feishu submission",
      "submit.channel.feishuTag": "Placeholder · coming soon",
      "submit.channel.feishuDesc":
        "The Feishu channel is still in preparation — please use the GitHub form above for now.",
      "submit.channel.soon": "Coming soon",
      "submit.form.title": "Quick submit",
      "submit.form.noticeA": "On-site quick submit is open",
      "submit.form.noticeB": " · submissions are queued for review and published in batches once approved",
      "submit.form.files": "Image files",
      "submit.form.filesHint":
        "PNG / JPG / GIF / WebP / APNG, up to 10 MB each; send the original file, not a chat screenshot.",
      "submit.form.name": "Image name",
      "submit.form.desc": "One-line note",
      "submit.form.character": "Character",
      "submit.form.credit": "Display credit",
      "submit.form.anonymous": "No credit",
      "submit.form.named": "Credit me",
      "submit.form.creditName": "Credit name",
      "submit.form.creditUrl": "Personal homepage (optional)",
      "submit.form.creditHint": "Clicking your credited name opens your homepage. This identifies the submitter; put image source and original author information in the note.",
      "submit.form.err.credit": "Choose whether to display credit.",
      "submit.form.err.creditName": "Enter a credit name, up to 120 characters.",
      "submit.form.err.creditUrl": "Enter a valid http:// or https:// homepage address.",
      "submit.form.metaHint":
        "Tags, work type, source and license are added by maintainers during review; if you know the source or license, put it in the note above.",
      "submit.form.confirmLabel": "Confirm before submitting",
      "submit.form.confirmHint": "All three boxes must be checked to submit.",
      "submit.form.submit": "Submit on-site",
      "submit.form.select": "Select a character",
      "submit.form.submitting": "Submitting…",
      "submit.form.success":
        "Submitted — thank you! Approved works are published in batches after review.",
      "submit.form.turnstileHint": "Please complete the human verification before submitting.",
      "submit.form.err.fileRequired": "Choose an image first.",
      "submit.form.err.fileCount": "Only one image can be submitted at a time.",
      "submit.form.err.fileType": "Only PNG / JPG / GIF / WebP / APNG are supported.",
      "submit.form.err.fileSize": "A single image must not exceed 10 MB.",
      "submit.form.err.fileEmpty": "The image is empty — please choose another file.",
      "submit.form.err.name": "Enter an image name of no more than 120 characters.",
      "submit.form.err.character": "Choose a character.",
      "submit.form.err.desc": "The note must not exceed 500 characters.",
      "submit.form.err.confirm": "Please tick all three confirmations first.",
      "submit.form.err.turnstile": "Please complete the human verification first.",
      "submit.form.err.tooLarge": "The image exceeds the size limit — compress it and try again.",
      "submit.form.err.rejected":
        "The submission was not accepted. Please try again later or use the GitHub form.",
      "submit.form.err.busy": "Too many submissions: each IP can submit up to 10 times per hour. Please try again later.",
      "submit.form.err.invalid": "The submission did not pass validation — please check and retry.",
      "submit.form.err.server": "Submission failed. Please try again later or use the GitHub form.",
      "submit.note1":
        "You can also keep using the GitHub submission form above; both routes feed the same review queue.",
      "submit.note2":
        "Submissions don't go live immediately: maintainers review each image and fill in tags, category, source and license, then approved works are published in batches; they may reach out to confirm details.",

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
      "about.rights.unknown": "License status unclear: this site has not verified permission to use the image. Archiving and downloads do not grant redistribution, adaptation or commercial rights.",
      "about.rights.submitter": "Submitter permission: records permission for this site to archive the image and offer downloads. Confirm other uses with the rights holder.",
      "about.rights.author": "Author permission: permitted uses are recorded in the work's license notes. Contact the original author for uses not explicitly covered.",
      "about.rights.cc0": "CC0 public domain: the work is recorded as CC0. Verify the original declaration and any third-party rights before use.",
      "about.rights.by": "CC BY attribution: follow the original author's attribution conditions. The license version comes from the original declaration; this site does not assume a version.",
      "about.rights.byNc": "CC BY-NC attribution, non-commercial: follow attribution and non-commercial conditions. Check the original declaration for the version; commercial use needs separate permission.",
      "about.rights.acquireTitle": "How to obtain permission to use an image",
      "about.rights.acquireBody": "Open the work and check its source author, source link and license notes. Contact the rights holder through their public profile or original post, specifying the work, intended use and whether it is commercial. If the author or source is missing, use the Attribution & removal form below with the work URL so maintainers can help identify the source. This site cannot grant permission on behalf of an unknown rights holder.",
      "about.privacy.li1a": "This site uses ",
      "about.privacy.li1c":
        " to collect aggregated page-visit, source, device and performance data, in order to spot loading issues and improve pages; Google may set first-party analytics cookies.",
      "about.privacy.li2a": "Ads personalization, Google Signals and ad storage are all disabled",
      "about.privacy.li2c":
        "; this site builds no user profiles. Aggregate work views and download clicks are displayed and used for sorting.",
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
      "about.group.a": "Our QQ group is called \u201cAAAA肥鱼批发市场\u201d, group number ",
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
      "work.field.imageCredit": "Image credit",
      "work.field.copyright": "Copyright notice",
      "work.acquireLicense": "How to obtain permission",
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
      "license.removed": "Taken down",
      /* ---- v2 前台（左侧导航 / 作品浮层 / 社群 / 搜索） ---- */
      "v2.skip": "Skip to content",
      "v2.siteNav": "Site navigation",
      "v2.tagline": "AI-girl fan art gallery",
      "v2.closeMenu": "Close menu",
      "v2.openMenu": "Open menu",
      "v2.nav.gallery": "Gallery",
      "v2.nav.works": "Works",
      "v2.nav.characters": "Characters",
      "v2.nav.collections": "Collections",
      "v2.nav.community": "Community",
      "v2.nav.events": "Latest Event",
      "v2.joinGroup": "Join the group",
      "v2.aboutCopyright": "About & copyright",
      "v2.disclaimer": "Unofficial fan project. All images belong to their original authors.",
      "v2.searchLabel": "Search works",
      "v2.searchPh": "Search works, characters, aliases or tags",
      "v2.searchPh2": "Title, character, alias, tag",
      "v2.search": "Search",
      "v2.keyword": "Keyword",
      "v2.entries": "Site links",
      "v2.cta.title": "Join “AAAA肥鱼批发市场”",
      "v2.ev.alt": "The whale girl holding a Happy National Day sticker",
      "v2.ev.kicker": "Happy National Day 🐳",
      "v2.ev.title": "Site Front-End Design Contest",
      "v2.ev.text": "Design a new look for the 蓝色大肥鱼.com website. Any AI, any tool, any stack — hand-code it or just ask an AI.",
      "v2.ev.deadline": "Deadline",
      "v2.ev.deadlineV": "Oct 26 (Mon) 23:59, UTC+8",
      "v2.ev.prize": "Prizes",
      "v2.ev.prizeV": "Adopted ¥88 · Popular ¥66",
      "v2.ev.more": "Event details",
      "v2.ev.later": "Maybe later",
      "v2.cta.text": "Chat about art, ask for more, submit work and join events. QQ group",
      "v2.cta.more": "About the group",
      "v2.worksSub": "{count} works",
      "v2.pageN": "Page {n}",
      "v2.byType": "Filter by type",
      "v2.sort": "Sort",
      "v2.sort.latest": "Newest",
      "v2.sort.random": "Random",
      "v2.type.meme": "Meme",
      "v2.type.illustration": "Illustration",
      "v2.type.setting": "Character sheet",
      "v2.type.comic": "Comic",
      "v2.typeSub.meme": "Sticker jokes and chat images · {count} works",
      "v2.typeSub.illustration": "Fully composed artwork · {count} works",
      "v2.typeSub.setting": "Standing art, turnarounds and design sheets · {count} works",
      "v2.typeSub.comic": "Short multi-panel comics · {count} works",
      "v2.charsSub": "Pick a character to see their works.",
      "v2.charTypeSub": "{kindId} · {count} works",
      "v2.topicsSub": "Hand-picked sets of works, viewed in one go.",
      "v2.topicsEmpty": "Collections are still being put together. Browse ",
      "v2.topicsEmpty2": " in the meantime.",
      "v2.nextBatch": "Next batch of works",
      "v2.emptyA": "No works here yet. ",
      "v2.emptyB": "Submit the first one",
      "v2.topic.authorTag": "Collection by",
      "v2.topic.badge": "Collection",
      "v2.topic.home": "Author's page",
      "v2.topic.moreChannels": "More channels",
      "v2.topic.primary": "Go to",
      "ev.lede": "The new site is live, but the owner still isn’t happy with it. We want to see what you think an AI-girl fan-art site should look like.",
      "ev.s1": "Any AI, any tool, any tech stack.",
      "ev.s2": "Hand-code it, or just make a wish to an AI.",
      "ev.s3": "As long as the page runs and fits the theme.",
      "ev.cta.repo": "Submit in the event repo",
      "ev.cta.soon": "Event repo opening soon",
      "ev.cta.gallery": "Submission gallery",
      "ev.cta.group": "Chat in the group",
      "ev.h.what": "What to make",
      "ev.what1": "Design a new look for the 蓝色大肥鱼.com website. Home, the works feed, character pages — anything goes. One page is fine; redoing the whole site is fine too.",
      "ev.what2": "Style is completely up to you. The current “grid paper + hand-drawn ink” look is just what we have now: cyber, pixel, magazine, watercolor, minimal, retro game… the more styles the better, as long as it serves the site’s purpose (browsing, finding and downloading AI-girl fan art).",
      "ev.what3": "The event repo has a starter kit: the site’s works and character data, the current palette, and a few prompts you can hand straight to an AI. The kit and example only show how things work — no need to copy them.",
      "ev.h.how": "How to join",
      "ev.how1a": "Fork the ",
      "ev.how1b": "event repo",
      "ev.how1c": ".",
      "ev.how2a": "Put your page in ",
      "ev.how2path": "submissions/your-GitHub-username/",
      "ev.how2b": ", with ",
      "ev.how2c": " as the entry file.",
      "ev.how3": "Open a PR. If the page opens and fits the theme, it gets merged — and once merged, you’re in.",
      "ev.howNote": "After merging you can keep sending PRs to update your own folder until the deadline.",
      "ev.h.time": "Schedule (Beijing time, UTC+8)",
      "ev.t1a": "From now",
      "ev.t1b": "Submissions open, merged as they come",
      "ev.t2a": "Oct 26 (Mon) 23:59",
      "ev.t2b": "Deadline",
      "ev.t3a": "After deadline – Nov 6 (Fri) 23:59",
      "ev.t3b": "Popular vote",
      "ev.t4a": "Nov 7 (Sat)",
      "ev.t4b": "Results",
      "ev.h.prize": "Prizes",
      "ev.p1": "🏆 Adopted",
      "ev.p1amt": "¥88",
      "ev.p1d": "Your design becomes the site’s future front end, credited at launch.",
      "ev.p2": "🔥 Popular",
      "ev.p2amt": "¥66",
      "ev.p2d": "Awarded once there are 3 submissions. After the deadline, 👍 your favorites in the GitHub voting issue — as many as you like. Most votes wins.",
      "ev.p3": "🎨 Everyone",
      "ev.p3amt": "Gallery",
      "ev.p3da": "Every merged entry stays in the ",
      "ev.p3db": "gallery",
      "ev.p3dc": " for good.",
      "ev.prizeNote": "Prizes are DeepSeek Open Platform API credit and can be taken as cash; one person can win both. Prize money comes from the site owner personally; this event is not affiliated with DeepSeek.",
      "ev.h.tips": "Tips",
      "ev.tip1a": "The page must open as-is, so use relative paths: write ",
      "ev.tip1b": ", not ",
      "ev.tip1c": ".",
      "ev.tip2": "If you use a framework, submit the built files.",
      "ev.tip3": "Anything the rules don’t cover is up to the site owner.",
      "ev.bye": "Happy National Day, have fun 🐳 · ",
      "ev.byeGroup": "QQ group",
      "page.event.title": "National Day Site Front-End Design Contest · 蓝色大肥鱼",
      "page.event.desc": "Design a new look for 蓝色大肥鱼.com: any AI, any tool, any stack — submit a static page that runs. Deadline Oct 26; ¥88 adopted prize and ¥66 popular prize in DeepSeek API credit.",
      "v2.cm.elsewhere": "Find me elsewhere",
      "v2.cm.bili": "Bilibili",
      "v2.cm.x": "X (Twitter)",
      "v2.cm.lede": "The site’s QQ group. Chat about art, ask for more, report bugs, or just drop by to see the fish.",
      "v2.cm.how": "Search the group number in QQ, or scan the code",
      "v2.cm.canTitle": "What you can do in the group",
      "v2.cm.c2": "Submit directly",
      "v2.cm.c2d": "Mention the bot with “投稿 title character” plus an image to send it for review.",
      "v2.cm.c3": "Join events",
      "v2.cm.c3d": "Submission calls and themed challenges are announced in the group.",
      "v2.cm.c4": "Report problems",
      "v2.cm.c4d": "Broken pages, wrong images or a character you want added: just say so in the group.",
      "v2.cm.rulesTitle": "Group rules",
      "v2.cm.r1": "Keep it to AI girls, fan art and this site.",
      "v2.cm.r2": "Credit the source when sharing others’ work.",
      "v2.cm.r3": "No real-person portraits, no R18, no spamming.",
      "v2.copyManual": "Please copy it manually",
      "v2.copyImg": "Copy image",
      "v2.copiedImg": "Image copied",
      "v2.copyImgFail": "Not supported here. Long-press to save.",
      "v2.loading": "Loading",
      "v2.found": "{count} found",
      "v2.typeToSearch": "Type a keyword to search",
      "v2.work": "Work",
      "v2.allLoaded": "All {count} works loaded",
      "v2.loadFail": "Failed to load",
      "v2.retry": "Retry",
      "v2.openNext": "Open next page",
      "v2.prev": "Previous",
      "v2.next": "Next",
      "v2.author": "Author",
      "v2.credit": "Credit",
      "v2.source": "Source",
      "v2.takedown": "Is this your work? Request attribution or removal",
      "v2.loadComments": "Show comments",
      "v2.origin.issue": "GitHub Issue submission",
      "v2.origin.qq": "QQ group submission",
      "v2.origin.site": "On-site submission",
      "v2.homeTitle": "蓝色大肥鱼 - AI-Girl Fan Art Gallery",
      "page.characters.title": "AI-Girl Characters - Browse Fan Art by Character | 蓝色大肥鱼",
      "page.characters.desc": "Browse AI-girl fan art by character: DeepSeek, Claude, GPT, Qwen, GLM and more.",
      "page.community.title": "Join the Community · AAAA肥鱼批发市场 | 蓝色大肥鱼",
      "page.community.desc": "The 蓝色大肥鱼 QQ group “AAAA肥鱼批发市场”: chat about art, submit work and join events.",
      "page.search.title": "Search AI-Girl Fan Art | 蓝色大肥鱼",
      "page.search.desc": "Search AI-girl fan art by title, character, alias or tag."
    },

    ja: {
      "v2.licenseShort.unknown": "許諾不明",
      "v2.licenseShort.author-permission": "作者許諾",
      "v2.licenseShort.submitter-permission": "投稿許諾",
      "page.work.title": "{name} - {character} {kindId} | 蓝色大肥鱼",
      "page.work.desc": "{character}の{kindId}「{name}」。クレジットと画像の利用許諾を確認し、大きな画像を表示、原図をダウンロード、作品についてコメントできます。",
      "page.characterDetail.title": "{name}のスタンプと二次創作 | 蓝色大肥鱼",
      "page.characterDetail.desc": "{name}のAI娘二次創作を{count}件収録。画像、出所と利用許諾を確認し、原図をダウンロードできます。",
      "page.categoryDetail.title": "{name}の作品 | 蓝色大肥鱼",
      "page.categoryDetail.desc": "{name}に分類されたAI娘二次創作を{count}件収録。大きな画像、出所と利用許諾を確認できます。",
      "page.topicDetail.title": "{name}の特集 | 蓝色大肥鱼",
      "page.topicDetail.desc": "AI娘二次創作{count}件の手選び特集「{name}」。",
      "work.imageCreditText": "{credit}蓝色大肥鱼（アーカイブ）",
      "work.copyright.cc0": "CC0パブリックドメインとして記録。作品の利用許諾の備考を確認してください。",
      "work.copyright.named": "画像の著作権は原作者{creator}に帰属します。",
      "work.copyright.unknown": "画像の著作権は原作者に帰属します。原作者は未記載です。",
      "theme.toLight": "ライトモードに切り替え",
      "theme.toDark": "ダークモードに切り替え",
      "v2.sort.popular": "人気順",
      "v2.sort.downloads": "ダウンロード数",
      "v2.sort.curated": "選定順",
      "stats.counts": "閲覧 {views} · ダウンロード {downloads}",
      "stats.updated": "更新：{date}。ダウンロード数はボタンのクリック回数です",
      "stats.unavailable": "統計はまだ同期されていません",
      "stats.note": "集計開始 {start}、更新 {date}。ダウンロード数はクリック回数です",
      "stats.stale": "統計の更新が遅れています",
      "stats.limited": "GA4 の集計制限により一部の統計が制限されています",
      "stats.sortFail": "統計による並べ替えは利用できません。後でもう一度お試しください。",
      "nav.home": "ホーム",
      "nav.category": "カタログ",
      "nav.submit": "投稿",
      "nav.about": "About",
      "nav.projects": "プロジェクト",
      "nav.topics": "特集",
      "page.topics.title": "AI娘スタンプ特集 - 管理人セレクトの連載・テーマ集 | 蓝色大肥鱼",
      "page.topics.desc": "管理人が選んだAI娘スタンプの特集。同じ連載・同じネタの作品をまとめて続けて見られ、高解像度表示と原画ダウンロードもできます。",
      "topics.h1": "特集",
      "topics.lede.a": "管理人セレクト：同じネタ、同じ連載をひと束にまとめて",
      "topics.lede.b": "続けて見る",
      "topics.lede.c": "。好きな特集から開いてください。",
      "topics.none": "特集は選定中です。まずはカタログをどうぞ。",
      "topics.back": "すべての特集",
      "topics.switch": "ほかの特集",
      "topics.search": "この特集内で名前・タグを検索",
      "topics.count": "{count} 件",
      "topics.searchAll": "特集名・紹介文・収録作品で検索",
      "topics.miss": "一致する特集がありません。別のキーワードでお試しください。",
      "topics.indexCount": "{matched} / {total} 特集",
      "index.topics.prev": "前の特集",
      "index.topics.next": "次の特集",
      "index.section.topics": "特集",
      "index.topics.more": "すべての特集",
      "brand.tagline": "AI娘スタンプのオープンアーカイブ",
      "footer.disclaimer":
        "非公式のファン整理プロジェクトです。画像の著作権は各原作者に帰属します。当サイトは最小限の Google Analytics を使用し、作品の閲覧数とダウンロードボタンのクリック数を集計・表示します。",
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
      "qq.join": "QQ グループに参加",
      "qq.scan": "QRコードで参加",
      "qq.qrAlt": "QQグループ「AAAA肥鱼批发市场」（グループ番号 1003728058）への参加用QRコード",
      "alt.work": "《{name}》{character}{kindId}、AI娘二次創作画像",

      "page.index.title": "蓝色大肥鱼 - AI娘スタンプ・DeepSeek娘ネタ画・二次創作イラスト集",
      "page.index.desc":
        "蓝色大肥魚は DeepSeek娘・Claude娘・Qwen娘・GLM娘 などの AI娘スタンプ・ネタ画・イラスト・設定画・多コマ漫画を収録。キャラ別の分類、タグ検索、高解像度表示、原図ダウンロードに対応しています。",
      "page.category.title": "AI娘スタンプのカタログ - キャラ別にネタ画・イラスト・設定画・漫画を閲覧 | 蓝色大肥鱼",
      "page.category.desc":
        "DeepSeek娘・Claude娘・Qwen娘・GLM娘 などのキャラ別に、AI娘のネタ画・スタンプ・ファンアート・設定画・多コマ漫画を閲覧。カテゴリ内で名前やタグを検索できます。",
      "page.submit.title": "AI娘スタンプの投稿 - サイト内フォームと GitHub | 蓝色大肥鱼",
      "page.submit.desc":
        "AI娘スタンプの投稿は、画像のアップロードと画像名・キャラの記入だけ。ひとこと説明は任意です。サイト内フォームでも GitHub フォームでも投稿でき、承認後にまとめて公開されます。タグ・出所・ライセンス・分類はメンテナーが審査時に補完します。",
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
      "index.qq.lede1": "QQグループ「AAAA肥鱼批发市场」",
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
        "AI娘の二次創作をこのページまたはGitHubから投稿できます。画像・名前・キャラを入力し、クレジット表記の有無を選んでください。説明は任意です。メンテナーが審査し、承認後にまとめて公開します。",
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
        "画像・名前・キャラを入力し、クレジット表記の有無を選んでください。表記する場合は名前が必須で、個人ホームページと説明は任意です。タグ・分類・出所・ライセンス・詳細文は審査時に補完します。出所や許諾情報は説明欄かIssueコメントに記入してください。",
      "submit.confirmTitle": "送信前に次の 3 つに同意してください：",
      "submit.confirm1":
        "この画像を投稿する権利を持ち、または原作者の許諾を得ていることを確認します。",
      "submit.confirm2":
        "メンテナーが確認後に収録すること、著作権の申し立てがあれば情報修正や削除が行われることに同意します。",
      "submit.confirm3":
        "当サイトが非公式のファン整理プロジェクトであり、画像の著作権は原作者に帰属することを理解しています。",
      "submit.qq.title": "グループで投稿",
      "submit.qq.a": "QQグループは「AAAA肥鱼批发市场」、グループ番号は ",
      "submit.qq.c":
        "。グループに画像を投稿してメンテナーに @ をつければ、それも投稿として扱われます。",
      "submit.qq.hint":
        "収録はあくまで投稿フォーム基準です。グループ投稿の画像はメンテナーがフォーム手続きを代行し、出所とライセンスは後ほど補完します。",
      "submit.channel.title": "投稿の入口",
      "submit.channel.github": "GitHub 投稿フォーム",
      "submit.channel.githubOn": "開通済み · おすすめ",
      "submit.channel.githubDesc":
        "画像をドラッグしてアップロードし、画像名・キャラ・クレジット表記の有無を入力します。表記する場合は名前が必須で、個人ホームページと説明は任意です。",
      "submit.channel.open": "フォームを開く",
      "submit.channel.feishu": "Feishu 投稿",
      "submit.channel.feishuTag": "準備中 · もうすぐ開通",
      "submit.channel.feishuDesc":
        "Feishu の投稿窓口は準備中です。今は上の GitHub 投稿フォームをご利用ください。",
      "submit.channel.soon": "もうすぐ開通",
      "submit.form.title": "クイック投稿",
      "submit.form.noticeA": "サイト内クイック投稿を開放しました",
      "submit.form.noticeB": " · 投稿は審査キューに入り、承認後にまとめて公開されます",
      "submit.form.files": "画像ファイル",
      "submit.form.filesHint":
        "PNG / JPG / GIF / WebP / APNG、1 枚 10 MB まで。元画像をアップロードし、チャット画面のスクショは避けてください。",
      "submit.form.name": "画像の名前",
      "submit.form.desc": "ひとこと説明",
      "submit.form.character": "キャラ",
      "submit.form.credit": "クレジット表記",
      "submit.form.anonymous": "表記しない",
      "submit.form.named": "表記する",
      "submit.form.creditName": "表記する名前",
      "submit.form.creditUrl": "個人ホームページ（任意）",
      "submit.form.creditHint": "名前をクリックすると個人ホームページが開きます。投稿者のクレジットと作品の出所は別です。原作者や出所は説明欄に記入してください。",
      "submit.form.err.credit": "クレジットを表記するか選択してください。",
      "submit.form.err.creditName": "表記する名前を120文字以内で入力してください。",
      "submit.form.err.creditUrl": "有効な http:// または https:// のホームページURLを入力してください。",
      "submit.form.metaHint":
        "タグ・作品タイプ・出所・ライセンスはメンテナーが審査時に補完します。出所やライセンスをご存じなら、上の説明欄に書いてください。",
      "submit.form.confirmLabel": "送信前の確認",
      "submit.form.confirmHint": "3 つすべてチェックしないと送信できません。",
      "submit.form.submit": "サイト内送信",
      "submit.form.select": "キャラを選択",
      "submit.form.submitting": "送信中…",
      "submit.form.success": "送信しました。ありがとうございます！承認後にまとめて公開されます。",
      "submit.form.turnstileHint": "送信の前に人機認証を完了してください。",
      "submit.form.err.fileRequired": "まず画像を選択してください。",
      "submit.form.err.fileCount": "一度に送信できる画像は 1 枚だけです。",
      "submit.form.err.fileType": "PNG / JPG / GIF / WebP / APNG のみ対応しています。",
      "submit.form.err.fileSize": "画像 1 枚は 10 MB 以下にしてください。",
      "submit.form.err.fileEmpty": "画像が空です。別のファイルを選択してください。",
      "submit.form.err.name": "画像の名前を 120 文字以内で入力してください。",
      "submit.form.err.character": "キャラを選択してください。",
      "submit.form.err.desc": "説明は 500 文字以内にしてください。",
      "submit.form.err.confirm": "先に 3 つの確認すべてにチェックしてください。",
      "submit.form.err.turnstile": "先に人機認証を完了してください。",
      "submit.form.err.tooLarge": "画像がサイズ上限を超えています。圧縮して再試行してください。",
      "submit.form.err.rejected":
        "投稿は受け付けられませんでした。しばらくして再試行するか、GitHub フォームをご利用ください。",
      "submit.form.err.busy": "送信が多すぎます：1 つの IP につき 1 時間に最大 10 回まで投稿できます。しばらくしてから再試行してください。",
      "submit.form.err.invalid": "入力内容が検証を通りませんでした。確認して再試行してください。",
      "submit.form.err.server":
        "送信に失敗しました。しばらくして再試行するか、GitHub フォームをご利用ください。",
      "submit.note1":
        "上の GitHub 投稿フォームも引き続き使えます。どちらの入口も同じ審査キューに入ります。",
      "submit.note2":
        "投稿はすぐには公開されません。メンテナーが画像を確認してタグ・分類・出所・ライセンスを補完し、承認後にまとめて公開します。その間に確認のご連絡をすることがあります。",

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
      "about.rights.unknown": "ライセンス状態不明：当サイトは画像の利用許諾を確認できていません。収録やダウンロードの提供は、転載・改変・商用利用の許諾を意味しません。",
      "about.rights.submitter": "投稿者の許諾：当サイトへの収録とダウンロード提供に対する許諾を記録しています。それ以外の用途は権利者に確認してください。",
      "about.rights.author": "原作者の許諾：許諾された用途は各作品のライセンス備考に従ってください。明記されていない用途は原作者に確認してください。",
      "about.rights.cc0": "CC0 パブリックドメイン：作品は CC0 として記録されています。利用前に元の宣言と第三者の権利を確認してください。",
      "about.rights.by": "CC BY 表示：原作者が示したクレジット条件に従ってください。バージョンは元の宣言に従い、当サイトでは推定しません。",
      "about.rights.byNc": "CC BY-NC 表示・非営利：クレジットと非営利の条件に従ってください。バージョンは元の宣言を確認し、商用利用には別途許諾を得てください。",
      "about.rights.acquireTitle": "画像の利用許諾を得る方法",
      "about.rights.acquireBody": "作品の出所の作者、リンク、ライセンス備考を確認し、公開プロフィールや元の投稿から権利者に連絡してください。作品 URL、用途、商用利用の有無を伝えてください。作者や出所が不明な場合は、下の署名・削除申請に作品 URL を添えて出所の確認を依頼できます。当サイトは不明な権利者に代わって許諾できません。",
      "about.privacy.li1a": "当サイトは ",
      "about.privacy.li1c":
        " を使って、ページ訪問・参照元・端末・パフォーマンスの集計データを収集します。読み込み問題の発見とページ改善のためであり、Google はファーストパーティの分析 Cookie を設定することがあります。",
      "about.privacy.li2a": "広告のパーソナライズ、Google Signals、広告ストレージはすべて無効化しています",
      "about.privacy.li2c":
        "。アカウントのプロファイリングは行わず、作品の閲覧数とダウンロードクリック数を集計して表示・並べ替えに使用します。",
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
      "about.group.a": "当サイトの QQ グループは「AAAA肥鱼批发市场」、グループ番号は ",
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
      "work.field.imageCredit": "画像クレジット",
      "work.field.copyright": "著作権表示",
      "work.acquireLicense": "利用許諾を得る方法",
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
      "license.removed": "削除済み",
      /* ---- v2 前台（左侧导航 / 作品浮层 / 社群 / 搜索） ---- */
      "v2.skip": "本文へスキップ",
      "v2.siteNav": "サイトナビゲーション",
      "v2.tagline": "AI娘二次創作ギャラリー",
      "v2.closeMenu": "メニューを閉じる",
      "v2.openMenu": "メニューを開く",
      "v2.nav.gallery": "ギャラリー",
      "v2.nav.works": "作品",
      "v2.nav.characters": "キャラ",
      "v2.nav.collections": "特集",
      "v2.nav.community": "コミュニティ",
      "v2.nav.events": "最新イベント",
      "v2.joinGroup": "グループに参加",
      "v2.aboutCopyright": "サイトについて・著作権",
      "v2.disclaimer": "非公式のファン整理プロジェクトです。画像の著作権は原作者に帰属します。",
      "v2.searchLabel": "作品を検索",
      "v2.searchPh": "作品・キャラ・別名・タグで検索",
      "v2.searchPh2": "作品名・キャラ・別名・タグ",
      "v2.search": "検索",
      "v2.keyword": "キーワード",
      "v2.entries": "サイトリンク",
      "v2.cta.title": "「AAAA肥鱼批发市场」に参加",
      "v2.ev.alt": "「国慶節おめでとう」のスタンプを持つクジラ娘",
      "v2.ev.kicker": "国慶節おめでとう 🐳",
      "v2.ev.title": "サイトのフロントデザイン募集",
      "v2.ev.text": "サイト「蓝色大肥鱼.com」の新しいデザインを募集します。AI・ツール・技術スタックは自由。手作りでも AI 任せでも OK。",
      "v2.ev.deadline": "締切",
      "v2.ev.deadlineV": "10月26日（月）23:59（北京時間）",
      "v2.ev.prize": "賞",
      "v2.ev.prizeV": "採用賞 88 元 · 人気賞 66 元",
      "v2.ev.more": "イベント詳細",
      "v2.ev.later": "あとで",
      "v2.cta.text": "作品の話、リクエスト、投稿、イベント参加など。QQ グループ番号",
      "v2.cta.more": "グループ紹介",
      "v2.worksSub": "全 {count} 件",
      "v2.pageN": "{n} ページ目",
      "v2.byType": "種類で絞り込み",
      "v2.sort": "並び替え",
      "v2.sort.latest": "新着",
      "v2.sort.random": "ランダム",
      "v2.type.meme": "ミーム",
      "v2.type.illustration": "イラスト",
      "v2.type.setting": "設定画",
      "v2.type.comic": "漫画",
      "v2.typeSub.meme": "スタンプネタ・チャット用画像・{count} 件",
      "v2.typeSub.illustration": "構図の整ったイラスト・{count} 件",
      "v2.typeSub.setting": "立ち絵・三面図・設定稿・{count} 件",
      "v2.typeSub.comic": "数コマの短い漫画・{count} 件",
      "v2.charsSub": "キャラを選ぶと、その作品が表示されます。",
      "v2.charTypeSub": "{kindId}・{count} 件",
      "v2.topicsSub": "管理人が選んだ作品のまとまりを、まとめて見られます。",
      "v2.topicsEmpty": "特集は準備中です。ひとまず",
      "v2.topicsEmpty2": "から見てみてください。",
      "v2.nextBatch": "次の作品",
      "v2.emptyA": "まだ作品がありません。",
      "v2.emptyB": "最初の一枚を投稿する",
      "v2.topic.authorTag": "作者の特集",
      "v2.topic.badge": "特集",
      "v2.topic.home": "作者のページ",
      "v2.topic.moreChannels": "ほかのチャンネル",
      "v2.topic.primary": "開く",
      "ev.lede": "新しいサイトを公開しましたが、まだ満足していません。みんなが考える「AI娘二次創作サイト」の姿を見てみたいです。",
      "ev.s1": "AI・ツール・技術スタックは自由。",
      "ev.s2": "手作りでも、AI にお願いしても OK。",
      "ev.s3": "ページが動いて、テーマに合っていれば大丈夫。",
      "ev.cta.repo": "イベントリポジトリで投稿",
      "ev.cta.soon": "リポジトリ準備中",
      "ev.cta.gallery": "投稿ギャラリー",
      "ev.cta.group": "グループで話す",
      "ev.h.what": "作るもの",
      "ev.what1": "サイト「蓝色大肥鱼.com」の新しいデザインを作ってください。トップ、作品一覧、キャラページなど何でも OK。1 ページだけでも、サイト全体を作り直しても構いません。",
      "ev.what2": "スタイルは完全に自由です。今の「方眼紙 + 手描きの線」はあくまで現状。サイバー、ピクセル、雑誌風、水彩、ミニマル、レトロゲーム……いろいろなスタイル大歓迎。サイトの用途（AI娘の二次創作を見て、探して、ダウンロードできること）に合っていれば OK です。",
      "ev.what3": "イベントリポジトリにはスターターキットがあります：作品とキャラのデータ、今の配色、そのまま AI に渡せるプロンプト。キットとサンプルは書き方の参考なので、真似する必要はありません。",
      "ev.h.how": "参加方法",
      "ev.how1a": "",
      "ev.how1b": "イベントリポジトリ",
      "ev.how1c": "を Fork する。",
      "ev.how2a": "",
      "ev.how2path": "submissions/あなたのGitHubユーザー名/",
      "ev.how2b": " にページを置く。入口は ",
      "ev.how2c": "。",
      "ev.how3": "PR を出す。ページが開けてテーマに合っていればマージされ、マージで参加完了です。",
      "ev.howNote": "マージ後も締切までは PR で自分のフォルダを更新できます。",
      "ev.h.time": "スケジュール（北京時間）",
      "ev.t1a": "本日から",
      "ev.t1b": "投稿受付、随時マージ",
      "ev.t2a": "10月26日（月）23:59",
      "ev.t2b": "締切",
      "ev.t3a": "締切後 〜 11月6日（金）23:59",
      "ev.t3b": "人気投票",
      "ev.t4a": "11月7日（土）",
      "ev.t4b": "結果発表",
      "ev.h.prize": "賞",
      "ev.p1": "🏆 採用賞",
      "ev.p1amt": "88 元",
      "ev.p1d": "あなたのデザインがサイトの新しいフロントになり、公開時にクレジットします。",
      "ev.p2": "🔥 人気賞",
      "ev.p2amt": "66 元",
      "ev.p2d": "投稿が 3 件集まったら設置。締切後、GitHub の投票 Issue で好きな作品に 👍（いくつでも）。最多得票の作品が受賞。",
      "ev.p3": "🎨 参加",
      "ev.p3amt": "展示",
      "ev.p3da": "マージされた作品はすべて",
      "ev.p3db": "ギャラリー",
      "ev.p3dc": "にずっと残ります。",
      "ev.prizeNote": "賞金は DeepSeek 開放プラットフォームの API クレジットで、現金でも受け取れます。両方の賞を同じ人が受賞できます。賞金はサイト管理人の自費で、DeepSeek 公式とは無関係です。",
      "ev.h.tips": "ヒント",
      "ev.tip1a": "ページはそのまま開ける必要があるので相対パスを使ってください：",
      "ev.tip1b": " と書き、",
      "ev.tip1c": " とは書かない。",
      "ev.tip2": "フレームワークを使う場合はビルド後のファイルを提出してください。",
      "ev.tip3": "ルールにないことはサイト管理人が判断します。",
      "ev.bye": "国慶節おめでとう、楽しんで 🐳 · ",
      "ev.byeGroup": "QQ グループ",
      "page.event.title": "国慶節・サイトのフロントデザイン募集 · 蓝色大肥鱼",
      "page.event.desc": "蓝色大肥鱼.com の新しいデザインを募集。AI・ツール・技術スタックは自由、動く静的ページを提出するだけ。10月26日締切、採用賞 88 元・人気賞 66 元（DeepSeek API クレジット）。",
      "v2.cm.elsewhere": "ほかの場所でも",
      "v2.cm.bili": "bilibili",
      "v2.cm.x": "X（Twitter）",
      "v2.cm.lede": "本サイトの QQ グループです。作品の話、リクエスト、不具合報告、ただ魚を見に来るだけでも歓迎です。",
      "v2.cm.how": "QQ でグループ番号を検索するか、QR コードを読み取って参加",
      "v2.cm.canTitle": "グループでできること",
      "v2.cm.c2": "そのまま投稿",
      "v2.cm.c2d": "ボットにメンションして「投稿 タイトル キャラ」と画像を送ると審査に入ります。",
      "v2.cm.c3": "イベントに参加",
      "v2.cm.c3d": "投稿募集やテーマ制作などのイベントはグループで告知します。",
      "v2.cm.c4": "不具合の報告",
      "v2.cm.c4d": "ページが開かない、画像の誤り、追加してほしいキャラなど、グループで一声どうぞ。",
      "v2.cm.rulesTitle": "グループのルール",
      "v2.cm.r1": "AI娘・二次創作・本サイトに関する話題のみ。",
      "v2.cm.r2": "他の人の作品を転載するときは出典を明記し、原作者を尊重してください。",
      "v2.cm.r3": "実在人物の写真、R18、連投は禁止です。",
      "v2.copyManual": "手動でコピーしてください",
      "v2.copyImg": "画像をコピー",
      "v2.copiedImg": "画像をコピーしました",
      "v2.copyImgFail": "非対応のブラウザです。長押しで保存してください",
      "v2.loading": "読み込み中",
      "v2.found": "{count} 件見つかりました",
      "v2.typeToSearch": "キーワードを入力して検索",
      "v2.work": "作品",
      "v2.allLoaded": "全 {count} 件を読み込みました",
      "v2.loadFail": "読み込みに失敗しました",
      "v2.retry": "再試行",
      "v2.openNext": "次のページを開く",
      "v2.prev": "前へ",
      "v2.next": "次へ",
      "v2.author": "作者",
      "v2.credit": "クレジット",
      "v2.source": "出所",
      "v2.takedown": "あなたの作品ですか？署名・削除を申請",
      "v2.loadComments": "コメントを表示",
      "v2.origin.issue": "GitHub Issue からの投稿",
      "v2.origin.qq": "QQ グループからの投稿",
      "v2.origin.site": "サイト内フォームからの投稿",
      "v2.homeTitle": "蓝色大肥鱼 - AI娘二次創作ギャラリー",
      "page.characters.title": "AI娘キャラ一覧 - キャラ別に二次創作を見る | 蓝色大肥鱼",
      "page.characters.desc": "DeepSeek娘、Claude娘、GPT娘、Qwen娘、GLM娘などキャラ別に AI娘の二次創作を見られます。",
      "page.community.title": "コミュニティに参加・AAAA肥鱼批发市场 | 蓝色大肥鱼",
      "page.community.desc": "蓝色大肥鱼の QQ グループ「AAAA肥鱼批发市场」。作品の話、投稿、イベント参加など。",
      "page.search.title": "AI娘二次創作を検索 | 蓝色大肥鱼",
      "page.search.desc": "作品名・キャラ・別名・タグで AI娘の二次創作を検索できます。"
    }
  };

  /* 各页 title / description（en / ja）按 body[data-i18n-page] 取用 */
  var PAGES = {
    index: true, category: true, topics: true, submit: true, about: true, characters: true, community: true, search: true,
    projects: true, changelog: true, notfound: true, event: true
  };

  // ---------- 语言检测与持久化 ----------
  function normalize(raw) {
    var text = String(raw || "").trim().toLowerCase().replace(/_/g, '-');
    if (text.indexOf("en") === 0) return "en";
    if (text.indexOf("ja") === 0 || text.indexOf("jp") === 0) return "ja";
    if (/^zh(?:-|$)/.test(text)) {
      if (text.indexOf('-hans') !== -1) return "zh";
      return /-(?:hant|tw|hk|mo)(?:-|$)/.test(text) ? "zh-Hant" : "zh";
    }
    return "";
  }

  function detect() {
    var pageLanguage = normalize(document.documentElement.getAttribute('data-site-lang'));
    if (pageLanguage) return pageLanguage;
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

  var bakedLanguage = normalize(document.documentElement.getAttribute('data-site-lang'));
  var initial = detect();
  var current = bakedLanguage || (initial === 'zh-Hant' ? 'zh' : initial);
  var originals = new WeakMap(); // element -> { text, attrs: { attr: value } }
  var converter, converterPromise, requested = initial, switchers = [], notice = '';
  Object.assign(DICT.en, window.ArchiveLabels && window.ArchiveLabels.en || {});
  Object.assign(DICT.ja, window.ArchiveLabels && window.ArchiveLabels.ja || {});
  var traditionalOverrides = {
    'd.specialThanks': '特別致謝',
    'about.license.p1b': '程式碼',
    'v2.nav.gallery': '圖庫',
    'v2.tagline': 'AI 娘二創圖庫'
  };

  function traditional(text) { return converter ? converter(String(text == null ? '' : text)) : text; }
  function loadTraditional() {
    if (converter) return Promise.resolve();
    if (window.OpenCC) { converter = window.OpenCC.Converter({ from: 'cn', to: 'twp' }); return Promise.resolve(); }
    if (converterPromise) return converterPromise;
    converterPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = '/vendor/opencc/cn2t-1.4.2.js';
      script.async = true;
      script.onload = function () {
        try { converter = window.OpenCC.Converter({ from: 'cn', to: 'twp' }); resolve(); }
        catch (err) { converterPromise = null; reject(err); }
      };
      script.onerror = function () { script.remove(); converterPromise = null; reject(new Error('Traditional Chinese resource failed to load')); };
      document.head.appendChild(script);
    });
    return converterPromise;
  }

  // ---------- 取词 ----------
  function interpolate(text, params) {
    if (!params) return String(text);
    return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      if (name === "kindId") {
        var kindId = String(params.kindId || "meme");
        return lookup("kind." + kindId, kindId);
      }
      if (params[name] === undefined) return whole;
      var value = String(params[name]);
      return current === 'zh-Hant' ? traditional(value) : value;
    });
  }

  function lookup(key, fallback) {
    if (current === 'zh-Hant') {
      if (Object.prototype.hasOwnProperty.call(traditionalOverrides, key)) return traditionalOverrides[key];
      if (key === 'alt.work' && !fallback) return '《{name}》{character}{kindId}，AI 娘二創作品';
      return traditional(fallback);
    }
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
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || "",
        ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || "",
        ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ""
      };
    }
    var original = cache[page];
    if (current === "zh" || current === 'zh-Hant') {
      var convert = current === 'zh-Hant' ? traditional : function (value) { return value; };
      document.title = convert(original.title);
      setMeta('meta[name="description"]', convert(original.description));
      setMeta('meta[property="og:title"]', convert(original.ogTitle));
      setMeta('meta[property="og:description"]', convert(original.ogDescription));
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
    // 独立 URL 的 HTML 已在构建期翻译；运行时只负责动态文案。
    if (bakedLanguage === current) return;
    var nodes = document.querySelectorAll("[data-i18n],[data-i18n-tpl],[data-i18n-attr]");
    for (var i = 0; i < nodes.length; i += 1) applyElement(nodes[i]);
    var htmlLang = "zh-CN";
    for (var j = 0; j < LANGS.length; j += 1) {
      if (LANGS[j].id === current) htmlLang = LANGS[j].htmlLang;
    }
    document.documentElement.lang = htmlLang;
    applyPageMeta();
  }

  // ---------- 同一套菜单分别挂到桌面顶栏、手机抽屉 ----------
  function injectSwitcher() {
    var hosts = document.querySelectorAll('[data-lang-host]');
    if (!hosts.length) { var nav = document.querySelector('.topnav'); hosts = nav ? [nav] : []; }
    [].forEach.call(hosts, function (host, index) {
      if (host.querySelector('.lang-switch')) return;
      var box = document.createElement('div');
      var hostName = host.getAttribute('data-lang-host');
      box.id = !hostName || hostName === 'top' ? 'lang-switch' : 'lang-switch-' + hostName;
      box.className = 'lang-switch';
      var trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'lang-trigger';
      trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
      var icon = document.createElement('span'); icon.textContent = '◎'; icon.setAttribute('aria-hidden', 'true');
      var label = document.createElement('span'); label.className = 'lang-current';
      var arrow = document.createElement('span'); arrow.className = 'lang-arrow'; arrow.textContent = '⌄'; arrow.setAttribute('aria-hidden', 'true');
      trigger.appendChild(icon); trigger.appendChild(label); trigger.appendChild(arrow);
      var menu = document.createElement('div');
      menu.id = 'language-menu-' + index; menu.className = 'lang-menu'; menu.hidden = true;
      menu.setAttribute('role', 'menu'); trigger.setAttribute('aria-controls', menu.id);
      var status = document.createElement('small'); status.className = 'lang-status'; status.setAttribute('role', 'status'); status.hidden = true;
      var items = LANGS.map(function (lang) {
        var item = document.createElement('button');
        item.type = 'button'; item.className = 'lang-option'; item.textContent = lang.title; item.lang = lang.htmlLang;
        item.tabIndex = -1; item.setAttribute('role', 'menuitemradio'); item.setAttribute('data-language', lang.id);
        item.addEventListener('click', function () { closeMenus(); trigger.focus(); setLang(lang.id); });
        menu.appendChild(item); return item;
      });
      var entry = { box: box, trigger: trigger, menu: menu, label: label, items: items, status: status };
      switchers.push(entry);
      function open(at) {
        closeMenus(); menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
        items[at == null ? Math.max(0, LANGS.findIndex(function (lang) { return lang.id === current; })) : at].focus();
      }
      trigger.addEventListener('click', function () { if (menu.hidden) open(); else closeMenus(); });
      box.addEventListener('keydown', function (event) {
        var i = items.indexOf(document.activeElement), key = event.key;
        if (key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); closeMenus(); trigger.focus(); }
        else if (key === 'ArrowDown' || key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation();
          if (menu.hidden) open(key === 'ArrowUp' ? items.length - 1 : 0);
          else items[(i + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        } else if (!menu.hidden && (key === 'Home' || key === 'End')) { event.preventDefault(); items[key === 'Home' ? 0 : items.length - 1].focus(); }
        else if (key === 'Tab' && !menu.hidden) { closeMenus(); trigger.focus(); }
      });
      box.addEventListener('focusout', function (event) { if (!box.contains(event.relatedTarget)) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); } });
      box.appendChild(trigger); box.appendChild(menu); box.appendChild(status); host.appendChild(box);
    });
    document.addEventListener('pointerdown', function (event) {
      if (!switchers.some(function (entry) { return entry.box.contains(event.target); })) closeMenus();
    });
    refreshSwitcher();
  }

  function closeMenus() {
    switchers.forEach(function (entry) { entry.menu.hidden = true; entry.trigger.setAttribute('aria-expanded', 'false'); });
  }

  function refreshSwitcher() {
    var lang = LANGS.find(function (entry) { return entry.id === current; });
    var busy = requested === 'zh-Hant' && !converter;
    switchers.forEach(function (entry) {
      entry.label.textContent = lang.label + (busy ? '…' : '');
      entry.trigger.setAttribute('aria-label', fmt('ui.switchLang', '切换语言') + '：' + lang.title);
      entry.trigger.setAttribute('aria-busy', String(busy));
      entry.menu.setAttribute('aria-label', fmt('ui.switchLang', '切换语言'));
      entry.items.forEach(function (item, i) { item.setAttribute('aria-checked', String(LANGS[i].id === current)); });
      entry.status.textContent = notice; entry.status.hidden = !notice;
    });
  }

  function commitLanguage(next, persist) {
    current = next;
    if (persist) { try { window.localStorage.setItem(STORAGE_KEY, current); } catch (err) { /* 忽略 */ } }
    apply();
    refreshSwitcher();
    document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { lang: current } }));
  }

  function setLang(id, persist) {
    var next = normalize(id);
    if (!next) return Promise.resolve();
    if (bakedLanguage && next !== current) {
      if (persist !== false) { try { window.localStorage.setItem(STORAGE_KEY, next); } catch (err) { /* 忽略 */ } }
      window.location.assign(languageUrl(next));
      return Promise.resolve();
    }
    requested = next; notice = ''; refreshSwitcher();
    if (next === current && (next !== 'zh-Hant' || converter)) return Promise.resolve();
    if (next !== 'zh-Hant' || converter) { commitLanguage(next, persist !== false); return Promise.resolve(); }
    return loadTraditional().then(function () {
      if (requested === next) commitLanguage(next, persist !== false);
    }).catch(function () {
      if (requested !== next) return;
      requested = current; notice = '繁體中文載入失敗，請重新選擇重試。'; refreshSwitcher();
    });
  }

  function languageUrl(id, href) {
    var next = normalize(id) || 'zh';
    var url = new URL(href || window.location.href, window.location.origin);
    var pathname = url.pathname.replace(/^\/(?:zh-hant|en|ja)(?=\/|$)/, '') || '/';
    if (pathname === '/index.html') pathname = '/';
    var prefix = next === 'zh' ? '' : next === 'zh-Hant' ? '/zh-hant' : '/' + next;
    url.searchParams.delete('lang');
    return prefix + pathname + url.search + url.hash;
  }

  // ---------- 对外接口 ----------
  window.SiteLang = {
    get current() { return current; },
    t: fmt,
    fmt: fmt,
    setLang: setLang,
    mountMenus: injectSwitcher,
    languageUrl: languageUrl,
    url: function (href) {
      if (!bakedLanguage) return href;
      var target = new URL(href, window.location.origin);
      if (target.origin !== window.location.origin && target.origin !== 'https://xn--pssy23gqgbz2d718b.com') return href;
      return languageUrl(current, href);
    }
  };

  function init() {
    var legacy = normalize(new URLSearchParams(window.location.search).get('lang'));
    if (bakedLanguage && legacy) { window.location.replace(languageUrl(legacy)); return; }
    apply();
    injectSwitcher();
    if (initial === 'zh-Hant') setLang(initial, false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
