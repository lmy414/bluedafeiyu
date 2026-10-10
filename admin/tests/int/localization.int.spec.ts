// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {fixtureI18n} from '../../../tools/localization/test-fixture.mjs'
import {sourceHash, validateLocale, validateI18n} from '../../src/lib/localization.mjs'
import {buildSiteDataTexts} from '../../src/lib/export-site-data'
import {validateContent} from '../../src/lib/sync-submissions'
const source={name:'探头',description:'露出脑袋',commentary:'让我看看',tags:['探头','可爱'],characterId:'deepseek',categoryIds:['meme']}
const vocabulary={characterIds:new Set(['deepseek']),categoryIds:new Set(['meme'])}
const record={...source,workId:'frozen-id',slug:'frozen-slug',kind:'submission',status:'published',legacySource:'submission-sync',character:{characterId:'deepseek'},categories:[{categoryId:'meme'}],tags:source.tags.map(value=>({value})),origin:{},license:{}}
const exported=(work:any)=>JSON.parse(buildSiteDataTexts({works:[work],characters:[],categories:[],topics:[]})['data/works.json'])[0]
describe('multilingual persistence and export',()=>{
  it('exports the current single type for archived blue-fish works over the previous snapshot',()=>{
    const work={...record,kind:'blue-fish',categories:[{categoryId:'standing'}],legacyData:{sourcePath:'media/design.png'}}
    const output=buildSiteDataTexts({works:[work],characters:[],categories:[],topics:[],editorialSnapshot:{text:JSON.stringify({'media/design.png':{categoryIds:['setting','illustration'],commentary:'让我看看'}})}})
    expect(JSON.parse(output['data/blue-fish-editorial.json'])['media/design.png'].categoryIds).toEqual(['standing'])
  })
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
  it('validates a single Agent language independently; complete content still requires both',()=>{
    const value = fixtureI18n(source.tags)
    expect(validateLocale(value.en, 'en', source)).toEqual(value.en)
    expect(()=>validateI18n({en:value.en},source)).toThrow()
    value.en.originNote='Fan art by 小明.'
    expect(()=>validateLocale(value.en,'en',{...source,origin:{author:'小明'}})).not.toThrow()
    expect(()=>validateLocale(value.en,'en',source)).toThrow(/Chinese/)
  })
})
