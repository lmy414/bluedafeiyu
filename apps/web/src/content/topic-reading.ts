export const topicReading: Partial<Record<string, { heading: string[]; note: string[]; name?: string[]; summary?: string[]; works?: string[] }>> = {
  maojing: {
    heading: ['按投稿者阅读猫鲸的不同表情', 'Explore Maojing’s expressions by contributor', '投稿者ごとに猫鯨の表情を読む'],
    note: ['这个作者作品集保留现有收录顺序。先看头像与表情变化，再对照每张作品的说明；想找特定情绪时，可以在合集内筛选梗图或搜索相关标签。', 'The creator collection follows its original archive order. Compare portraits and expressions with the notes for each work. Search related tags or browse memes for a particular mood.', '作者作品集は収録順のままです。顔や表情の変化を見ながら各作品の説明を読み、気分に合う画像は関連タグやミームから探せます。'],
  },
  'morning-night': {
    name: ['早安与晚安', 'Good morning and good night', 'おはようとおやすみ'],
    summary: ['从早上好到钻进被窝，把一天的问候交给小肥鱼。', 'Let the little whale girl take you from good morning to bedtime.', 'おはようから布団に入るまで、一日の挨拶をクジラの少女に。'],
    heading: ['把一天的问候串起来', 'Follow a day of greetings', '一日の挨拶をつなぐ'],
    note: ['这一组选图从“早上好”走到晚安与睡前陪伴。适合先按一天的时间顺序阅读，再挑选符合当下心情的问候图。', 'Follow greetings from the morning through bedtime, then pick an image that fits your mood.', '朝の挨拶からおやすみまで、時間の流れに沿って読み、今の気分に合う挨拶を選べます。'],
    works: ['sticker_c66dbe21a33c0da459a8b93f', 'sticker_4cefe5be4c07cf9d96d67864', 'sticker_8a30fe16ad1604f13bca8dbc', 'sticker_742d9817fba02c62c945e30d', 'sticker_issue_32_051', 'sticker_issue_32_050'],
  },
  'working-fish': {
    name: ['今天也在努力工作', 'Working hard again today', '今日もお仕事を頑張る'],
    summary: ['认真开工、排查问题，忙完一天再歇一会儿。', 'Start the day, troubleshoot and take a break when the work is done.', '仕事を始めて問題を調べ、一日の終わりにひと休み。'],
    heading: ['从开工、摸鱼到收工', 'From starting work to clocking out', '仕事始め、息抜き、そして退勤'],
    note: ['这一组选图围绕电脑前的工作、代码排查和休息展开。漫画适合连着看，单张梗图可以从作品说明中寻找对应的工作场景。', 'These works cover working at a computer, debugging and taking breaks. Read the comics in sequence or check individual meme descriptions for the work situation they depict.', 'パソコンでの作業、デバッグ、休憩がテーマです。漫画は続けて読み、1枚のミームは作品説明から場面を探せます。'],
    works: ['sticker_eab7f6d525b40368d9abeefb', 'sticker_bf_160', 'sticker_4c56585b0d97e195cd66bd21', 'sticker_098544e894938a22d475b196', 'sticker_d05d92b2d62c81958d54aaea', 'sticker_16c1cd524cbd804b51d625b6'],
  },
  'soft-moments': {
    name: ['给你一点小小的安慰', 'A little comfort for you', 'ちょっとした慰めをあなたに'],
    summary: ['摸摸头、说晚安，留几张温柔的图给想关心的人。', 'A few gentle images, head pats and good-night wishes to share with someone you care about.', '頭をなでたり、おやすみを伝えたり。大切な人に贈りたい優しい画像。'],
    heading: ['先读说明，再挑一张温柔的图', 'Read the notes and pick a gentle image', '説明を読んで、優しい画像を選ぶ'],
    note: ['摸摸头、安慰与睡前问候构成这组选图的线索。相似的表情可能有不同台词，进入详情可以同时查看原图和原始说明。', 'Head pats, comforting gestures and bedtime greetings tie these works together. Similar expressions can have different dialogue. The detail page preserves both the original and its notes.', '頭をなでるしぐさ、励まし、寝る前の挨拶がテーマです。似た表情でもセリフはさまざま。詳細から元画像と説明を確認できます。'],
    works: ['sticker_issue_32_048', 'sticker_bf_116', 'sticker_16c1cd524cbd804b51d625b6', 'sticker_issue_32_051', 'sticker_issue_32_050'],
  },
  'meet-ai-girls': {
    name: ['认识几位 AI 娘', 'Meet a few AI girls', 'AI娘たちに会ってみよう'],
    summary: ['从不同角色的立绘与二创开始，去各自的档案里继续逛。', 'Start with portraits and fan art, then explore each character’s archive.', '立ち絵と二次創作を入口に、各キャラクターのアーカイブを巡ります。'],
    heading: ['从代表图进入不同角色的档案', 'Discover the character archives through selected works', '代表作から各キャラクターのアーカイブへ'],
    note: ['这里选择多个角色的已收录作品作为初见入口。代表图来自不同创作者，不是统一角色设定；沿作品上的角色链接，可以继续比较她们的其他二创形象。', 'Discover several characters through selected archived works by different creators. Follow the character links to compare other community interpretations.', '収録作品を入口に、さまざまなキャラクターに出会えます。代表作の作者はそれぞれ異なります。キャラクターへのリンクからほかの二次創作も比較できます。'],
    works: ['sticker_bec975c5feb5bb316bf80c25', 'sticker_ca328c43e79e65fc7750c3c0', 'sticker_f8323e128d058ac9ddd4827d', 'sticker_5922a89a613db957824d7c54', 'sticker_48343eb7359e9ef2bbc972dc'],
  },
};
