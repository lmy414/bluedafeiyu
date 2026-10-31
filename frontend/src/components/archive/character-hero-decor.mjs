// Hero decoration art. Every character page paints the same three overlay slots
// (wash / shape / accent) across the whole `header.character-hero`. All drawings
// live on one 1000x700 canvas that maps to the hero box; the left text column
// (roughly x < 560) is left to the very faint wash, so large shapes only occupy
// the portrait column, its top-right corner and the bottom edge.

const mark = (id, x, y, width, height) => `<use href="#character-brand-${id}" x="${x}" y="${y}" width="${width}" height="${height}"/>`;

const star = (cx, cy, r, opacity = 1) => `<path d="M${cx} ${cy - r}Q${cx + r * .12} ${cy - r * .12} ${cx + r} ${cy}Q${cx + r * .12} ${cy + r * .12} ${cx} ${cy + r}Q${cx - r * .12} ${cy + r * .12} ${cx - r} ${cy}Q${cx - r * .12} ${cy - r * .12} ${cx} ${cy - r}Z" fill="currentColor" opacity="${opacity}"/>`;

const dots = (x, y, cols, rows, step, r, opacity = 1) => {
  let out = '';
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) out += `<circle cx="${x + col * step}" cy="${y + row * step}" r="${r}" fill="currentColor" opacity="${opacity}"/>`;
  return out;
};

const plus = (cx, cy, r, opacity = 1) => `<path d="M${cx - r} ${cy}h${r * 2}M${cx} ${cy - r}v${r * 2}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="square" opacity="${opacity}"/>`;

