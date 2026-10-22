// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, getPayload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Users } from '@/collections/Users'
import { Creators } from '@/collections/Creators'
import { Videos } from '@/collections/Videos'
import { BulkJobs } from '@/collections/BulkJobs'
import { Works } from '@/collections/Works'
import { Submissions } from '@/collections/Submissions'
import { Categories } from '@/collections/Categories'
import { Characters } from '@/collections/Characters'
import { Media } from '@/collections/Media'
import { Topics } from '@/collections/Topics'
import { PublishRuns } from '@/collections/PublishRuns'
import { AuditEvents } from '@/collections/AuditEvents'
import { createBulkJob, cancelBulkJob, retryBulkJob } from '@/endpoints/bulk-jobs'
import { stepJob, draftOf } from '@/lib/bulk-jobs'
import { agentHandler } from '@/endpoints/agent'
import { consoleList, consoleAuthors, parseConsoleQuery } from '@/lib/console-list'
import { sourceHash } from '@/lib/localization.mjs'
import { buildSiteDataTexts } from '@/lib/export-site-data'
import { validateContent } from '@/lib/sync-submissions'
import { up as migrateCharacters } from '@/migrations/20261011_000000_work_characters'
import { DatabaseSync } from 'node:sqlite'
import { TakedownRequests } from '@/collections/TakedownRequests'
import { requestAgentHandler } from '@/endpoints/request-agent'
import { issueSnapshot } from '@/lib/rights-requests'
import { fixtureI18n } from '../../../tools/localization/test-fixture.mjs'
import { listTasks } from '@/endpoints/tasks'
import { createDevice, devices, uploadWork } from '@/endpoints/automation'

let payload: any, owner: any, bot: any, char: any, category: any, media: any, root: string, imageBytes: Buffer
const request = (body: any, user = owner) => ({ payload, user, context: {}, json: async () => body, url: 'http://localhost' }) as any
const query = (params: string) => parseConsoleQuery(new URL('http://localhost/?' + params))
async function createWork(key: string, data: any = {}) {
  return payload.create({ collection: 'works', data: { workId: key, name: key, character: char.id, categories: [category.id], channel: 'web', kind: 'submission', status: 'published', needsPublish: false, preview: media.id, ...data }, overrideAccess: true, context: { audit: false, skipNeedsPublish: true } })
}
async function createSubmission(key: string, data: any = {}) {
  return payload.create({ collection: 'submissions', data: { submissionId: key, title: key, source: 'web', state: 'needs_manual', fields: { name: key, character: 'deepseek', categoryId: 'meme' }, media: media.id, ...data }, overrideAccess: true, context: { audit: false } })
}
async function enqueue(operation: string, target: string, ids: string[], extras: any = {}) {
  const response = await createBulkJob(request({ operation, target, ids, ...extras }))
  expect(response.status).toBe(202)
  const body = await response.json()
  return (await payload.find({ collection: 'bulk-jobs', where: { jobId: { equals: body.job.jobId } }, overrideAccess: true })).docs[0]
}
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'console-bulk-'))
  process.env.MEDIA_DIR = path.join(root, 'media')
  const config = buildConfig({ collections: [Users, Creators, Videos, BulkJobs, Works, Submissions, Categories, Characters, { ...Media, upload: { ...(Media.upload as any), staticDir: process.env.MEDIA_DIR } }, Topics, PublishRuns, AuditEvents, TakedownRequests], db: sqliteAdapter({ client: { url: `file:${path.join(root, 'test.db').replace(/\\/g, '/')}` }, push: true, transactionOptions: { behavior: 'immediate' } }), secret: 'console-bulk-test', sharp })
  payload = await getPayload({ config })
  owner = await payload.create({ collection: 'users', data: { email: 'owner@bulk.test', password: 'test-password', role: 'owner' }, overrideAccess: true, context: { audit: false } })
  bot = { id: owner.id, role: 'bot' }
  char = await payload.create({ collection: 'characters', data: { characterId: 'deepseek', name: 'DeepSeek娘', status: 'active' }, overrideAccess: true, context: { audit: false } })
  category = await payload.create({ collection: 'categories', data: { categoryId: 'meme', name: '梗图', status: 'active' }, overrideAccess: true, context: { audit: false } })
  const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#123456' } }).webp().toBuffer()
  imageBytes = bytes
  const image = path.join(root, 'fixture.webp'); await fs.writeFile(image, bytes)
  media = await payload.create({ collection: 'media', data: { alt: '测试', mediaRole: 'preview' }, filePath: image, overrideAccess: true, context: { audit: false } })
}, 30000)
afterAll(async () => { await payload?.destroy(); payload?.db?.client?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }, 30000)


