export const locales = ['zh', 'zh-hant', 'en', 'ja'] as const;
export type Locale = typeof locales[number];
export const localeNames = { zh: '简体中文', 'zh-hant': '繁體中文', en: 'English', ja: '日本語' };
export const htmlLang = { zh: 'zh-CN', 'zh-hant': 'zh-Hant', en: 'en', ja: 'ja' };
export const giscusLang = { ...htmlLang, 'zh-hant': 'zh-TW' };
let traditional: ((text: string) => string) | undefined;
let loadingTraditional: Promise<void> | undefined;

export async function prepareLocale(locale: Locale) {
  if (locale !== 'zh-hant' || traditional) return;
  loadingTraditional ??= import('opencc-js/cn2t').then(({ Converter }) => {
    const convert = Converter({ from: 'cn', to: 'twp' });
    traditional = (text) => convert(text).replaceAll('孃', '娘');
  });
  try { await loadingTraditional; } catch (error) { loadingTraditional = undefined; throw error; }
}

const phrases = {
  site: ['蓝色大肥鱼', 'DeepSeek Chan', 'DeepSeek Chan'],
  lead: ['查找 AI 娘表情包、插画和同人漫画。', 'Find AI Girl stickers, illustrations and fan comics.', 'AI 娘のスタンプ、イラスト、同人漫画を探せます。'],
  home: ['首页', 'Home', 'ホーム'], gallery: ['图库', 'Gallery', 'ギャラリー'],
  characters: ['角色', 'Characters', 'キャラクター'], topics: ['专题', 'Collections', '特集'],
  serials: ['连载漫画', 'Serial comics', '連載漫画'], videos: ['B 站视频', 'Bilibili videos', 'Bilibili 動画'],
  gifs: ['GIF 动图', 'GIFs', 'GIF アニメ'], categories: ['分类', 'Categories', 'カテゴリー'],
  search: ['搜索', 'Search', '検索'], searchLabel: ['搜索角色、作品或标签', 'Search characters, works or tags', 'キャラクター、作品、タグを検索'],
  clear: ['清除搜索', 'Clear search', '検索をクリア'], submit: ['站内投稿', 'Submit', '投稿する'],
  community: ['社群', 'Community', 'コミュニティ'], about: ['关于与版权', 'About & copyright', 'サイト情報と著作権'],
  links: ['友链墙', 'Friend links', 'リンク集'], projects: ['社区项目', 'Community projects', 'コミュニティプロジェクト'],
  changelog: ['更新日志', 'Changelog', '更新履歴'], events: ['站内活动', 'Events', 'イベント'],
  eventLive: ['活动进行中', 'Event live', 'イベント開催中'],
  eventPreview: ['模板预览', 'Template preview', 'テンプレートのプレビュー'],
  eventDetails: ['查看活动详情', 'View event details', 'イベントの詳細を見る'],
  eventLater: ['稍后再看', 'Maybe later', '後で見る'],
  eventReminder: ['本次活动仅在首次访问时提醒一次', 'This event reminder appears once, on your first visit.', 'このイベントのお知らせは初回アクセス時に一度だけ表示されます。'],
  creators: ['创作者', 'Creators', 'クリエイター'], creator: ['作者', 'Creator', '作者'],
  openApi: ['开放接口', 'Open data API', '公開データAPI'], aiIndex: ['AI 索引', 'AI index', 'AI インデックス'],
  footerNav: ['页脚导航', 'Footer navigation', 'フッターのナビゲーション'],
  weekly: ['AI 娘周刊', 'AI Girl Weekly', 'AI娘ウィークリー'],
  siteRepo: ['站点源码 GitHub', 'Site source on GitHub', 'サイトのソースコード（GitHub）'],
  contentRepo: ['内容与投稿仓库', 'Content & submissions repository', 'コンテンツと投稿リポジトリ'],
  repoHeading: ['GitHub 开源仓库', 'Open-source repositories on GitHub', 'GitHubのオープンソースリポジトリ'],
  archiveCredit: ['非官方同人整理项目 · 作品版权归原作者所有', 'Unofficial fan archive · Copyright belongs to the original creators', '非公式ファンアーカイブ · 著作権は原作者に帰属します'],
  language: ['语言', 'Language', '言語'], dark: ['暗色模式', 'Dark mode', 'ダークモード'],
  more: ['更多页面', 'More pages', 'その他のページ'], nav: ['主导航', 'Main navigation', 'メインメニュー'],
  openNav: ['打开导航', 'Open navigation', 'メニューを開く'], close: ['关闭', 'Close', '閉じる'],
  skip: ['跳到主要内容', 'Skip to content', '本文に移動'], crumbs: ['当前位置', 'Breadcrumbs', 'パンくずリスト'],
  all: ['全部', 'All', 'すべて'], meme: ['梗图', 'Memes', 'ミーム'], illustration: ['插画', 'Illustrations', 'イラスト'],
  setting: ['设定图', 'Design sheets', '設定画'], comic: ['漫画', 'Comics', '漫画'], standing: ['立绘', 'Character art', '立ち絵'], other: ['其他', 'Other', 'その他'],
  count: ['件作品', 'works', '件の作品'], entries: ['项', 'items', '件'], sort: ['排序', 'Sort', '並べ替え'],
  nonAiWorks: ['非AI创作', 'Non-AI works', '非AI作品'],
  nonAiHelp: ['非 AI 创作仅收录手绘等非 AI 生成的相关二创，依据作者或投稿者说明标注；未标注不代表使用了 AI。', 'Includes hand-drawn and other non-AI-generated fan works, as identified by their creators or submitters. Unlabeled works may also be non-AI.', '手描きなどAI生成を使わない二次創作を、作者や投稿者の説明に基づいて掲載します。未表示の作品も非AIの場合があります。'],
  clearSelection: ['清空', 'Clear', 'クリア'],
  latest: ['最新发布', 'Newest', '新着順'], oldest: ['最早发布', 'Oldest', '古い順'],
  downloads: ['下载量', 'Most downloaded', 'ダウンロード順'], popular: ['浏览量', 'Most viewed', '閲覧数順'],
  filter: ['应用筛选', 'Apply filters', '絞り込む'], spotlight: ['最新推荐', 'Latest pick', '新着おすすめ'],
  featured: ['精选专题', 'Featured collection', '注目の特集'], latestWorks: ['最新作品', 'Latest works', '新着作品'],
  featuredSerial: ['热门连载', 'Featured serial', '注目の連載'], quickBrowse: ['快速浏览', 'Quick browse', 'クイックリンク'],
  longImage: ['长图', 'Tall image', '縦長画像'],
  load: ['加载更多', 'Load more', 'もっと見る'], loading: ['正在加载…', 'Loading…', '読み込み中…'],
  loaded: ['已加载更多作品', 'More works loaded', '作品を追加しました'],
  empty: ['暂无内容', 'No items yet', '掲載内容はまだありません'],
  emptySearch: ['没有匹配的作品', 'No matching works', '一致する作品はありません'],
  unavailable: ['暂时无法读取内容，请稍后重试。', 'Content is temporarily unavailable. Try again shortly.', '一時的に読み込めません。時間をおいて再試行してください。'],
  notFound: ['找不到此页面', 'Page not found', 'ページが見つかりません'],
  download: ['下载原图', 'Download original', '原画をダウンロード'], downloadFail: ['无法下载，请打开原图后重试。', 'Download failed. Open the original and try again.', 'ダウンロードできません。原画を開いて再試行してください。'],
  original: ['打开原图', 'Open original', '原画を開く'], detail: ['作品详情', 'Work details', '作品詳細'], preview: ['看图台', 'Image viewer', '画像ビューアー'],
  prev: ['上一张', 'Previous image', '前の画像'], next: ['下一张', 'Next image', '次の画像'],
  zoomIn: ['放大', 'Zoom in', '拡大'], zoomOut: ['缩小', 'Zoom out', '縮小'], reset: ['重置缩放', 'Reset zoom', '倍率を戻す'],
  source: ['来源', 'Source', '出典'], license: ['授权', 'License', 'ライセンス'], credit: ['署名', 'Credit', 'クレジット'],
  unspecified: ['暂未标注', 'Unspecified', '未記載'], comments: ['评论', 'Comments', 'コメント'],
  originWeb: ['站内投稿', 'Site submission', 'サイトからの投稿'], originQq: ['QQ 群投稿', 'QQ group submission', 'QQ グループからの投稿'],
  originGithub: ['GitHub 投稿', 'GitHub submission', 'GitHub からの投稿'], originArchive: ['早期整理档案', 'Early archive', '初期アーカイブ'],
  originEditor: ['站长收录', 'Editor’s selection', '運営による収録'], originWebFound: ['网络收录', 'Found online', 'インターネットで収録'],
  originOwn: ['原创作品', 'Original creation', 'オリジナル作品'], originAuthor: ['作者投稿', 'Submitted by the creator', '作者本人の投稿'],
  originCommunity: ['社群创作', 'Community creation', 'コミュニティ制作'], originSubmission: ['投稿收录', 'Submitted work', '投稿作品'],
  licenseAuthor: ['原作者授权', 'Authorized by the creator', '原作者の許諾'], licenseSubmitter: ['投稿者授权', 'Authorized by the contributor', '投稿者の許諾'],
  recommendations: ['相关作品', 'Related works', '関連作品'], aliases: ['别名', 'Aliases', '別名'],
  totalWorks: ['作品总数', 'Total works', '作品総数'], categoryBreakdown: ['按类型查看', 'Browse by category', 'カテゴリー別に見る'],
  pageCount: ['页', 'pages', 'ページ'],
  introDeepseek: ['DeepSeek 娘是社区以 DeepSeek 为原型创作的拟人角色。这里收录她的表情包、插画、设定图与漫画。', 'DeepSeek Chan is the community’s personification of DeepSeek. The archive collects her stickers, illustrations, design sheets and comics.', 'DeepSeek Chanは、DeepSeek をもとにコミュニティが創作した擬人化キャラクターです。スタンプ、イラスト、設定画、漫画を収録しています。'],
  introGpt: ['GPT 娘是社区围绕 GPT 与 ChatGPT 创作的拟人角色。', 'GPT Chan is a fan personification of GPT and ChatGPT.', 'GPT Chanは、GPT や ChatGPT をもとにしたファンの擬人化キャラクターです。'],
  introClaude: ['Claude 娘是社区创作者围绕 Claude 创作的拟人角色。', 'Claude Chan is a community-created personification of Claude.', 'Claude Chanは、Claude をもとにコミュニティが創作した擬人化キャラクターです。'],
  introGlm: ['GLM 娘是与 GLM、智谱相关的社区拟人角色。', 'GLM Chan is a fan personification associated with GLM and Zhipu.', 'GLM Chanは、GLM や Zhipu に関連するファンの擬人化キャラクターです。'],
  introGemini: ['Gemini 娘是社区围绕 Gemini 创作的拟人角色。', 'Gemini Chan is a fan personification of Gemini.', 'Gemini Chanは、Gemini をもとにしたファンの擬人化キャラクターです。'],
  introKimi: ['Kimi 娘是社区围绕 Kimi 创作的拟人角色。', 'Kimi Chan is a community fan personification of Kimi.', 'Kimi Chanは、Kimi をもとにコミュニティが創作した擬人化キャラクターです。'],
  startRead: ['开始阅读', 'Start reading', '読む'], previousPage: ['上一页', 'Previous page', '前のページ'], nextPage: ['下一页', 'Next page', '次のページ'],
  originalPage: ['原稿页码', 'Original page', '原稿ページ'], missing: ['这一原稿页尚未收录。', 'This original page is not in the archive yet.', 'この原稿ページはまだ収録されていません。'],
  zip: ['下载专题 ZIP', 'Download collection ZIP', '特集を ZIP でダウンロード'], cancel: ['取消', 'Cancel', 'キャンセル'],
  zipCollect: ['正在收集原图链接…', 'Collecting original links…', '原画リンクを取得中…'], zipReady: ['ZIP 已生成', 'ZIP ready', 'ZIP を作成しました'], zipCancelled: ['已取消 ZIP 下载', 'ZIP download cancelled', 'ZIP のダウンロードを中止しました'],
  single: ['单图投稿', 'Single image', '画像を投稿'], bulk: ['ZIP 批量投稿', 'Upload ZIP', 'ZIP を一括投稿'], register: ['B 站作者登记', 'Register a Bilibili creator', 'Bilibili 投稿者を登録'],
  files: ['选择图片', 'Select image', '画像を選択'], archive: ['选择 ZIP', 'Select ZIP', 'ZIP を選択'],
  fileHint: ['PNG、JPEG、GIF、WebP 或 APNG，单张最多 10 MiB。', 'PNG, JPEG, GIF, WebP or APNG, up to 10 MiB.', 'PNG、JPEG、GIF、WebP、APNG。最大 10 MiB。'],
  zipHint: ['ZIP 最多 32 MiB、100 张图片。包内单张最多 16 MiB，解压总量最多 64 MiB。', 'ZIP up to 32 MiB and 100 images. Each image may be up to 16 MiB, with a 64 MiB uncompressed total.', 'ZIP は最大 32 MiB、画像は 100 枚まで。1 枚は最大 16 MiB、展開後は合計 64 MiB まで。'],
  name: ['作品名称', 'Work title', '作品名'], description: ['说明', 'Description', '説明'],
  mainCharacter: ['主要角色', 'Primary character', 'メインキャラクター'], extraCharacters: ['其他出场角色', 'Other characters', 'その他の登場人物'],
  choose: ['请选择', 'Select an option', '選択してください'], category: ['作品类型', 'Work category', '作品の種類'],
  nonAi: ['非 AI 生成', 'Made without AI', 'AI 未使用'], creditName: ['投稿署名（选填）', 'Contributor name (optional)', '投稿者名（任意）'],
  creditUrl: ['投稿者主页（选填）', 'Contributor homepage (optional)', '投稿者のサイト（任意）'],
  rights: ['我有权投稿，或已获得原作者许可。', 'I have the right to submit this work or permission from its creator.', '投稿する権利があるか、原作者の許可を得ています。'],
  review: ['同意作品接受审核，并按版权要求更正或下架。', 'I agree to review and to corrections or removal for copyright claims.', '審査と著作権に基づく修正・削除に同意します。'],
  fan: ['我了解本站是同人项目，著作权归原作者。', 'I understand this is a fan project and copyright stays with the original creator.', '当サイトはファン活動であり、著作権は原作者に帰属することを理解しています。'],
  homepage: ['B 站主页链接或 UID', 'Bilibili profile URL or UID', 'Bilibili プロフィール URL または UID'],
  creatorIntro: ['作者简介（选填）', 'Creator introduction (optional)', '投稿者の紹介（任意）'],
  verify: ['请完成人机验证。', 'Complete the verification.', '人間であることを確認してください。'],
  sending: ['正在提交…', 'Submitting…', '送信中…'], success: ['已接收，审核通过后将公开。', 'Received. Approved submissions will be published.', '受け付けました。審査通過後に公開します。'],
  invalid: ['提交未通过校验，请检查内容后重试。', 'Check the submission fields and try again.', '入力内容を確認してもう一度お試しください。'],
  limited: ['提交过于频繁，请稍后再试。', 'Too many submissions. Try again later.', '送信回数が上限に達しました。時間をおいてお試しください。'],
  duplicate: ['这项内容已有登记或投稿记录。', 'This content has already been registered or submitted.', 'すでに登録または投稿されています。'],
  submitUnavailable: ['站内投稿暂不可用，可通过 GitHub 投稿。', 'Web submissions are temporarily unavailable. You can submit through GitHub.', 'サイトでの投稿は一時停止中です。GitHub から投稿できます。'],
  submitFail: ['提交失败，请稍后重试。', 'Submission failed. Try again shortly.', '送信に失敗しました。時間をおいてお試しください。'],
  tooLarge: ['文件超出大小限制。', 'The file exceeds the size limit.', 'ファイルのサイズが上限を超えています。'],
  apiCopy: ['通过公开只读 API 查询作品、分类、角色和专题。图片字段提供 R2 原图、缩略图和展示图直链。', 'Use the public read-only API for works, categories, characters and collections. Image fields link directly to R2 originals, thumbnails and display assets.', '公開読み取り API で作品、カテゴリー、キャラクター、特集を取得できます。画像フィールドは R2 の原画・サムネイル・表示用画像への直リンクです。'],
  aboutCopy: ['蓝色大肥鱼是 AI 娘同人作品档案。作品页保留来源、署名与授权信息，著作权归原作者。', 'DeepSeek Chan is an AI Girl fanwork archive. Work pages show source, credit and license information. Copyright stays with each creator.', 'DeepSeek Chanは AI 娘のファン作品アーカイブです。作品ページに出典・クレジット・ライセンスを掲載し、著作権は原作者に帰属します。'],
  feedback: ['问题反馈', 'Report an issue', '問題を報告'], corrections: ['署名、来源或下架申请', 'Credit, source or takedown requests', 'クレジット・出典の訂正や削除申請'],
  videoExternal: ['在 B 站观看', 'Watch on Bilibili', 'Bilibili で見る'], archiveEvents: ['活动归档', 'Past events', '過去のイベント'],
  eventExhibition: ['征集作品展', 'Submissions exhibition', '応募作品展示'],
  release: ['蓝色大肥鱼 v2', 'DeepSeek Chan v2', 'DeepSeek Chan v2'],
  releaseCopy: ['图库采用服务端筛选与分页。作品继续使用原有地址和评论串，图片通过公开媒体域名下载。', 'The gallery now uses server-side filters and pagination. Work addresses and discussion threads carry over, and images download from the public media domain.', 'ギャラリーの絞り込みとページ送りをサーバー側で処理します。作品 URL とコメント欄を引き継ぎ、画像は公開メディアドメインから取得できます。'],
} as const;

export type Phrase = keyof typeof phrases;
export function tr(locale: Locale, key: Phrase): string {
  const [zh, en, ja] = phrases[key];
  if (locale === 'zh-hant') return traditional?.(zh) ?? zh;
  return locale === 'en' ? en : locale === 'ja' ? ja : zh;
}

export function localizedText(locale: Locale, text?: string | null, translated?: string | null) {
  if (locale === 'zh-hant') return traditional?.(text ?? '') ?? text ?? '';
  return (locale !== 'zh' && translated?.trim()) || text || '';
}

export function copy(locale: Locale, values: readonly string[]) {
  return localizedText(locale, values[0], locale === 'en' ? values[1] : values[2]);
}

export function parseLocale(pathname: string): { locale: Locale; path: string } {
  const path = pathname.replace(/\/+$/, '') || '/';
  const first = path.split('/')[1];
  if (first === 'zh-hant' || first === 'en' || first === 'ja') {
    return { locale: first, path: path.slice(first.length + 1) || '/' };
  }
  return { locale: 'zh', path };
}

export function localePath(locale: Locale, path: string, search = '') {
  return `${locale === 'zh' ? path : `/${locale}${path === '/' ? '/' : path}`}${search}`;
}
