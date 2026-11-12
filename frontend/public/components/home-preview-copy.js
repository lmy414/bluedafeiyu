// Match the archive adapter: Chinese uses the supplied fallback, not a lookup.
const typeNames={meme:'梗图',illustration:'插画',setting:'设定图',comic:'漫画',standing:'立绘',other:'其他'};
export function homePreviewText(key,text,vars,language=globalThis.SiteLang) {
  if(key.startsWith('v2.type.'))text=typeNames[key.slice(8)]||text;
  return language?language.fmt(key,text,vars):text;
}