describe('本地站长通道', () => {
  it('独立设备使用原生 API Key 认证，并拥有站长的专题和内容管理权限', async () => {
    expect((await createDevice({...request({name:'local'}),user:null})).status).toBe(401)
    expect((await createDevice(request({name:'local'},bot))).status).toBe(403)
    const response=await createDevice(request({name:'验收工作站'}))
    expect(response.status).toBe(201)
    const device=await response.json()
    const auth=await payload.auth({headers:new Headers({Authorization:'users API-Key '+device.apiKey})})
    expect(auth.user.role).toBe('owner')
    const req={...request({}),user:auth.user}
    const topic=await payload.create({collection:'topics',data:{topicId:'device-curated',name:'设备精选',summary:'本地设备权限验收',status:'draft',works:[],order:2},req,overrideAccess:false})
    const work=await createWork('device_work')
    const updated=await payload.update({collection:'topics',id:topic.id,data:{works:[work.id],cover:work.id},req,overrideAccess:false})
    expect(updated.works[0].workId || updated.works[0]).toBe(work.workId)
    expect((await devices(request({}))).status).toBe(200)
    expect(JSON.stringify(await (await devices(request({}))).json())).not.toContain(device.apiKey)
    const logs=await payload.find({collection:'audit-events',where:{targetId:{equals:String(topic.id)}},overrideAccess:true})
    expect(logs.docs.some((e:any)=>e.actorName==='验收工作站'&&e.actorType==='ai')).toBe(true)
    const userLogs=await payload.find({collection:'audit-events',where:{and:[{targetType:{equals:'users'}},{targetId:{equals:String(device.id)}}]},overrideAccess:true})
    expect(JSON.stringify(userLogs)).not.toContain(device.apiKey)
    await payload.delete({collection:'topics',id:topic.id,req,overrideAccess:false})
    await payload.delete({collection:'works',id:work.id,req,overrideAccess:false})
  })
  it('上传仅桥接到受鉴权的原图队列，定向同步且不越过人工收录决定', async () => {
    expect((await uploadWork(request({},bot))).status).toBe(403)
    const digest=crypto.createHash('sha256').update(imageBytes).digest('hex'),id='sub_'+digest.slice(0,24)
    process.env.SUBMISSION_ADMIN_TOKEN='automation-test-token'
    const fetchMock=vi.fn(async(input:any,init:any)=>{
      const url=new URL(String(input))
      expect(init.headers.Authorization).toBe('Bearer automation-test-token')
      if(url.pathname==='/api/v1/admin-upload'){
        expect(JSON.parse(init.body).actor).toBeTruthy()
        return Response.json({id,duplicate:false},{status:201})
      }
      if(url.pathname==='/api/v1/items'){
        expect(url.searchParams.get('ids')).toBe(id)
        return Response.json({items:[{id,sha256:digest,source:'manual',state:'needs_manual',format:'webp',mime:'image/webp',fields:{name:'设备上传',character:'deepseek',categoryId:'meme'},origin:{via:'owner-upload'},updatedAt:new Date().toISOString()}],nextCursor:null})
      }
      if(url.pathname.endsWith('/raw'))return new Response(imageBytes)
      throw new Error('unexpected '+url)
    })
    vi.stubGlobal('fetch',fetchMock)
    try {
      const response=await uploadWork(request({dataBase64:imageBytes.toString('base64'),name:'设备上传',character:'deepseek',categoryId:'meme'}))
      expect(response.status).toBe(201)
      const doc=(await payload.find({collection:'submissions',where:{submissionId:{equals:id}},overrideAccess:true})).docs[0]
      expect(doc.work).toBeFalsy();expect(doc.state).toBe('needs_manual')
      await payload.delete({collection:'submissions',id:doc.id,overrideAccess:true,context:{audit:false}})
    }finally{vi.unstubAllGlobals()}
  })
})

