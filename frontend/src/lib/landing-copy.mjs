// Search landing copy uses the same published snapshot as the archive.
export function homeMeta(count, locale = 'zh') {
  const copy = {
    zh: ['蓝色大肥鱼（大肥鱼）— DeepSeek娘表情包与 AI 娘二创图库', `蓝色大肥鱼（大肥鱼、鲸鱼娘）是 DeepSeek娘的社区昵称。本站是非官方同人档案，收录 ${count} 件 AI 娘表情包、梗图、插画与漫画，可按角色找图、下载原图并查看来源与授权。`],
    'zh-Hant': ['藍色大肥魚（大肥魚）— DeepSeek娘表情包與 AI 娘二創圖庫', `藍色大肥魚（大肥魚、鯨魚娘）是 DeepSeek娘的社群暱稱。本站是非官方同人檔案，收錄 ${count} 件 AI 娘表情包、梗圖、插畫與漫畫，可依角色找圖、下載原圖並查看來源與授權。`],
    en: ['蓝色大肥鱼 DeepSeek Chan — DeepSeek Chan Memes & AI Girl Fan Art Archive', `DeepSeek Chan (蓝色大肥鱼) is an unofficial community fan art archive. Explore ${count} archived AI girl memes, stickers, illustrations and comics, with original downloads, sources and license information.`],
    ja: ['藍色大肥魚 — DeepSeekちゃんのスタンプ・AI娘ファンアート集', `藍色大肥魚はDeepSeekちゃんのコミュニティでの愛称です。${count}件のAIキャラクターのスタンプ、ミーム、イラスト、漫画を収録する非公式アーカイブ。元画像、出典、利用許諾を確認できます。`],
  };
  const [title, description] = copy[locale] || copy.zh;
  return { title, description };
}

// Search phrases requested in the SEO issues; Chinese uses the source alias verbatim.
export const characterSearchAliases = {
  gpt: ['GPT龙娘', 'GPT Dragon Girl', 'GPTドラゴン娘'],
  claude: ['Claude娘化', 'Claude personification', 'Claudeの擬人化'],
  deepseek: ['鲸鱼娘', 'whale girl', 'クジラの少女'],
};

export const characterIntros = {
  deepseek: ['DeepSeek娘是围绕 DeepSeek 创作的社区拟人化角色，也叫蓝色大肥鱼、大肥鱼、鲸鱼娘或哦鲸鲸。这里整理她的表情包、梗图、插画与漫画，可按作品类型找图并下载原图。不同作者的角色设计与作品来源，以各作品详情为准。', 'DeepSeek Chan is a community personification of DeepSeek, also known as the whale girl or Blue Dafeiyu. Browse her memes, reaction images, illustrations and comics, and download the originals. Check each work for its creator’s design and original source.', 'DeepSeekちゃんは、DeepSeekをもとにしたコミュニティの擬人化キャラクターで、クジラの少女や藍色大肥魚とも呼ばれます。スタンプ、ミーム、イラスト、漫画を種類別に探し、元画像をダウンロードできます。作者ごとのデザインと出典は各作品の詳細をご確認ください。'],
  gpt: ['GPT娘是社区对 GPT、ChatGPT 的拟人化二创称呼。这个档案集中展示已收录的 GPT娘作品；多角色同框作品也会出现在相应角色档案中，来源与设定以作品详情为准。', 'GPT Chan is a fan personification of GPT and ChatGPT. Browse the archived works, including crossovers with other AI characters, and check each work for its original design and source.', 'GPTちゃんは、GPTやChatGPTを擬人化したファンキャラクターです。他のAIキャラクターとの共演を含む収録作品を探し、各作品のデザインと出典を確認できます。'],
  claude: ['Claude娘是社区创作者围绕 Claude 创作的拟人化角色。这里可以按表情包、插画等实际收录类型找图，也可以通过标签和相关合集继续阅读她与其他 AI 娘的二创故事。', 'Claude Chan is a community-created personification of Claude. Browse the available artwork types and follow tags and related collections to discover her fan stories and AI-character crossovers.', 'Claudeちゃんは、Claudeをもとにコミュニティが創作した擬人化キャラクターです。作品の種類、タグ、関連コレクションから二次創作や共演作品を探せます。'],
  glm: ['GLM娘也可通过 GLM、智谱这些名称检索。这里汇集档案中与她相关的社区作品，按实际收录的图片类型浏览，并在详情页核对署名、原图和使用许可。', 'GLM Chan is a fan personification associated with GLM and Zhipu. Explore the archived artwork types and open each work to check artist credits, the original image and usage permissions.', 'GLMちゃんは、GLMやZhipuに関連するファンによる擬人化キャラクターです。収録済みの種類から作品を探し、クレジット、元画像、利用許諾を確認できます。'],
  gemini: ['Gemini娘是围绕 Gemini 创作的社区拟人化形象。想找聊天反应和台词梗图，可以先进入表情包与梗图栏；也可在这里查看档案实际收录的其他类型和不同作者的设计。', 'Gemini Chan is a fan personification of Gemini. Start with memes and reaction images for dialogue and chat expressions, or explore other archived artwork types and designs by different creators.', 'Geminiちゃんは、Geminiを擬人化したファンキャラクターです。会話のリアクションやセリフはネタ画像から探せます。ほかの種類や作者ごとのデザインもご覧ください。'],
  kimi: ['Kimi娘是社区对 Kimi 的拟人化二创称呼。这个角色档案保留作品的原始署名与来源，可按类型、标签和最近收录的作品逐步浏览，寻找不同的表情和构图。', 'Kimi Chan is a community fan personification of Kimi. Browse by artwork type, tags and recent additions to explore different expressions and compositions, with original attribution and sources retained.', 'Kimiちゃんは、Kimiを擬人化したファンキャラクターです。作品の種類、タグ、最近の収録から表情や構図を探せます。各作品のクレジットと出典も掲載しています。'],
};

