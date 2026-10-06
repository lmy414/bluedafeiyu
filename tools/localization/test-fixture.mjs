export function fixtureI18n(tags=['探头','可爱']) {
  const entry=(ja)=>({name:ja?'ひょっこりDeepSeekちゃん':'DeepSeek Chan Peeks In',description:ja?'DeepSeekちゃんが顔をのぞかせています。':'DeepSeek Chan peeks into view.',commentary:ja?'何をしているの？ちょっと見せて。':'What are you up to? Let me have a look.',tags:tags.map((_,i)=>ja?'タグ'+i:'tag '+i),seoTitle:ja?'顔をのぞかせるDeepSeekちゃん':'DeepSeek Chan Peeking Reaction Image',seoDescription:ja?'顔をのぞかせるDeepSeekちゃんのファンアートです。':'A fan-made reaction image of DeepSeek Chan peeking into view.',faq:[{question:ja?'誰が描かれていますか？':'Who is shown?',answer:ja?'DeepSeekちゃんです。':'DeepSeek Chan is shown.'},{question:ja?'何をしていますか？':'What is she doing?',answer:ja?'顔をのぞかせています。':'She is peeking into view.'}],originNote:'',licenseNote:''});
  return {en:entry(false),ja:entry(true)};
}