describe('统一任务中心', () => {
  it('后续成功发布会把旧失败归入已处理，同时保留真实失败记录', async () => {
    const failed=await payload.create({collection:'publish-runs',data:{runId:'history-failed',status:'failed',step:'build',error:'历史构建失败',createdAt:'2026-10-01T00:00:00.000Z'},overrideAccess:true,context:{audit:false}})
    const current=await payload.create({collection:'publish-runs',data:{runId:'history-current-failed',status:'failed',step:'build',createdAt:'2026-10-03T00:00:00.000Z'},overrideAccess:true,context:{audit:false}})
    const success=await payload.create({collection:'publish-runs',data:{runId:'history-success',status:'succeeded',step:'complete',createdAt:'2026-10-02T00:00:00.000Z'},overrideAccess:true,context:{audit:false}})
    try {
      const pending=await (await listTasks({...request({}),url:'http://localhost/?kind=publish&status=attention'})).json()
      expect(pending.docs.map((d:any)=>d.sourceId)).toEqual(['history-current-failed'])
      const handled=await (await listTasks({...request({}),url:'http://localhost/?task=history-failed&status=completed'})).json()
      expect(handled.docs[0].stage).toBe('superseded')
      expect((await payload.findByID({collection:'publish-runs',id:failed.id,overrideAccess:true})).status).toBe('failed')
    }finally{for(const doc of [failed,current,success])await payload.delete({collection:'publish-runs',id:doc.id,overrideAccess:true,context:{audit:false}})}
  })

  it('拒绝访客和受限机器人，站长可查看多来源任务与分页', async () => {
    expect((await listTasks({...request({}),user:null})).status).toBe(401)
    expect((await listTasks(request({},bot))).status).toBe(403)
    const doc=await createSubmission('sub_task_unified')
    const job=await enqueue('manual-include','submissions',[doc.submissionId],{confirm:'MANUAL_INCLUDE'})
    const result=await (await listTasks({...request({}),url:'http://localhost/?status=running'})).json()
    expect(result.docs.some((t:any)=>t.sourceId===job.jobId)).toBe(true)
    expect(result.docs.some((t:any)=>t.sourceId===String(doc.id))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('versions')
    const detail=await (await listTasks({...request({}),url:'http://localhost/?task='+job.jobId})).json()
    expect(detail.totalDocs).toBe(1)
    await cancelBulkJob(request({jobId:job.jobId}))
    await payload.update({collection:'submissions',id:doc.id,data:{state:'rejected'},overrideAccess:true,context:{audit:false}})
  })
})

describe('轻量列表服务端分页', () => {
  it('只返回当前页；作者统计覆盖全部匹配记录；不输出大段译文', async () => {
    for (let n = 0; n < 55; n++) await createWork(`page_${n}`, { origin: { author: n === 54 ? '远端作者' : '普通作者' }, review: { confidence: .9, content: { huge: 'x'.repeat(20000) } } })
    const list = await consoleList(payload, query('kind=works&limit=48'))
    expect(list.docs).toHaveLength(48); expect(list.totalDocs).toBe(55); expect(list.totalPages).toBe(2)
    expect(JSON.stringify(list).includes('huge')).toBe(false)
    const second = await consoleList(payload, query('kind=works&limit=48&page=2'))
    expect(second.docs).toHaveLength(7)
    expect(new Set([...list.docs, ...second.docs].map(x => x.id)).size).toBe(55)
    const authors = await consoleAuthors(payload, query('kind=works'))
    expect(authors.find(x => x.value === '远端作者')?.count).toBe(1)
    const filtered = await consoleList(payload, query('kind=works&author=' + encodeURIComponent('远端作者')))
    expect(filtered.totalDocs).toBe(1)
    expect(filtered.docs[0].effectiveAuthor).toBe('远端作者')
    const oldEnv = { property: process.env.GA4_PROPERTY_ID, stream: process.env.GA4_STREAM_ID, start: process.env.GA4_START_DATE, file: process.env.GA4_CACHE_FILE }
    try {
      process.env.GA4_PROPERTY_ID = '123'; process.env.GA4_STREAM_ID = '456'; process.env.GA4_START_DATE = '2026-10-03'; process.env.GA4_CACHE_FILE = path.join(root, 'analytics.json')
      await fs.writeFile(process.env.GA4_CACHE_FILE, JSON.stringify({ version: 1, propertyId: '123', streamId: '456', startDate: '2026-10-03', syncedAt: new Date().toISOString(), works: { page_0: { views: 999, downloads: 888 } } }))
      const ranked = await consoleList(payload, query('kind=works&sort=downloads&limit=1'))
      expect((ranked.docs[0] as any).workId).toBe('page_0')
      expect((ranked.docs[0] as any).metrics?.downloads).toBe(888)
    } finally {
      for (const [key, value] of Object.entries({ GA4_PROPERTY_ID: oldEnv.property, GA4_STREAM_ID: oldEnv.stream, GA4_START_DATE: oldEnv.start, GA4_CACHE_FILE: oldEnv.file })) if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }, 30000)
  it('参数化搜索防注入，字面 % 不匹配全部；人工列表按关联状态区分', async () => {
    expect((await consoleList(payload, query('keyword=%25'))).totalDocs).toBe(0)
    expect((await consoleList(payload, query('keyword=' + encodeURIComponent("' OR 1=1 --")))).totalDocs).toBe(0)
    const work = await createWork('handled_work')
    await createSubmission('sub_unhandled')
    await createSubmission('sub_handled', { work: work.id })
    expect((await consoleList(payload, query('kind=submissions&mode=rejected'))).totalDocs).toBe(1)
    expect((await consoleList(payload, query('kind=submissions&mode=reviewed'))).totalDocs).toBe(1)
  })
})

describe('多角色真实数据库链路', () => {
  it('迁移旧关系保留分类；保存、检索和导出完整集合且冻结路径', async () => {
    const second = await payload.create({ collection: 'characters', data: { characterId: 'claude', name: 'Claude', status: 'active' }, overrideAccess: true, context: { audit: false } })
    const work = await createWork('multi_fixed', { slug: 'frozen-slug', legacyPaths: { path: 'submissions/originals/deepseek/frozen.webp' } })
    const legacyDB = new DatabaseSync(path.join(root, 'migration.db'))
    try {
      legacyDB.exec(`PRAGMA foreign_keys=ON; CREATE TABLE characters(id INTEGER PRIMARY KEY); CREATE TABLE works(id INTEGER PRIMARY KEY, character_id INTEGER REFERENCES characters(id), slug TEXT, path TEXT); CREATE TABLE works_rels(id INTEGER PRIMARY KEY, "order" INTEGER, parent_id INTEGER REFERENCES works(id), path TEXT, categories_id INTEGER); INSERT INTO characters VALUES(1); INSERT INTO works VALUES(1,1,'frozen','original.webp'); INSERT INTO works_rels VALUES(1,1,1,'categories',7);`)
      await migrateCharacters({ db: { run: async (statement: any) => legacyDB.exec(statement.queryChunks.map((chunk: any) => chunk.value?.join('') || '').join('')) } } as any)
      expect(legacyDB.prepare("SELECT characters_id FROM works_rels WHERE path='characters'").get()).toMatchObject({ characters_id: 1 })
      expect(legacyDB.prepare("SELECT categories_id FROM works_rels WHERE path='categories'").get()).toMatchObject({ categories_id: 7 })
      expect(legacyDB.prepare('SELECT slug,path FROM works').get()).toMatchObject({ slug: 'frozen', path: 'original.webp' })
      expect(legacyDB.prepare('PRAGMA foreign_key_list(works_rels)').all().some((row: any) => row.from === 'characters_id')).toBe(true)
    } finally { legacyDB.close() }
    await payload.update({ collection: 'works', id: work.id, data: { characters: [second.id, char.id, second.id] }, overrideAccess: true, context: { audit: false } })
    const saved = await payload.findByID({ collection: 'works', id: work.id, depth: 1, overrideAccess: true })
    expect(saved.characters.map((c: any) => c.id)).toEqual([second.id, char.id])
    expect(saved.character.id).toBe(char.id)
    expect(saved.needsPublish).toBe(true)
    const list = await consoleList(payload, query(`character=${second.id}`))
    expect(list.totalDocs).toBe(1)
    expect((list.docs[0] as any).characters.map((c: any) => c.characterId)).toEqual(['claude', 'deepseek'])
    const exported = JSON.parse(buildSiteDataTexts({ works: [saved], characters: [], categories: [], topics: [] })['data/works.json'])[0]
    expect(exported).toMatchObject({ id: 'multi_fixed', slug: 'frozen-slug', path: 'submissions/originals/deepseek/frozen.webp', characterId: 'deepseek', characterIds: ['claude', 'deepseek'] })
    const job = await enqueue('write-fields', 'works', ['multi_fixed'], { patch: { characterIds: ['claude'] } })
    expect((await stepJob(request({}), job)).status).toBe('succeeded')
    const changed = await payload.findByID({ collection: 'works', id: work.id, depth: 0, overrideAccess: true })
    expect(changed.character).toBe(second.id)
    expect(changed.characters).toEqual([second.id])
    expect(changed.slug).toBe('frozen-slug')
    expect(changed.legacyPaths.path).toBe(exported.path)
  })
  it('人工审核草稿保留投稿者提交的全部角色', () => {
    const draft = draftOf({ fields: { character: 'deepseek', characterIds: ['deepseek','claude'] } }, 'submissions', {})
    expect(draft.characterId).toBe('deepseek')
    expect(draft.characterIds).toEqual(['deepseek','claude'])
  })
  it('拒绝重复、未知角色和不在集合内的代表；单角色 hash 不漂移', () => {
    const content = { name: '测试', description: '', commentary: '', tags: [], characterId: 'deepseek', categoryIds: ['meme'] }
    const vocab = { characterIds: new Set(['deepseek', 'claude']), categoryIds: new Set(['meme']) }
    expect(validateContent(content, vocab).ok).toBe(true)
    for (const characterIds of [[], ['deepseek', 'deepseek'], ['unknown'], ['claude']]) expect(validateContent({ ...content, characterIds }, vocab).ok).toBe(false)
    expect(sourceHash({ ...content, characterIds: ['deepseek'] })).toBe(sourceHash(content))
    expect(sourceHash({ ...content, characterIds: ['deepseek', 'claude'] })).not.toBe(sourceHash(content))
  })
})

describe('持久化批量任务', () => {
  it('只排队；无前端请求时执行器继续写入，断点恢复不重复审计', async () => {
    await createWork('bulk_a'); await createWork('bulk_b')
    const job = await enqueue('write-fields', 'works', ['bulk_a', 'bulk_b'], { patch: { description: '统一说明' } })
    expect((await payload.find({ collection: 'works', where: { workId: { equals: 'bulk_a' } } })).docs[0].description).toBeNull()
    const first = await stepJob(request({}), job)
    expect(first.cursor).toBe(1); expect(first.status).toBe('running')
    // 重新从持久库读取模拟前端关闭、执行器重启后续跑。
    const stored = await payload.findByID({ collection: 'bulk-jobs', id: job.id, overrideAccess: true })
    const last = await stepJob(request({}), stored)
    expect(last.status).toBe('succeeded'); expect(last.results).toHaveLength(2)
    const duplicateStep = await stepJob(request({}), stored)
    expect(duplicateStep.cursor).toBe(2)
    expect((await payload.find({ collection: 'audit-events', where: { and: [{ action: { equals: 'bulk.write-fields' } }, { targetId: { in: ['bulk_a', 'bulk_b'] } }] } })).totalDocs).toBe(2)
  })
  it('批量修改投稿草稿后同步不会覆盖原字段和 AI 结论', async () => {
    const doc = await createSubmission('sub_editorial', { review: { verdict: 'manual', reason: 'AI 原结论' } })
    const job = await enqueue('write-fields', 'submissions', [doc.submissionId], { patch: { commentary: '人工草稿点评' } })
    const done = await stepJob(request({}), job)
    expect(done.status).toBe('succeeded')
    const saved = await payload.findByID({ collection: 'submissions', id: doc.id, overrideAccess: true })
    expect(saved.editorial.commentary).toBe('人工草稿点评'); expect(saved.review).toEqual(doc.review); expect(saved.fields).toEqual(doc.fields)
  })
  it('并发编辑不覆盖；逐条错误隔离，并可重试失败项', async () => {
    const one = await createWork('race_a'); await createWork('race_b')
    const job = await enqueue('write-fields', 'works', ['race_a', 'race_b'], { patch: { commentary: '批量点评' } })
    await payload.update({ collection: 'works', id: one.id, data: { commentary: '人工新点评' }, overrideAccess: true, context: { audit: false } })
    const next = await stepJob(request({}), job); const end = await stepJob(request({}), next)
    expect(end.status).toBe('partial'); expect(end.results[0].status).toBe('failed'); expect(end.results[1].status).toBe('succeeded')
    const retry = await retryBulkJob(request({ jobId: job.jobId })); expect(retry.status).toBe(202)
    const retried = (await payload.find({ collection: 'bulk-jobs', where: { jobId: { equals: (await retry.json()).job.jobId } }, overrideAccess: true })).docs[0]
    await cancelBulkJob(request({ jobId: retried.jobId }))
  })
  it('明确确认后才收录；缺译文失败；收录与关联在同一事务中', async () => {
    const content = { name: '看图确认', description: '画面说明', commentary: '人工点评', characterId: 'deepseek', categoryIds: ['meme'], tags: ['测试'] }
    const doc = await createSubmission('sub_include', { sha256: crypto.createHash('sha256').update(imageBytes).digest('hex'), editorial: { ...content, i18n: { sourceHash: sourceHash({ ...content, origin: {}, license: {} }), ...fixtureI18n(content.tags) } } })
    expect((await createBulkJob(request({ operation: 'manual-include', target: 'submissions', ids: [doc.submissionId] }))).status).toBe(400)
    const job = await enqueue('manual-include', 'submissions', [doc.submissionId], { confirm: 'MANUAL_INCLUDE' })
    const fetchImpl = globalThis.fetch
    process.env.SUBMISSION_ADMIN_TOKEN = 'offline-test-token'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(imageBytes))))
    let end: any
    try { end = await stepJob(request({}), job) } finally { vi.stubGlobal('fetch', fetchImpl); delete process.env.SUBMISSION_ADMIN_TOKEN }
    expect(end.status).toBe('succeeded')
    const saved = await payload.findByID({ collection: 'submissions', id: doc.id, depth: 1, overrideAccess: true })
    expect(saved.state).toBe('needs_manual'); expect(saved.work.status).toBe('pending'); expect(saved.work.needsPublish).toBe(true)
    const bad = await createSubmission('sub_no_i18n', { sha256: 'c'.repeat(64), editorial: content })
    const failed = await stepJob(request({}), await enqueue('manual-include', 'submissions', [bad.submissionId], { confirm: 'MANUAL_INCLUDE' }))
    expect(failed.status).toBe('failed'); expect(failed.results[0].message).toContain('翻译')
  })
  it('Hermes 工具分阶段保存译文；校验失败保留草稿，完成才写入作品', async () => {
    const content = { name: '中文标题', description: '中文说明', commentary: '中文点评', characterId: 'deepseek', categoryIds: ['meme'], tags: ['测试'] }
    const doc = await createWork('translate_a', { name: content.name, description: content.description, commentary: content.commentary, tags: [{ value: '测试' }] })
    const job = await enqueue('translate', 'works', [doc.workId])
    process.env.ADMIN_WORKER_TOKEN='agent-test-token'
    const call = async (body:any) => {
      const response=await agentHandler({...request({jobId:job.jobId,id:doc.workId,...body}),headers:new Headers({authorization:'Bearer agent-test-token'})})
      return {status:response.status,...await response.json()}
    }
    try {
      const claimed=await call({action:'claim'})
      expect(claimed.status).toBe(200)
      const auth={token:claimed.token}
      const imageResponse=await agentHandler({...request({jobId:job.jobId,id:doc.workId,...auth,action:'image'}),headers:new Headers({authorization:'Bearer agent-test-token'})})
      expect(imageResponse.headers.get('content-type')).toBe('image/png')
      const draft=await call({action:'draft',...auth,content})
      expect(draft.status).toBe(200)
      const i18n=fixtureI18n(content.tags), hash=draft.draft.i18n.sourceHash
      expect((await call({action:'locale',...auth,language:'en',sourceHash:hash,content:i18n.en})).status).toBe(200)
      const bad={...i18n.ja,tags:[]}
      expect((await call({action:'locale',...auth,language:'ja',sourceHash:hash,content:bad})).status).toBe(422)
      expect((await payload.findByID({collection:'works',id:doc.id,overrideAccess:true})).legacyData?.i18n).toBeUndefined()
      expect((await call({action:'locale',...auth,language:'ja',sourceHash:hash,content:i18n.ja})).status).toBe(200)
      const done=await call({action:'complete',...auth})
      expect(done.result.status).toBe('succeeded')
      const saved=await payload.findByID({collection:'works',id:doc.id,overrideAccess:true})
      expect(saved.legacyData.i18n.en).toEqual(i18n.en);expect(saved.name).toBe(content.name)
      expect((await call({action:'complete',...auth})).status).toBe(409)
    } finally {delete process.env.ADMIN_WORKER_TOKEN}
  })
  it('人工收录在一个任务里补齐译文，日文失败后保留英文并原位续做',async()=>{
    const content={name:'统一收录标题',description:'人工说明',commentary:'人工点评',characterId:'deepseek',characterIds:['deepseek'],categoryIds:['meme'],tags:['测试']}
    const originalBytes=await sharp({create:{width:13,height:13,channels:3,background:'#117733'}}).png().toBuffer()
    const doc=await createSubmission('sub_one_click',{sha256:crypto.createHash('sha256').update(originalBytes).digest('hex'),editorial:content})
    const job=await enqueue('manual-include','submissions',[doc.submissionId],{confirm:'MANUAL_INCLUDE'})
    const oldToken=process.env.ADMIN_WORKER_TOKEN,oldSubmissionToken=process.env.SUBMISSION_ADMIN_TOKEN
    process.env.ADMIN_WORKER_TOKEN='agent-flow-test';process.env.SUBMISSION_ADMIN_TOKEN='raw-flow-test'
    const headers=new Headers({authorization:'Bearer agent-flow-test'})
    const send=async(body:any)=>{const r=await agentHandler({...request({jobId:job.jobId,id:doc.submissionId,...body}),headers});return {status:r.status,...await r.json()}}
    const raw=globalThis.fetch;vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(originalBytes))))
    const clock=vi.spyOn(Date,'now');let now=Date.now();clock.mockImplementation(()=>now)
    try {
      const listed=await send({action:'list'});expect(listed.jobs.some((j:any)=>j.jobId===job.jobId)).toBe(true)
      let claim=await send({action:'claim'});let auth={token:claim.token}
      expect((await agentHandler({...request({jobId:job.jobId,id:doc.submissionId,...auth,action:'image'}),headers})).status).toBe(200)
      const draft=await send({action:'draft',...auth,content});const hash=draft.draft.i18n.sourceHash,locales=fixtureI18n(content.tags)
      expect((await send({action:'locale',...auth,language:'en',sourceHash:hash,content:locales.en})).status).toBe(200)
      expect((await send({action:'locale',...auth,language:'ja',sourceHash:hash,content:{...locales.ja,tags:[]}})).status).toBe(422)
      expect((await payload.findByID({collection:'submissions',id:doc.id,overrideAccess:true})).work).toBeFalsy()
      await send({action:'release',...auth,reason:'模拟日文失败'});now+=6*60*1000
      claim=await send({action:'claim'});auth={token:claim.token};expect(claim.draft.i18n.en).toEqual(locales.en)
      await agentHandler({...request({jobId:job.jobId,id:doc.submissionId,...auth,action:'image'}),headers})
      await send({action:'locale',...auth,language:'ja',sourceHash:hash,content:locales.ja})
      const end=await send({action:'complete',...auth});expect(end.result.status).toBe('succeeded')
      const saved=await payload.findByID({collection:'submissions',id:doc.id,depth:1,overrideAccess:true})
      expect(saved.work.status).toBe('pending');expect(saved.work.legacyData.i18n.en).toEqual(locales.en);expect(saved.review).toEqual(doc.review)
    } finally {clock.mockRestore();vi.stubGlobal('fetch',raw);if(oldToken===undefined)delete process.env.ADMIN_WORKER_TOKEN;else process.env.ADMIN_WORKER_TOKEN=oldToken;if(oldSubmissionToken===undefined)delete process.env.SUBMISSION_ADMIN_TOKEN;else process.env.SUBMISSION_ADMIN_TOKEN=oldSubmissionToken}
  })
  it('单条空白草稿可以排队；Agent 无权覆盖已有人工字段', async () => {
    const doc=await createSubmission('sub_empty_draft')
    const draft={name:'',description:'',commentary:'',characterId:'deepseek',categoryIds:[],tags:[]}
    const job=await enqueue('ai-fill','submissions',[doc.submissionId],{drafts:{[doc.submissionId]:draft},suggestOnly:true})
    expect(job.options.drafts[doc.submissionId]).toEqual(draft)
    const work=await createWork('protected_agent',{description:'人工说明',commentary:'人工点评',tags:[{value:'测试'}]})
    const protectedJob=await enqueue('translate','works',[work.workId])
    process.env.ADMIN_WORKER_TOKEN='agent-test-token'
    try {
      const send=async(body:any)=>agentHandler({...request({jobId:protectedJob.jobId,id:work.workId,...body}),headers:new Headers({authorization:'Bearer agent-test-token'})})
      const claimed=await (await send({action:'claim'})).json()
      const auth={token:claimed.token}
      expect((await send({action:'image',...auth})).status).toBe(200)
      const changed={...claimed.draft,name:'恶意覆盖'};delete changed.origin;delete changed.license
      expect((await send({action:'draft',...auth,content:changed})).status).toBe(422)
      await cancelBulkJob(request({jobId:protectedJob.jobId}))
      expect((await send({action:'locale',...auth,language:'en',sourceHash:'stale',content:{}})).status).toBe(409)
      expect((await payload.findByID({collection:'works',id:work.id,overrideAccess:true})).name).toBe(work.name)
    } finally {delete process.env.ADMIN_WORKER_TOKEN}
    await cancelBulkJob(request({jobId:job.jobId}))
  })

  it('单条数据库写入失败会回滚本条并继续后续条目', async () => {
    await createWork('db_fail_a'); await createWork('db_fail_b')
    const job = await enqueue('write-fields', 'works', ['db_fail_a', 'db_fail_b'], { patch: { description: '数据库回滚测试' } })
    const originalUpdate = payload.update.bind(payload)
    const spy = vi.spyOn(payload, 'update').mockImplementation(async (args: any) => {
      if (args.collection === 'works') throw new Error('模拟单条校验失败')
      return originalUpdate(args)
    })
    let next: any
    try { next = await stepJob(request({}), job) } finally { spy.mockRestore() }
    expect(next.cursor).toBe(1); expect(next.results[0].status).toBe('failed')
    const done = await stepJob(request({}), next)
    expect(done.status).toBe('partial'); expect(done.results[1].status).toBe('succeeded')
  })

  it('取消任务不再写入；机器人不能调用任何批量任务入口', async () => {
    await createWork('cancel_a')
    const job = await enqueue('write-fields', 'works', ['cancel_a'], { patch: { description: '不应写入' } })
    await cancelBulkJob(request({ jobId: job.jobId }))
    expect((await stepJob(request({}), job)).status).toBe('cancelled')
    expect((await createBulkJob(request({ operation: 'write-fields', target: 'works', ids: ['cancel_a'] }, bot))).status).toBe(403)
    expect((await createBulkJob(request({ operation: 'write-fields', target: 'works', ids: ['cancel_a'], patch: { slug: 'bad' } }))).status).toBe(400)
  })
  it('申请使用真实 SQLite：并发领取拒绝，补充作者后等待原发布任务且保留匿名投稿', async () => {
    const oldToken = process.env.ADMIN_WORKER_TOKEN
    process.env.ADMIN_WORKER_TOKEN = 'rights-worker'
    const issue = { number: 142, title: '[署名/删除]', state: 'open', labels: [{ name: 'takedown' }], user: { login: 'creator' }, body: 'https://xn--pssy23gqgbz2d718b.com/works/rights-fixed.html\n作者小鱼' }
    const base = { name: 'rights', description: '画面说明', commentary: '让我看看', characterId: 'deepseek', categoryIds: ['meme'], tags: [], origin: { issue: 99 }, license: { type: 'submitter-permission' } }
    const saved = await createWork('rights_case', { ...base, slug: 'rights-fixed', tags: [], submitter: { credit: 'anonymous' }, legacyData: { i18n: { sourceHash: sourceHash(base), ...fixtureI18n(base.tags) } } })
    const record = await payload.create({ collection: 'takedown-requests', data: { requestId: 'github-rights-142', requestType: 'attribution', status: 'received', issueData: issueSnapshot(issue), agentProgress: { stage: 'queued', attempt: 0 } }, overrideAccess: true, context: { audit: false } })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/comments') ? [] : url.endsWith('/99') ? { user: { login: 'creator' } } : issue)))
    const call = (action: string, extra: any = {}) => requestAgentHandler({ payload, headers: new Headers({ authorization: 'Bearer rights-worker' }), json: async () => ({ action, id: record.requestId, ...extra }) } as any)
    try {
      const claim = await (await call('claim')).json()
      expect(claim.ok).toBe(true)
      expect((await call('claim')).status).toBe(409)
      expect((await call('draft', { token: claim.token, decision: { verdict: 'apply', requestType: 'attribution', patch: { author: '小鱼' }, quote: '作者小鱼', reason: '原投稿账号补充作者' } })).status).toBe(200)
      expect((await call('complete', { token: claim.token })).status).toBe(200)
      const result = await payload.findByID({ collection: 'works', id: saved.id, depth: 0, overrideAccess: true })
      expect(result).toMatchObject({ slug: 'rights-fixed', origin: { author: '小鱼', issue: 99 }, submitter: { credit: 'anonymous' }, status: 'published', needsPublish: true })
      const after = await payload.findByID({ collection: 'takedown-requests', id: record.id, depth: 0, overrideAccess: true })
      expect(after).toMatchObject({ status: 'approved', agentProgress: { stage: 'awaiting_publish', token: null } })
    } finally { vi.unstubAllGlobals(); if (oldToken === undefined) delete process.env.ADMIN_WORKER_TOKEN; else process.env.ADMIN_WORKER_TOKEN = oldToken }
  })

})