export const guides = [
  { id: 'gemini-memes', character: 'gemini', type: 'meme',
    name: ['Gemini 梗图与表情包', 'Gemini Chan Memes & Reaction Images', 'Geminiちゃんのミーム・スタンプ'],
    summary: ['从 Gemini娘的聊天反应、台词和情绪标签找梗图。打开作品详情查看完整图片、原始来源和授权，再挑选适合当前对话的表情。', 'Find Gemini Chan memes through chat reactions, dialogue and mood tags. Open a work for its full image, original source and license information before choosing a reaction for your conversation.', 'Geminiちゃんの会話のリアクション、セリフ、気分のタグからネタ画像を探せます。作品の詳細で全体の画像、出典、利用許諾を確認してからお選びください。'] },
  { id: 'deepseek-whale', character: 'deepseek',
    name: ['DeepSeek 鲸鱼娘·哦鲸鲸', 'DeepSeek Chan: The Whale Girl', 'DeepSeekちゃん・クジラの少女'],
    summary: ['鲸鱼娘、蓝色大肥鱼、大肥鱼和哦鲸鲸，都是查找 DeepSeek娘二创的线索。这些称呼不代表唯一设定；从角色档案与作品来源了解不同创作者的鲸鱼娘形象。', 'The whale girl and Blue Dafeiyu are community names used for DeepSeek Chan fan art. These names do not define a single official design. Explore the character archive and original sources to discover different interpretations.', 'クジラの少女や藍色大肥魚は、DeepSeekちゃんの二次創作に使われる愛称です。統一された公式設定ではありません。キャラクターのアーカイブと出典から、作者ごとの解釈を探せます。'] },
  { id: 'deepseek-girl', character: 'deepseek',
    name: ['DeepSeek girl：AI 娘同人图导览', 'DeepSeek Girl Fan Art', 'DeepSeek girl・ファンアートガイド'],
    summary: ['搜索 DeepSeek girl 时，可以从这里进入 DeepSeek娘的表情包、插画、设定图与漫画。本站提供英文作品说明、来源和授权信息；每个角色形象都是社区二创，请以原作品为准。', 'Looking for DeepSeek girl fan art? Explore DeepSeek Chan memes, illustrations, character designs and comics with English descriptions, artist credits and source links. This is an unofficial community archive; check each work for its design and usage permissions.', 'DeepSeek girlのファンアートを探す方へ。DeepSeekちゃんのミーム、イラスト、設定画、漫画を、作品説明、クレジット、出典とともにご覧いただけます。非公式の二次創作アーカイブです。'] },
];
export const guidePath = guide => '/topics/' + guide.id + '.html';
export const localizedCopy = (values, locale) => values[locale === 'en' ? 1 : locale === 'ja' ? 2 : 0];