export const characterHeroDecor = {
  // DeepSeek: airy blue, the whale lock-up low in the portrait column.
  deepseek: {
    shape: `${mark('deepseek', 566, 556, 380, 61)}<path d="M600 640c64-46 128-46 192 0s128 46 192 0" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity=".4"/>`,
    accent: `${dots(700, 128, 3, 3, 40, 4, .55)}<path d="M640 210c30-22 60-22 90 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".7"/>`
  },
  // Doubao: rounded app tile with the friendly face, upper portrait corner.
  doubao: {
    shape: `<rect x="640" y="150" width="280" height="280" rx="82" fill="none" stroke="currentColor" stroke-width="12" opacity=".65"/><circle cx="724" cy="272" r="14" fill="currentColor" opacity=".8"/><circle cx="836" cy="272" r="14" fill="currentColor" opacity=".8"/><path d="M718 348c30 26 94 26 124 0" fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round" opacity=".8"/>`,
    accent: `${dots(760, 560, 4, 2, 38, 4, .55)}${dots(600, 580, 3, 1, 40, 5, .5)}`
  },
  // Kimi: minimal monochrome crescent and orbit ring above the wordmark.
  kimi: {
    shape: `<path d="M878 120a112 112 0 1 0 46 196 140 140 0 0 1-46-196Z" fill="currentColor" opacity=".5"/><circle cx="760" cy="330" r="196" fill="none" stroke="currentColor" stroke-width="3" opacity=".5"/><circle cx="760" cy="330" r="266" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="6 16" opacity=".38"/>${mark('kimi', 588, 528, 360, 120)}`,
    accent: `<circle cx="944" cy="150" r="6" fill="currentColor" opacity=".9"/><circle cx="560" cy="238" r="4" fill="currentColor" opacity=".65"/><circle cx="930" cy="470" r="4" fill="currentColor" opacity=".55"/>`
  },
  // Qwen: the signature cobalt/violet diagonal panels along the portrait side.
  qwen: {
    shape: `<path d="M560 0h440v190L560 444Z" fill="currentColor" opacity=".3"/><path d="M726 0h274v96L726 204Z" fill="currentColor" opacity=".5"/><path d="M600 700V500l400-268v468Z" fill="currentColor" opacity=".2"/>`,
    accent: `<path d="M566 686c80-84 160 6 240-78s72-86 116-108" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".7"/><rect x="700" y="380" width="42" height="42" fill="currentColor" opacity=".45"/>`
  },
  // Claude: warm cream arch panel over the portrait column.
  claude: {
    shape: `<path d="M762 84c118 0 208 92 208 208v264H554V292c0-116 90-208 208-208Z" fill="none" stroke="currentColor" stroke-width="10" opacity=".5"/><path d="M762 150c86 0 152 68 152 152v254" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="8 12" opacity=".45"/>`,
    accent: `${plus(940, 150, 12, .65)}${plus(600, 210, 9, .5)}${plus(930, 600, 10, .55)}`
  },
  // Gemini: the four-point sparkle cluster and soft blue-violet air.
  gemini: {
    shape: `${star(806, 372, 178, .78)}${star(626, 148, 82, .5)}${star(944, 546, 52, .5)}`,
    accent: `${star(700, 620, 34, .65)}${star(960, 250, 24, .5)}${star(576, 450, 20, .45)}${star(880, 90, 26, .55)}`
  },
  // Grok: hard diagonal slashes over a machine grid.
  grok: {
    shape: `<path d="M860 0h96L700 700h-96Z" fill="currentColor" opacity=".16"/><path d="M980 0h56L820 700h-56Z" fill="currentColor" opacity=".28"/>`,
    accent: `${dots(680, 470, 7, 5, 42, 3, .45)}<path d="M620 560h300M620 600h220M620 640h260" stroke="currentColor" stroke-width="5" opacity=".4"/>`
  },
  // StepFun: cyan blueprint steps and ticked axes.
  stepfun: {
    shape: `<path d="M1000 700H600V596h112V492h112V388h176Z" fill="currentColor" opacity=".2"/><path d="M600 120h380M600 158h380M600 196h380" stroke="currentColor" stroke-width="2" opacity=".55"/>`,
    accent: `${dots(628, 380, 3, 3, 66, 5, .5)}<path d="M580 84v560" stroke="currentColor" stroke-width="3" opacity=".45"/><path d="M600 300h74M600 400h108" stroke="currentColor" stroke-width="6" opacity=".55"/>`
  },
  // GLM / Z.ai: the oversized Z watermark in the portrait column.
  glm: {
    shape: `<path d="M616 130h336L616 372h364" fill="none" stroke="currentColor" stroke-width="28" stroke-linejoin="miter" opacity=".75"/>`,
    accent: `${dots(650, 470, 5, 4, 38, 4, .5)}<rect x="860" y="470" width="104" height="104" fill="none" stroke="currentColor" stroke-width="6" opacity=".38"/>`
  },
  // GPT: the knot rosette, quiet and monochrome.
  gpt: {
    shape: `<g fill="none" stroke="currentColor" stroke-width="7" opacity=".42"><ellipse cx="788" cy="330" rx="80" ry="186"/><ellipse cx="788" cy="330" rx="80" ry="186" transform="rotate(60 788 330)"/><ellipse cx="788" cy="330" rx="80" ry="186" transform="rotate(120 788 330)"/></g><circle cx="788" cy="330" r="226" fill="none" stroke="currentColor" stroke-width="2" opacity=".38"/>`,
    accent: `${dots(640, 560, 4, 3, 36, 4, .45)}<circle cx="788" cy="330" r="10" fill="currentColor" opacity=".5"/>`
  },
  // MiMo: a research plate with bracket rules and ruled lines.
  mimo: {
    shape: `<path d="M600 96h104M600 96v450M600 546h104M960 96H856M960 96v450M960 546H856" fill="none" stroke="currentColor" stroke-width="8" opacity=".55"/><path d="M666 280h220M666 344h220M666 408h146" stroke="currentColor" stroke-width="7" opacity=".5"/>`,
    accent: `${dots(666, 480, 4, 2, 50, 5, .55)}<rect x="666" y="180" width="34" height="34" fill="currentColor" opacity=".4"/>`
  },
  // Site collection (other): a dashed archive frame over the portrait column.
  other: {
    shape: `<rect x="566" y="92" width="394" height="512" rx="24" fill="none" stroke="currentColor" stroke-width="6" stroke-dasharray="18 16" opacity=".55"/><path d="M620 580 930 260" stroke="currentColor" stroke-width="3" stroke-dasharray="10 14" opacity=".35"/>`,
    accent: `${star(790, 200, 40, .65)}${star(900, 470, 28, .5)}${star(640, 540, 20, .45)}`
  },
  // Site collection (owner picks): a bookmark ribbon beside archive rules.
  'owner-picks': {
    shape: `<path d="M700 96h124v236l-62-50-62 50Z" fill="currentColor" opacity=".24"/><path d="M938 96v590M878 96v590" stroke="currentColor" stroke-width="8" opacity=".45"/>`,
    accent: `${dots(620, 560, 4, 1, 42, 6, .45)}<path d="M620 500h180M620 464h128" stroke="currentColor" stroke-width="6" opacity=".38"/>`
  },
  // MiniMax: layered arches and the coral glow.
  minimax: {
    shape: `<path d="M552 700V492a214 214 0 0 1 428 0v208" fill="none" stroke="currentColor" stroke-width="10" opacity=".42"/><path d="M630 700V504a136 136 0 0 1 272 0v196" fill="none" stroke="currentColor" stroke-width="5" opacity=".55"/>`,
    accent: `${dots(586, 330, 2, 3, 40, 5, .5)}${dots(918, 350, 2, 3, 44, 4, .45)}`
  },
  // Mistral: the diagonal flag bars; the pixel row lives in the hero strip.
  mistral: {
    shape: `<path d="M800 0h86L586 700h-86Z" fill="currentColor" opacity=".16"/><path d="M938 0h62L724 700h-62Z" fill="currentColor" opacity=".26"/>`,
    accent: `<rect x="760" y="520" width="32" height="32" fill="currentColor" opacity=".55"/><rect x="804" y="520" width="32" height="32" fill="currentColor" opacity=".4"/><rect x="760" y="564" width="32" height="32" fill="currentColor" opacity=".4"/><rect x="804" y="564" width="32" height="32" fill="currentColor" opacity=".28"/>`
  },
  // Llama: the Meta infinity mark and lock-up along the bottom of the portrait.
  llama: {
    shape: `<path d="M760 486c-44-58-136-58-136 0s92 58 136 0 136-58 136 0-92 58-136 0Z" fill="none" stroke="currentColor" stroke-width="19" stroke-linecap="round" opacity=".6"/>${mark('llama', 600, 556, 280, 61.6)}`,
    accent: `${dots(620, 160, 3, 3, 40, 5, .5)}${dots(900, 330, 2, 2, 44, 5, .5)}`
  },
  // Perplexity: research crosshair rings and ticks.
  perplexity: {
    shape: `<g fill="none" stroke="currentColor" opacity=".45"><circle cx="788" cy="336" r="176" stroke-width="8"/><circle cx="788" cy="336" r="112" stroke-width="4" stroke-dasharray="6 14"/><path d="M788 96v-64M788 640v64M612 336h-36M964 336h64" stroke-width="6"/></g>`,
    accent: `${plus(624, 540, 11, .55)}${plus(932, 560, 8, .45)}${plus(600, 190, 8, .45)}`
  },
  // RWKV: the academic wordmark over double rules.
  rwkv: {
    shape: `${mark('rwkv', 520, 520, 440, 117)}<path d="M560 646h400M560 666h400" stroke="currentColor" stroke-width="3" opacity=".5"/>`,
    accent: `${dots(640, 150, 4, 3, 36, 4, .4)}<path d="M640 96h180M640 132h124" fill="none" stroke="currentColor" stroke-width="5" opacity=".38"/>`
  },
  // Hunyuan: the large brand circle and lock-up.
  hunyuan: {
    shape: `<circle cx="788" cy="322" r="204" fill="none" stroke="currentColor" stroke-width="10" opacity=".45"/><circle cx="788" cy="322" r="272" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 18" opacity=".35"/>${mark('hunyuan', 638, 288, 300, 69)}`,
    accent: `${plus(940, 120, 10, .55)}${plus(590, 600, 9, .45)}${dots(940, 520, 2, 3, 42, 5, .45)}`
  },
  // Git (three sites): branch rail with the three official marks.
  git: {
    shape: `<path d="M906 88v520" stroke="currentColor" stroke-width="3" stroke-dasharray="5 13" opacity=".55"/><path d="M906 250c-76 0-76 160 0 160" fill="none" stroke="currentColor" stroke-width="3" opacity=".45"/>${mark('github', 936, 108, 78, 78)}${mark('gitlab', 936, 300, 78, 78)}${mark('gitee', 720, 540, 180, 56.6)}`,
    accent: `${dots(760, 180, 2, 5, 40, 5, .45)}<circle cx="906" cy="250" r="9" fill="currentColor" opacity=".75"/>`
  },
  // NovelAI: a night sky crescent with scattered starlight.
  novelai: {
    shape: `<path d="M902 150a128 128 0 1 0 50 226 166 166 0 0 1-50-226Z" fill="currentColor" opacity=".5"/><circle cx="780" cy="392" r="236" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 18" opacity=".45"/>`,
    accent: `${star(660, 470, 32, .75)}${star(956, 470, 24, .65)}${star(880, 630, 18, .55)}${dots(620, 150, 3, 3, 44, 3, .65)}`
  },
  // Hugging Face: the warm yellow smile and a soft halo.
  huggingface: {
    shape: `${mark('huggingface', 688, 168, 232, 215)}<circle cx="804" cy="276" r="182" fill="none" stroke="currentColor" stroke-width="4" opacity=".4"/>`,
    accent: `${dots(640, 520, 4, 3, 38, 5, .5)}${star(946, 500, 34, .55)}`
  },
  // ZCode: the complete Z mark plus code braces, fully inside the hero.
  zcode: {
    shape: `${mark('zcode', 616, 122, 300, 255)}<path d="M1000 300c-44 0-44 156-88 156s-44 156-88 156" fill="none" stroke="currentColor" stroke-width="10" opacity=".35"/><circle cx="790" cy="330" r="238" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="8 20" opacity=".35"/>`,
    accent: `<path d="M566 96v524M602 96v524" stroke="currentColor" stroke-width="2" opacity=".3"/>${dots(660, 620, 4, 1, 34, 4, .55)}`
  },
  // OpenCode: a terminal prompt plate and dashed rails.
  opencode: {
    shape: `<rect x="620" y="180" width="296" height="220" rx="12" fill="none" stroke="currentColor" stroke-width="6" opacity=".45"/><path d="M674 290l48 48-48 48M776 386h70" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="square" opacity=".7"/>`,
    accent: `<path d="M560 150h400M560 186h280M560 580h400" stroke="currentColor" stroke-width="3" stroke-dasharray="12 10" opacity=".4"/>`
  }
};
