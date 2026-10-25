// Interface reference only: no client implementation or executable examples.
export const openApiCopy = {
  apiTitle: ['开放数据接口', 'Open data API', '公開データAPI'],
  apiIntro: ['提供已公开图片作品的静态 JSON 数据，支持角色、作品类型、标签、人工专题和作者作品集。使用 GET 请求，无需账号或密钥，返回 UTF-8 JSON，接口版本为 v1。', 'Static JSON for published images, organized by character, artwork type, tag, curated collection and creator collection. Use GET without an account or API key. Responses are UTF-8 JSON; the API version is v1.', '公開中の画像作品を、キャラクター、作品の種類、タグ、手動編集のコレクション、作者別に取得できる静的JSONです。アカウントやAPIキーなしでGETを使用します。応答はUTF-8のJSON、バージョンはv1です。'],
  apiBase: ['接口根地址', 'API base URL', 'APIのベースURL'],
  apiEntry: ['接口入口', 'API index', 'APIの入口'],
  apiRoutesTitle: ['请求路径', 'Request paths', 'リクエストパス'],
  apiPathHeader: ['路径（相对于接口根地址）', 'Path, relative to the API base URL', 'ベースURLからの相対パス'],
  apiMeaningHeader: ['说明', 'Description', '説明'],
  apiRouteIndex: ['入口、版本摘要、各类数量和接口链接。', 'Entry points, revision, counts and endpoint links.', '入口、リビジョン、件数、各エンドポイントへのリンク。'],
  apiRouteManifest: ['完整作品清单，包含 ID、revision、详情地址和原图地址，用于增量同步。', 'Complete inventory with IDs, revisions, detail URLs and original image URLs for incremental sync.', '増分同期用の全作品一覧。ID、revision、詳細URL、元画像URLを含みます。'],
  apiRouteTaxonomy: ['角色、六种作品类型、标签、专题和作者作品集的完整分类目录。', 'Complete taxonomy of characters, six artwork types, tags, collections and creator collections.', 'キャラクター、6種類の作品分類、タグ、コレクション、作者別作品集の全一覧。'],
  apiRouteWorks: ['全部公开图片作品的完整元数据，适合一次拉取。', 'Full metadata for all published images, suitable for bulk retrieval.', '一括取得用の、公開画像作品すべての完全なメタデータ。'],
  apiRoutePages: ['分页作品数据；n 从 1 开始，每页 100 件，跟随 next 读取后续页。', 'Paginated works; n starts at 1, with 100 works per page. Follow next for subsequent pages.', '作品のページ分割一覧。nは1から始まり、1ページ100件です。次のページはnextから取得します。'],
  apiRouteWork: ['按稳定作品 ID 获取单件详情，返回 work 对象。', 'Retrieve one work by its stable ID; the response contains a work object.', '固定の作品IDから詳細を取得します。応答にはworkオブジェクトが含まれます。'],
  apiRouteLists: ['分别获取角色、类型、标签、专题、作者目录，返回 items 列表。', 'Separate character, type, tag, collection and creator directories, each with an items array.', 'キャラクター、分類、タグ、コレクション、作者の個別一覧。items配列を返します。'],
  apiRouteGroups: ['按对应目录中的 ID 获取作品索引和原图地址。专题保留人工编排顺序。', 'Retrieve work indexes and original image URLs using IDs from the matching directory. Curated collection order is preserved.', '各一覧にあるIDから、作品索引と元画像URLを取得します。手動編集コレクションの並び順を保持します。'],
  apiRouteIntersection: ['角色与作品类型的交集；例如 deepseek 与 meme。', 'Intersection of character and artwork type, such as deepseek and meme.', 'キャラクターと作品分類の共通部分。例：deepseekとmeme。'],
  apiParameters: ['花括号表示需要替换的值。作品使用 id，不使用 slug；其他 ID 从对应目录读取。标签 ID 为 tag- 加完整 SHA-256 摘要，请直接使用目录给出的 worksUrl。', 'Replace values in braces. Work requests use id, not slug; retrieve other IDs from their directories. Tag IDs are tag- followed by a full SHA-256 digest; use the worksUrl supplied by the tag directory.', '波括弧の部分を置き換えてください。作品にはslugではなくidを使用し、ほかのIDは対応する一覧から取得します。タグIDはtag-と完全なSHA-256です。タグ一覧のworksUrlをそのまま使用してください。'],
  apiFilters: ['所有路径都是预生成的静态文件。筛选条件写在路径中；查询参数不会触发筛选。更多条件可由调用方根据完整元数据自行组合。', 'Every path is a pregenerated static file. Filters belong in the path; query parameters do not filter results. Clients can combine additional conditions using the full metadata.', 'すべて事前生成された静的ファイルです。絞り込み条件はパスに指定し、クエリパラメーターでは絞り込めません。追加条件は完全なメタデータから呼び出し側で組み合わせてください。'],
  apiResponseTitle: ['返回格式与字段', 'Response format and fields', '応答形式とフィールド'],
  apiFieldHeader: ['字段', 'Field', 'フィールド'],
  apiEnvelope: ['所有响应均有 apiVersion: 1。目录、清单和列表使用 items 与 total；作品详情使用 work。分类作品索引条目含 id、name、revision、detailUrl、originalUrl；完整字段从 works.json 或单件详情获取。分页另有 page、pageSize、totalPages、previous、next，首尾无相邻页时为 null。', 'All responses include apiVersion: 1. Directories, inventories and lists use items and total; individual details use work. Group entries contain id, name, revision, detailUrl and originalUrl. Use works.json or individual details for full metadata. Pages also include page, pageSize, totalPages, previous and next; missing adjacent pages are null.', 'すべての応答にapiVersion: 1が含まれます。各一覧はitemsとtotal、作品詳細はworkを使用します。分類別索引の要約はid、name、revision、detailUrl、originalUrlを含みます。全フィールドはworks.jsonまたは作品詳細から取得します。ページ一覧にはpage、pageSize、totalPages、previous、nextも含まれ、前後のページがない場合はnullです。'],
  apiFieldIdentity: ['稳定作品 ID、详情页名称和标题；作品 ID 与 slug 发布后保持不变。', 'Stable work ID, detail-page slug and title. Published IDs and slugs remain unchanged.', '固定の作品ID、詳細ページのslug、作品名。公開後のIDとslugは変更しません。'],
  apiFieldClassification: ['角色、单选作品类型、人工专题和作者作品集的 ID；多角色作品会列出所有角色。', 'IDs for characters, the single artwork type, curated collections and creator collections. All characters appear for multi-character works.', 'キャラクター、単一の作品分類、手動編集コレクション、作者別作品集のID。複数キャラクターの作品は全員を含みます。'],
  apiFieldTags: ['原记录标签；类型 ID 为 meme、illustration、setting、comic、standing、other。', 'Tags from the original record. Type IDs: meme, illustration, setting, comic, standing and other.', '原記録のタグ。分類IDはmeme、illustration、setting、comic、standing、otherです。'],
  apiFieldImage: ['包含 originalUrl、thumbnailUrl、displayUrl、format、mimeType、animated、width、height、bytes、sha256。分别表示原图、缩略图、展示图地址、格式、MIME、动画标记、宽高、字节数及文件摘要；未知数值或摘要为 null。下载使用 image.originalUrl。', 'Contains originalUrl, thumbnailUrl, displayUrl, format, mimeType, animated, width, height, bytes and sha256: image URLs, format, MIME, animation flag, dimensions, byte size and file digest. Unknown numeric values or digests are null. Download from image.originalUrl.', 'originalUrl、thumbnailUrl、displayUrl、format、mimeType、animated、width、height、bytes、sha256を含みます。画像URL、形式、MIME、アニメーションフラグ、寸法、バイト数、ファイルハッシュを示します。不明な数値やハッシュはnullです。ダウンロードにはimage.originalUrlを使用します。'],
  apiFieldCredit: ['原作者、公开收录署名、来源链接和逐作品授权；收录署名不等于作者身份。', 'Original creator, public archive credit, source URL and per-work license. Archive credit does not establish authorship.', '原作者、公開クレジット、出典URL、作品ごとの利用許諾。収録クレジットは作者の証明ではありません。'],
  apiFieldRevision: ['作品元数据的 SHA-256 摘要，用于检测编辑；不同于 image.sha256 的图片文件摘要。', 'SHA-256 of the work metadata for detecting edits; distinct from the image file digest in image.sha256.', '編集検出用の作品メタデータのSHA-256。image.sha256の画像ファイルハッシュとは別です。'],
  apiFieldDates: ['收录与更新日期；缺失时为 null。增量同步以 revision 为准。', 'Publication and update dates, or null when unavailable. Use revision for incremental synchronization.', '収録日時と更新日時。不明な場合はnullです。増分同期にはrevisionを使用します。'],
  apiFieldLanguages: ['默认中文文本；已提供的英文和日文译文在 i18n.en 与 i18n.ja 中。', 'Default text is Chinese. Available English and Japanese translations are under i18n.en and i18n.ja.', '既定のテキストは中国語です。用意されている英語と日本語はi18n.enとi18n.jaにあります。'],
  apiSyncTitle: ['批量拉取与增量同步', 'Bulk retrieval and incremental sync', '一括取得と増分同期'],
  apiSync: ['首次可读取 works.json，或依次读取分页列表。之后保存 manifest.json 中的 ID 与 revision，只重新获取新增或摘要变化的作品；旧清单中存在、当前完整清单中消失的 ID 表示作品已下架。', 'For the first retrieval, read works.json or follow the paginated list. Save IDs and revisions from manifest.json; later retrieve only new or changed works. An ID present in the old inventory but absent from the current complete inventory indicates removal.', '初回はworks.jsonまたはページ分割一覧を取得します。manifest.jsonのIDとrevisionを保存し、次回は追加・変更された作品だけを取得してください。以前の一覧にあり、現在の完全な一覧から消えたIDは公開終了を示します。'],
  apiConsistency: ['读取前后核对 manifest.json 顶层 revision；如有变化，刷新清单后重试，避免跨发布版本混读。没有历史变更日志，也不使用时间查询参数。', 'Compare the top-level revision in manifest.json before and after retrieval. If it changes, refresh the inventory and retry to avoid mixing releases. There is no historical change log or timestamp query parameter.', '取得の前後でmanifest.json最上位のrevisionを確認してください。変化した場合は一覧を更新して再取得し、異なる公開版の混在を避けます。過去の変更履歴や時刻によるクエリはありません。'],
  apiErrors: ['存在的文件返回 200；不存在的 ID、页码或路径返回 404。响应内容随站点发布更新，客户端缓存可能短暂保留上一版本。', 'Existing files return 200. Unknown IDs, page numbers or paths return 404. Data updates with site releases; client caches may briefly retain the preceding version.', '存在するファイルは200、不明なID、ページ番号、パスは404を返します。データはサイト公開時に更新され、キャッシュに直前の版が一時的に残る場合があります。'],
  apiRights: ['原图地址沿用作品现有来源。请保留作者、来源和授权记录，具体使用范围以每件作品的 license 为准。', 'Original image URLs retain each work’s existing source. Preserve creator, source and license records; permitted use is defined by each work’s license.', '元画像URLは各作品の既存の保存先を使用します。作者、出典、利用許諾の記録を保持し、使用範囲は作品ごとのlicenseに従ってください。']
};

export const openApiRoutes = [
  ['index.json', 'apiRouteIndex'], ['manifest.json', 'apiRouteManifest'], ['taxonomy.json', 'apiRouteTaxonomy'],
  ['works.json', 'apiRouteWorks'], ['works/page/{n}.json', 'apiRoutePages'], ['works/{id}.json', 'apiRouteWork'],
  ['characters.json · categories.json · tags.json · topics.json · creators.json', 'apiRouteLists'],
  ['characters/{id}.json · categories/{id}.json · tags/{id}.json · topics/{id}.json · creators/{id}.json', 'apiRouteGroups'],
  ['characters/{characterId}/categories/{categoryId}.json', 'apiRouteIntersection']
];
export const openApiFields = [
  ['id · slug · name', 'apiFieldIdentity'], ['characterIds · categoryIds · topicIds · creatorIds', 'apiFieldClassification'],
  ['tags', 'apiFieldTags'], ['image', 'apiFieldImage'], ['author · attribution · source · license', 'apiFieldCredit'],
  ['revision', 'apiFieldRevision'], ['createdAt · updatedAt', 'apiFieldDates'], ['i18n', 'apiFieldLanguages']
];
