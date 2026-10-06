// @vitest-environment node
import {describe,it,expect} from 'vitest'
import sharp from 'sharp'
import {fixtureI18n} from '../../../tools/localization/test-fixture.mjs'
import {sourceHash} from '../../src/lib/localization.mjs'
import {buildSiteDataTexts} from '../../src/lib/export-site-data'
import {validateContent} from '../../src/lib/sync-submissions'
import {suggestFill} from '../../src/lib/ai-fill'
const source={name:'探头',description:'露出脑袋',commentary:'让我看看',tags:['探头','可爱'],characterId:'deepseek',categoryIds:['meme']}
const vocabulary={characterIds:new Set(['deepseek']),categoryIds:new Set(['meme'])}
const record={...source,workId:'frozen-id',slug:'frozen-slug',kind:'submission',status:'published',legacySource:'submission-sync',character:{characterId:'deepseek'},categories:[{categoryId:'meme'}],tags:source.tags.map(value=>({value})),origin:{},license:{}}
const exported=(work:any)=>JSON.parse(buildSiteDataTexts({works:[work],characters:[],categories:[],topics:[]})['data/works.json'])[0]
describe('multilingual persistence and export',()=>{
  it('keeps review translations through validation/export and invalidates edited source',()=>{
    const content={...source,i18n:fixtureI18n(source.tags)}
    expect(validateContent(content,vocabulary).ok).toBe(true)
    const work={...record,review:{content}}
    expect(exported(work).i18n.en.name).toBe(content.i18n.en.name)
    expect(exported(work).i18n.sourceHash).toBe(sourceHash(source))
    expect(exported({...work,name:'改标题'}).i18n).toBeUndefined()
  })
  it('uses saved AI-fill JSON for submission-sync records',()=>{
    const saved={sourceHash:sourceHash(source),...fixtureI18n(source.tags)}
    expect(exported({...record,legacyData:{i18n:saved}}).i18n).toEqual(saved)
  })
  it('requires valid English and Japanese after AI writes Chinese content',async()=>{
    const image=await sharp({create:{width:16,height:16,channels:3,background:'blue'}}).png().toBuffer()
    let calls=0
    const request={authorText:'',characterName:'DeepSeek娘',fields:['commentary'] as const,image,name:source.name,vocabulary:{categories:[]},current:source}
    const result=await suggestFill({...request,fields:[...request.fields]},async()=>++calls===1?'{"commentary":"我看见你了"}':JSON.stringify(fixtureI18n(source.tags)))
    expect(calls).toBe(2)
    expect(result.suggestion.i18n?.sourceHash).toBe(sourceHash({...source,commentary:'我看见你了'}))
    calls=0
    await expect(suggestFill({...request,fields:[...request.fields]},async()=>++calls===1?'{"commentary":"我看见你了"}':'{"en":{}}')).rejects.toThrow()
  })
})
