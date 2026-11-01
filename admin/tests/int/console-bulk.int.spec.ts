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
import { consoleList, consoleAuthors, consoleCounts, consoleCount, parseConsoleQuery } from '@/lib/console-list'
import { buildPublishPlan } from '@/lib/publish'
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
import { addTopicMemberships, createQuickTopic, removeTopicMemberships, undoMemberships, findTopic } from '@/lib/topics-membership'
import { topicSourceHash } from '@/lib/topics-translation'
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
      const pending=await (await listTasks({...request({}),url:'http://localhost/?kind=publish&group=intervene'})).json()
      expect(pending.docs.map((d:any)=>d.sourceId)).toEqual(['history-current-failed'])
      const handled=await (await listTasks({...request({}),url:'http://localhost/?task=history-failed&group=history'})).json()
      expect(handled.docs[0].stage).toBe('superseded')
      expect((await payload.findByID({collection:'publish-runs',id:failed.id,overrideAccess:true})).status).toBe('failed')
    }finally{for(const doc of [failed,current,success])await payload.delete({collection:'publish-runs',id:doc.id,overrideAccess:true,context:{audit:false}})}
  })

  it('拒绝访客和受限机器人，站长可查看多来源任务与分页', async () => {
    expect((await listTasks({...request({}),user:null})).status).toBe(401)
    expect((await listTasks(request({},bot))).status).toBe(403)
    const doc=await createSubmission('sub_task_unified')
    const job=await enqueue('manual-include','submissions',[doc.submissionId],{confirm:'MANUAL_INCLUDE'})
    const result=await (await listTasks({...request({}),url:'http://localhost/?group=processing'})).json()
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
    expect((await consoleList(payload, query('kind=submissions&state=needs_review'))).totalDocs).toBe(1)
    expect((await consoleList(payload, query('kind=submissions&state=published'))).totalDocs).toBe(1)
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
    const list = await consoleList(payload, query('character=claude'))
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

describe('后台工作流语义回归', () => {
  it('投稿生命周期每个 mode 都有入口，列表与计数一致', async () => {
    const pendingWork = await createWork('life_work_pending', { status: 'published', needsPublish: true })
    const liveWork = await createWork('life_work_live', { status: 'published', needsPublish: false })
    const hiddenWork = await createWork('life_work_hidden', { status: 'hidden', needsPublish: false })
    await createSubmission('life_decide')
    await createSubmission('life_processing', { state: 'received' })
    await createSubmission('life_auto', { state: 'auto_passed' })
    await createSubmission('life_failed', { state: 'publish_failed' })
    await createSubmission('life_rejected', { state: 'rejected' })
    await createSubmission('life_pending', { state: 'approved', work: pendingWork.id })
    await createSubmission('life_published', { state: 'published', work: liveWork.id })
    await createSubmission('life_hidden', { state: 'published', work: hiddenWork.id })
    const counts = await consoleCounts(payload, query('kind=submissions&keyword=life_'))
    expect(counts).toMatchObject({ all: 8, needs_review: 1, processing: 2, blocked: 1, rejected: 1, needs_publish: 1, published: 1, hidden: 1 })
    for (const state of ['needs_review', 'processing', 'blocked', 'rejected', 'needs_publish', 'published', 'hidden']) {
      const list = await consoleList(payload, query(`kind=submissions&state=${state}&keyword=life_`))
      expect(list.totalDocs).toBe(counts[state])
      expect(await consoleCount(payload, query(`kind=submissions&state=${state}&keyword=life_`))).toBe(counts[state])
    }
  })

  it('待发布复用发布计划口径，已上线投稿进历史且不依赖发布批次号', async () => {
    const live = await createWork('mutex_live', { status: 'published', needsPublish: true })
    await createWork('mutex_fresh', { status: 'pending', needsPublish: true })
    const done = await createWork('mutex_done', { status: 'published', needsPublish: false })
    await createSubmission('mutex_linked', { state: 'auto_rejected', work: live.id })
    await createSubmission('mutex_done_sub', { state: 'auto_passed', work: done.id })
    await createSubmission('mutex_auto', { state: 'auto_passed' })
    await createSubmission('mutex_rejected', { state: 'rejected' })
    const tasks = await (await listTasks({ ...request({}), url: 'http://localhost/?keyword=mutex' })).json()
    const publish = await (await listTasks({ ...request({}), url: 'http://localhost/?group=publish&keyword=mutex' })).json()
    const content = publish.docs.filter((row: any) => row.unit === 'content')
    expect(content).toHaveLength(2)
    expect(content.every((row: any) => row.group === 'publish' && row.kind === 'content')).toBe(true)
    const liveRow = content.find((row: any) => row.title === 'mutex_live')
    const freshRow = content.find((row: any) => row.title === 'mutex_fresh')
    expect(liveRow).toMatchObject({ liveVersion: true, content: { state: 'pending_publish', needsPublish: true, liveVersion: true } })
    expect(freshRow).toMatchObject({ liveVersion: false, content: { state: 'pending_publish', needsPublish: true, liveVersion: false } })
    expect(tasks.docs.some((row: any) => row.sourceId === 'mutex_linked')).toBe(false)
    const doneRow = tasks.docs.find((row: any) => row.sourceId === 'mutex_done_sub')
    expect(doneRow).toMatchObject({ group: 'history', content: { state: 'published', liveVersion: true, lastPublishRun: null } })
    expect(tasks.docs.find((row: any) => row.sourceId === 'mutex_auto')).toMatchObject({ group: 'processing', stage: 'auto_passed' })
    expect(publish.counts.content.publish).toBe(2)
    expect(publish.counts.publish).toBe(2)
    expect(publish.counts.tasks.all).toBe(3)
    expect(publish.counts.all).toBe(3)
    expect(publish.totalDocs).toBe(2)
    expect(publish.docs.every((row: any) => row.unit === 'content')).toBe(true)
    expect(tasks.docs.every((row: any) => row.unit === 'task')).toBe(true)
  })

  it('活跃人工收录任务覆盖投稿，不再同时在审核待处理', async () => {
    const doc = await createSubmission('dedupe_active', { state: 'needs_manual' })
    const job = await enqueue('manual-include', 'submissions', [doc.submissionId], { confirm: 'MANUAL_INCLUDE' })
    const duplicate = await createBulkJob(request({ operation: 'manual-include', target: 'submissions', ids: [doc.submissionId], confirm: 'MANUAL_INCLUDE' }))
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).job.jobId).toBe(job.jobId)
    const tasks = await (await listTasks({ ...request({}), url: 'http://localhost/?keyword=dedupe_active' })).json()
    expect(tasks.docs.some((row: any) => row.kind === 'submission')).toBe(false)
    const jobRow = await (await listTasks({ ...request({}), url: `http://localhost/?task=${job.jobId}` })).json()
    expect(jobRow.docs[0]).toMatchObject({ kind: 'bulk', group: 'processing', unit: 'task' })
    expect(jobRow.docs[0].job).toMatchObject({ jobId: job.jobId, status: 'queued' })
    const processing = await consoleList(payload, query('kind=submissions&state=processing&keyword=dedupe_active'))
    expect(processing.totalDocs).toBe(1)
    expect(processing.docs[0]).toMatchObject({ activity: 'processing', activeJob: { jobId: job.jobId, status: 'queued' } })
    expect((await consoleList(payload, query('kind=submissions&state=needs_review&keyword=dedupe_active'))).totalDocs).toBe(0)
    await cancelBulkJob(request({ jobId: job.jobId }))
    const decide = await consoleList(payload, query('kind=submissions&state=needs_review&keyword=dedupe_active'))
    expect(decide.totalDocs).toBe(1)
    expect(decide.docs[0].activeJob).toBeNull()
    const restored = await (await listTasks({ ...request({}), url: 'http://localhost/?keyword=dedupe_active' })).json()
    expect(restored.docs[0]).toMatchObject({ kind: 'submission', group: 'decide', owner: 'owner' })
  })

  it('重试链只让最新子任务承载待办，祖先保留失败结果', async () => {
    const createJob = async (jobId: string, status: string, options: any = {}) =>
      payload.create({ collection: 'bulk-jobs', data: { jobId, operation: 'write-fields', target: 'works', status, ids: ['retry_item'], cursor: 0, results: status === 'failed' ? [{ id: 'retry_item', status: 'failed', error: '构建失败' }] : [], options, requestedBy: owner.id }, overrideAccess: true, context: { audit: false } })
    const parent = await createJob('retry_parent', 'failed', { agent: { stage: 'failed' } })
    let row = (await (await listTasks({ ...request({}), url: 'http://localhost/?task=retry_parent' })).json()).docs[0]
    expect(row).toMatchObject({ group: 'intervene', canRetry: true, retriedBy: null })
    await createJob('retry_child', 'queued', { retryOf: parent.jobId, agent: { stage: 'queued' } })
    row = (await (await listTasks({ ...request({}), url: 'http://localhost/?task=retry_parent' })).json()).docs[0]
    expect(row).toMatchObject({ group: 'history', canRetry: false, nextAction: '查看子任务' })
    expect(row.retriedBy).toMatchObject({ jobId: 'retry_child', status: 'queued' })
    expect(row.href).toBe('/admin?task=retry_child&kind=bulk')
    const child = (await (await listTasks({ ...request({}), url: 'http://localhost/?task=retry_child' })).json()).docs[0]
    expect(child).toMatchObject({ group: 'processing', canRetry: false, retryOf: 'retry_parent' })
    await payload.update({ collection: 'bulk-jobs', where: { jobId: { equals: 'retry_child' } }, data: { status: 'failed', results: [{ id: 'retry_item', status: 'failed', error: '再次失败' }] }, overrideAccess: true, context: { audit: false } })
    await createJob('retry_grandchild', 'queued', { retryOf: 'retry_child', agent: { stage: 'queued' } })
    const parentAfter = (await (await listTasks({ ...request({}), url: 'http://localhost/?task=retry_parent' })).json()).docs[0]
    const childAfter = (await (await listTasks({ ...request({}), url: 'http://localhost/?task=retry_child' })).json()).docs[0]
    expect(parentAfter.group).toBe('history')
    expect(childAfter).toMatchObject({ group: 'history', canRetry: false, retriedBy: { jobId: 'retry_grandchild' } })
    expect((await (await listTasks({ ...request({}), url: 'http://localhost/?task=retry_grandchild' })).json()).docs[0].group).toBe('processing')
    await payload.update({ collection: 'bulk-jobs', where: { jobId: { equals: 'retry_grandchild' } }, data: { status: 'cancelled' }, overrideAccess: true, context: { audit: false } })
    const childFinal = (await (await listTasks({ ...request({}), url: 'http://localhost/?task=retry_child' })).json()).docs[0]
    expect(childFinal).toMatchObject({ group: 'intervene', canRetry: true, retriedBy: null })
    expect((await (await listTasks({ ...request({}), url: 'http://localhost/?task=retry_parent' })).json()).docs[0].group).toBe('history')
  })

  it('只有带依据的 retry 才显示自动等待，blocked 不承诺自动恢复', async () => {
    const createJob = async (jobId: string, status: string, stage: string, retryAt = 0) =>
      payload.create({ collection: 'bulk-jobs', data: { jobId, operation: 'write-fields', target: 'works', status, ids: ['evidence_item'], cursor: 0, results: [], options: { agent: { stage, retryAt } }, requestedBy: owner.id }, overrideAccess: true, context: { audit: false } })
    await createJob('evidence_blocked', 'queued', 'blocked')
    await createJob('evidence_retry_ok', 'queued', 'retry', Date.now() + 60_000)
    await createJob('evidence_retry_unknown', 'queued', 'retry')
    await createJob('evidence_done', 'succeeded', 'ready')
    const get = async (id: string) => (await (await listTasks({ ...request({}), url: `http://localhost/?task=${id}` })).json()).docs[0]
    expect(await get('evidence_blocked')).toMatchObject({ group: 'intervene', blocked: true, canRetry: true, autoRetryAt: null, nextAction: '查看失败项并重试' })
    const retryOk = await get('evidence_retry_ok')
    expect(retryOk).toMatchObject({ group: 'processing', autoRetryAt: expect.any(Number), nextAction: '等待自动重试', blocked: false })
    expect(await get('evidence_retry_unknown')).toMatchObject({ group: 'intervene', autoRetryAt: null, stageLabel: '自动重试待确认' })
    expect(await get('evidence_done')).toMatchObject({ group: 'history', nextAction: '查看结果' })
  })

  it('GIF/格式未知按原图语义过滤，稳定角色与类型跨作品/投稿一致', async () => {
    const gif = await createWork('fmt_gif_hist', { format: 'gif', mimeType: 'image/png', isAnimated: false, needsPublish: true, legacyPaths: { path: 'submissions/fmt_wrong.png' } })
    await createWork('fmt_anim_png', { format: 'png', mimeType: 'image/png', isAnimated: true })
    await createWork('fmt_static_webp', { format: 'webp', mimeType: 'image/webp', isAnimated: true })
    await createWork('fmt_unknown', { format: '', mimeType: '', legacyPaths: { path: '' } })
    const gifSub = await createSubmission('fmt_sub_gif', { state: 'published', work: gif.id })
    await createSubmission('fmt_sub_unknown')
    const gifWorks = await consoleList(payload, query('kind=works&format=gif&keyword=fmt_'))
    expect(gifWorks.docs.map((row: any) => row.workId)).toEqual(['fmt_gif_hist'])
    expect(gifWorks.docs[0]).toMatchObject({ format: 'gif', isAnimated: false })
    expect((await consoleList(payload, query('kind=works&format=static&keyword=fmt_'))).docs.map((row: any) => row.workId).sort()).toEqual(['fmt_anim_png', 'fmt_static_webp'])
    expect((await consoleList(payload, query('kind=works&format=unknown&keyword=fmt_'))).docs.map((row: any) => row.workId)).toEqual(['fmt_unknown'])
    expect((await consoleList(payload, query('kind=submissions&format=gif&keyword=fmt_sub'))).docs.map((row: any) => row.submissionId)).toEqual([gifSub.submissionId])
    expect((await consoleList(payload, query('kind=submissions&format=unknown&keyword=fmt_sub'))).docs.map((row: any) => row.submissionId)).toEqual(['fmt_sub_unknown'])
    expect((await consoleList(payload, query('kind=works&character=deepseek&type=meme&keyword=fmt_'))).totalDocs).toBe(4)
    expect((await consoleList(payload, query('kind=submissions&character=deepseek&type=meme&keyword=fmt_sub'))).totalDocs).toBe(2)
    const counts = await consoleCounts(payload, query('kind=works&format=gif&keyword=fmt_'))
    expect(counts.all).toBe(1)
    expect(counts.needs_publish).toBe(1)
    const rows = await consoleList(payload, query('kind=works&keyword=fmt_'))
    expect(rows.docs.every((row: any) => row.activeJob === null)).toBe(true)
  })

  it('任务行批次字段来自真实任务，可按 batch/sourceKind 过滤', async () => {
    await createWork('batch_work')
    const created = await createBulkJob(request({ operation: 'write-fields', target: 'works', ids: ['batch_work'], patch: { commentary: '批次测试' }, batchId: 'cli-batch-1', batchLabel: '本地批次', sourceKind: 'bulk-worker' }))
    expect(created.status).toBe(202)
    const job = (await created.json()).job
    const row = (await (await listTasks({ ...request({}), url: `http://localhost/?task=${job.jobId}` })).json()).docs[0]
    expect(row).toMatchObject({ batchId: 'cli-batch-1', batchLabel: expect.stringContaining('本地批次'), sourceKind: 'bulk-worker', sourceLabel: '后台执行器' })
    const filtered = await (await listTasks({ ...request({}), url: 'http://localhost/?group=processing&batch=cli-batch-1' })).json()
    expect(filtered.docs.map((item: any) => item.sourceId)).toContain(job.jobId)
    const bySource = await (await listTasks({ ...request({}), url: 'http://localhost/?group=processing&sourceKind=bulk-worker' })).json()
    expect(bySource.batches?.some((batch: any) => batch.batchId === 'cli-batch-1')).toBe(true)
    await cancelBulkJob(request({ jobId: job.jobId }))
  })

  it('空 agent stage 回退真实状态，不把排队任务显示成未知状态', async () => {
    await createWork('stage_real')
    const job = await enqueue('ai-fill', 'works', ['stage_real'])
    const read = async () => (await (await listTasks({ ...request({}), url: `http://localhost/?task=${job.jobId}` })).json()).docs[0]
    expect(await read()).toMatchObject({ stage: 'queued', stageLabel: '排队中', status: 'queued' })
    await payload.update({ collection: 'bulk-jobs', where: { jobId: { equals: job.jobId } }, data: { options: { ...job.options, agent: { ...(job.options.agent || {}), stage: '' } } }, overrideAccess: true, context: { audit: false } })
    expect(await read()).toMatchObject({ stage: 'queued', stageLabel: '排队中', status: 'queued' })
    const doc = await createSubmission('stage_empty_sub', { state: 'received', agentProgress: { stage: '' } })
    const submission = (await (await listTasks({ ...request({}), url: `http://localhost/?task=${doc.submissionId}` })).json()).docs[0]
    expect(submission).toMatchObject({ stage: 'received', stageLabel: '已收到', group: 'processing' })
    await cancelBulkJob(request({ jobId: job.jobId }))
  })

  it('唯一处理状态由最新任务决定，失败不会被旧任务永久压住，也不伪造线上版本', async () => {
    const work = await createWork('state_priority', { status: 'published', needsPublish: false })
    const createJob = async (jobId: string, status: string, options: any = {}) =>
      payload.create({ collection: 'bulk-jobs', data: { jobId, operation: 'write-fields', target: 'works', status, ids: [work.workId], cursor: 0, results: status === 'failed' ? [{ id: work.workId, status: 'failed', message: '失败' }] : [], options, requestedBy: owner.id }, overrideAccess: true, context: { audit: false } })
    await createJob('state_failed', 'failed')
    let row = (await consoleList(payload, query('kind=works&keyword=state_priority'))).docs[0]
    expect(row).toMatchObject({ processingState: 'blocked', activeJob: null, liveVersion: true })
    await createJob('state_queued', 'queued')
    row = (await consoleList(payload, query('kind=works&keyword=state_priority'))).docs[0]
    expect(row).toMatchObject({ processingState: 'processing', activeJob: { jobId: 'state_queued' }, liveVersion: true })
    await payload.update({ collection: 'bulk-jobs', where: { jobId: { equals: 'state_queued' } }, data: { status: 'succeeded' }, overrideAccess: true, context: { audit: false } })
    row = (await consoleList(payload, query('kind=works&keyword=state_priority'))).docs[0]
    expect(row).toMatchObject({ processingState: 'published', activeJob: null })
    const removed = await createWork('state_removed_no_live', { status: 'removed', needsPublish: true })
    expect((await consoleList(payload, query('kind=works&keyword=state_removed_no_live'))).docs[0]).toMatchObject({
      processingState: 'needs_publish', liveVersion: false, targetStatus: 'removed',
    })
    const hidden = await createWork('state_hidden_live', { status: 'hidden', needsPublish: true, lastPublishedAt: '2026-10-01T00:00:00.000Z' })
    expect((await consoleList(payload, query('kind=works&keyword=state_hidden_live'))).docs[0]).toMatchObject({
      processingState: 'needs_publish', liveVersion: true, targetStatus: 'hidden',
    })
    expect(((await consoleList(payload, query('kind=works&keyword=state_removed_no_live'))).docs[0] as any).workId).toBe(removed.workId)
  })

  it('专题成员原子加入、幂等、可撤销且保护既有成员与封面', async () => {
    const a = await createWork('member_a')
    const b = await createWork('member_b')
    const c = await createWork('member_c')
    const free = await createWork('member_free')
    const topic = await payload.create({ collection: 'topics', data: { topicId: 'member-topic', name: '成员专题', summary: '成员', status: 'draft', works: [b.id], cover: b.id, order: 1 }, overrideAccess: true, context: { audit: false } })
    const req = { ...request({}), user: owner }
    const first = await addTopicMemberships(payload, topic, [a.workId, b.workId, a.workId], req as any)
    expect(first).toMatchObject({ added: [a.workId], already: [b.workId], failed: [] })
    const after = await payload.findByID({ collection: 'topics', id: topic.id, depth: 0, overrideAccess: true })
    expect(after.works.map(Number)).toEqual([Number(b.id), Number(a.id)])
    const undo = await undoMemberships(payload, first.undoToken!, req as any)
    expect(undo.removed).toEqual([a.workId])
    let current = await payload.findByID({ collection: 'topics', id: topic.id, depth: 0, overrideAccess: true })
    expect(current.works.map(Number)).toEqual([Number(b.id)])
    expect(Number(current.cover)).toBe(Number(b.id))
    const coverAttempt = await removeTopicMemberships(payload, current, [b.workId], req as any)
    expect(coverAttempt.removed).toEqual([])
    expect(coverAttempt.kept[0].error).toContain('封面')
    const concurrent = await Promise.all([
      addTopicMemberships(payload, current, [a.workId], req as any),
      addTopicMemberships(payload, current, [c.workId], req as any),
    ])
    expect(concurrent.flatMap((item) => item.added).sort()).toEqual([a.workId, c.workId])
    current = await payload.findByID({ collection: 'topics', id: topic.id, depth: 0, overrideAccess: true })
    expect(current.works.map(Number).sort()).toEqual([Number(a.id), Number(b.id), Number(c.id)].sort())
    expect((await addTopicMemberships(payload, current, ['missing_work'], req as any)).failed[0].id).toBe('missing_work')
    const quick = await createQuickTopic(payload, { topicId: 'quick-draft-topic', name: '快捷专题', summary: '', workIds: [a.workId] }, req as any)
    expect(quick.created).toBe(true)
    expect(quick.topic).toMatchObject({ topicId: 'quick-draft-topic', name: '快捷专题', summary: '', status: 'draft' })
    expect(quick.membership.added).toEqual([a.workId])
    expect((await consoleList(payload, query('kind=works&topic=none&keyword=member_'))).docs.map((row: any) => row.workId)).toEqual([free.workId])
    expect((await consoleList(payload, query('kind=works&topic=member-topic'))).docs[0].topicIds).toContain('member-topic')
  })

  it('专题译文任务真实排队、校验 sourceHash，并保护人工字段与成员', async () => {
    const topic = await payload.create({ collection: 'topics', data: { topicId: 'translate-topic-a', name: '翻译专题', summary: '中文简介', status: 'draft', works: [], order: 2 }, overrideAccess: true, context: { audit: false } })
    const sourceHash = topicSourceHash(topic.name, topic.summary)
    const created = await createBulkJob(request({ operation: 'translate-topic', target: 'topics', ids: [topic.topicId], baseUpdatedAt: topic.updatedAt, sourceHash }))
    expect(created.status).toBe(202)
    const job = (await created.json()).job
    expect(job).toMatchObject({ operation: 'translate-topic', target: 'topics', status: 'queued' })
    let read = await payload.findByID({ collection: 'topics', id: topic.id, depth: 0, overrideAccess: true })
    expect(read).toMatchObject({ translationState: 'queued', translationJobId: job.jobId })
    const headers = new Headers({ authorization: 'Bearer agent-test-token' })
    process.env.ADMIN_WORKER_TOKEN = 'agent-test-token'
    const call = async (body: any) => {
      const response = await agentHandler({ ...request({ jobId: job.jobId, id: topic.topicId, ...body }), headers } as any)
      return { status: response.status, ...(await response.json()) }
    }
    try {
    const topicJobs = await call({ action: 'list', target: 'topics' })
    const imageJobs = await call({ action: 'list', target: 'admin' })
    expect(topicJobs.jobs.some((item: any) => item.jobId === job.jobId)).toBe(true)
    expect(topicJobs.jobs.every((item: any) => item.target === 'topics')).toBe(true)
    expect(imageJobs.jobs.some((item: any) => item.jobId === job.jobId)).toBe(false)
    expect(imageJobs.jobs.every((item: any) => item.target !== 'topics')).toBe(true)
      const claim = await call({ action: 'claim', batchId: 'cron_review_1', sourceKind: 'hermes' })
      expect(claim.status).toBe(200)
      const member = await createWork('translate_member')
      await addTopicMemberships(payload, topic, [member.workId], request({}) as any)
      expect((await payload.findByID({ collection: 'topics', id: topic.id, depth: 0, overrideAccess: true })).translationState).toBe('running')
      const auth = { token: claim.token }
      expect((await call({ action: 'draft', ...auth, content: { name: '翻译专题', summary: '中文简介' } })).status).toBe(200)
      const en = await call({ action: 'locale', ...auth, language: 'en', sourceHash, content: { name: 'Translation Topic', summary: 'English summary' } })
      expect(en.status).toBe(200)
      const ja = await call({ action: 'locale', ...auth, language: 'ja', sourceHash, content: { name: '翻訳トピック', summary: '日本語の概要' } })
      expect(ja.status).toBe(200)
      const done = await call({ action: 'complete', ...auth })
      expect(done).toMatchObject({ ok: true })
    } finally {
      if (process.env.ADMIN_WORKER_TOKEN === 'agent-test-token') delete process.env.ADMIN_WORKER_TOKEN
    }
    read = await payload.findByID({ collection: 'topics', id: topic.id, depth: 0, overrideAccess: true })
    expect(read).toMatchObject({ name: '翻译专题', summary: '中文简介', nameEn: 'Translation Topic', summaryEn: 'English summary', nameJa: '翻訳トピック', summaryJa: '日本語の概要', translationState: 'ready' })
    expect(read.works).toEqual([expect.any(Number)])
    expect(read.topicId).toBe('translate-topic-a')
    expect(read.translationSourceHash).toBe(sourceHash)
    const task = (await (await listTasks({ ...request({}), url: `http://localhost/?task=${job.jobId}` })).json()).docs[0]
    expect(task).toMatchObject({ kind: 'bulk', sourceKind: 'hermes', batchId: 'cron_review_1' })
    const stale = await payload.update({ collection: 'topics', id: topic.id, data: { name: '中文已修改', needsPublish: true }, overrideAccess: true, context: { audit: false } })
    const queued = await createBulkJob(request({ operation: 'translate-topic', target: 'topics', ids: [topic.topicId], baseUpdatedAt: stale.updatedAt, sourceHash }))
    expect(queued.status).toBe(202)
    const staleJob = (await queued.json()).job
    const staleRead = await payload.findByID({ collection: 'topics', id: topic.id, depth: 0, overrideAccess: true })
    expect(staleRead.nameEn).toBe('Translation Topic')
    await payload.update({ collection: 'bulk-jobs', where: { jobId: { equals: staleJob.jobId } }, data: { status: 'cancelled' }, overrideAccess: true, context: { audit: false } })
  })

  it('翻译任务不能覆盖提交后的人工英日修改', async () => {
    const topic = await payload.create({ collection: 'topics', data: { topicId: 'translate-topic-conflict', name: '冲突专题', summary: '中文简介', status: 'draft', works: [], order: 3 }, overrideAccess: true, context: { audit: false } })
    const sourceHash = topicSourceHash(topic.name, topic.summary)
    const created = await createBulkJob(request({ operation: 'translate-topic', target: 'topics', ids: [topic.topicId], force: true, confirm: 'OVERWRITE', sourceHash }))
    expect(created.status).toBe(202)
    const job = (await created.json()).job
    process.env.ADMIN_WORKER_TOKEN = 'agent-test-token'
    const headers = new Headers({ authorization: 'Bearer agent-test-token' })
    const call = async (body: any) => {
      const response = await agentHandler({ ...request({ jobId: job.jobId, id: topic.topicId, ...body }), headers } as any)
      return { status: response.status, ...(await response.json()) }
    }
    try {
      const claim = await call({ action: 'claim' })
      expect(claim.status).toBe(200)
      await payload.update({ collection: 'topics', id: topic.id, data: { nameEn: '人工英文名' }, overrideAccess: true, context: { audit: false } })
      const auth = { token: claim.token }
      await call({ action: 'locale', ...auth, language: 'en', sourceHash, content: { name: 'AI English', summary: 'AI summary' } })
      await call({ action: 'locale', ...auth, language: 'ja', sourceHash, content: { name: 'AI 日本語', summary: 'AI 概要' } })
      const done = await call({ action: 'complete', ...auth })
      expect(done).toMatchObject({ ok: false })
      const read = await payload.findByID({ collection: 'topics', id: topic.id, depth: 0, overrideAccess: true })
      expect(read.nameEn).toBe('人工英文名')
      expect(read.translationState).toBe('failed')
    } finally {
      if (process.env.ADMIN_WORKER_TOKEN === 'agent-test-token') delete process.env.ADMIN_WORKER_TOKEN
    }
  })

  it('legacy 有译文但无 sourceHash 时改中文必须 stale，人工补齐后写回真实 hash', async () => {
    const topic = await payload.create({ collection: 'topics', data: { topicId: 'legacy-translation-topic', name: '旧中文', summary: '旧简介', nameEn: 'Old EN', summaryEn: 'Old summary', nameJa: '旧日本語', summaryJa: '旧概要', status: 'draft', works: [], order: 4 }, overrideAccess: true, context: { audit: false } })
    await payload.db.client.execute({ sql: "UPDATE topics SET translation_source_hash=NULL, translation_state='ready' WHERE id=?", args: [topic.id] })
    const changed = await payload.update({ collection: 'topics', id: topic.id, data: { name: '新中文', summary: '新简介', needsPublish: true }, overrideAccess: true, context: { audit: false } })
    expect(changed.translationState).toBe('stale')
    expect(changed.translationSourceHash || '').toBe('')
    expect(changed.nameEn).toBe('Old EN')
    const manual = await payload.update({ collection: 'topics', id: topic.id, data: { nameEn: 'New EN', summaryEn: 'New summary', nameJa: '新日本語', summaryJa: '新概要' }, overrideAccess: true, context: { audit: false } })
    expect(manual.translationState).toBe('ready')
    expect(manual.translationSourceHash).toBe(topicSourceHash('新中文', '新简介'))
    expect(manual.translationRevision).toBeGreaterThan(Number(topic.translationRevision || 0))
  })

  it('名称-only 专题不能创建永远做不完的翻译任务', async () => {
    const quick = await createQuickTopic(payload, { topicId: 'translate-empty-topic', name: '只有名称', summary: '', workIds: [] }, request({}) as any)
    expect(quick.topic.summary).toBe('')
    const refused = await createBulkJob(request({ operation: 'translate-topic', target: 'topics', ids: ['translate-empty-topic'], sourceHash: topicSourceHash('只有名称', '') }))
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toContain('缺少中文名称或简介')
    const jobs = await payload.find({ collection: 'bulk-jobs', where: { and: [{ target: { equals: 'topics' } }, { operation: { equals: 'translate-topic' } }] }, overrideAccess: true })
    expect(jobs.docs.some((job: any) => (job.ids || []).includes('translate-empty-topic'))).toBe(false)
    await payload.update({ collection: 'topics', id: quick.topic.id, data: { summary: '补全简介' }, overrideAccess: true, context: { audit: false } })
    const accepted = await createBulkJob(request({ operation: 'translate-topic', target: 'topics', ids: ['translate-empty-topic'], sourceHash: topicSourceHash('只有名称', '补全简介') }))
    expect(accepted.status).toBe(202)
    const job = (await accepted.json()).job
    await cancelBulkJob(request({ jobId: job.jobId }))
  })

  it('发布计划暴露 needsPublish、内容总数和真实排队批次', async () => {
    const work = await createWork('plan_needs_publish', { status: 'published', needsPublish: true })
    const topic = await payload.create({ collection: 'topics', data: { topicId: 'plan-topic', name: '计划专题', summary: '计划', status: 'draft', order: 99, works: [], needsPublish: true }, overrideAccess: true, context: { audit: false } })
    const creator = await payload.create({ collection: 'creators', data: { uid: 'plan-creator', homepage: 'https://space.example/1', name: '计划作者', intro: '简介', status: 'active', needsPublish: true }, overrideAccess: true, context: { audit: false } })
    const video = await payload.create({ collection: 'videos', data: { bvid: 'BVplan', creator: creator.id, title: '计划视频', source: { platform: 'bilibili' }, status: 'queued', needsPublish: true }, overrideAccess: true, context: { audit: false, skipNeedsPublish: true } })
    try {
      const plan = await buildPublishPlan(payload)
      const item = plan.updated.find((entry: any) => entry.workId === work.workId)
      expect(item).toMatchObject({ needsPublish: true, status: 'published' })
      expect(plan.topics.find((entry: any) => entry.topicId === 'plan-topic')).toMatchObject({ needsPublish: true })
      expect(plan.videos.find((entry: any) => entry.name === '计划视频')).toMatchObject({ id: video.id, kind: 'video' })
      expect(plan.videos.find((entry: any) => entry.name === '计划作者')).toMatchObject({ id: creator.id, kind: 'creator' })
      expect(plan.summary.contents).toBe(plan.added.length + plan.updated.length + plan.hidden.length + plan.restored.length + plan.deleted.length + plan.topics.length + plan.videos.length)
      expect(plan.pendingRun).toBeNull()
      const run = await payload.create({ collection: 'publish-runs', data: { runId: 'plan_pending_run', status: 'in_progress', step: 'build', trigger: 'manual' }, overrideAccess: true, context: { audit: false } })
      const withRun = await buildPublishPlan(payload)
      expect(withRun.pendingRun).toMatchObject({ runId: 'plan_pending_run', status: 'in_progress' })
      await payload.delete({ collection: 'publish-runs', id: run.id, overrideAccess: true, context: { audit: false } })
    } finally {
      await payload.delete({ collection: 'videos', id: video.id, overrideAccess: true, context: { audit: false } })
      await payload.delete({ collection: 'creators', id: creator.id, overrideAccess: true, context: { audit: false } })
      await payload.delete({ collection: 'topics', id: topic.id, overrideAccess: true, context: { audit: false } })
    }
  })
})
