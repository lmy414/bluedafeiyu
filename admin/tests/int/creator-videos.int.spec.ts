// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { buildConfig, getPayload } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Users } from '@/collections/Users'
import { Creators } from '@/collections/Creators'
import { Videos } from '@/collections/Videos'
import { Characters } from '@/collections/Characters'
import { AuditEvents } from '@/collections/AuditEvents'
import { registerCreator, syncVideoCreators, videoAgent, publicVideoArchive, videoHash } from '@/lib/video-library.mjs'
import { normalizeCreator, createBilibiliClient } from '@/lib/bilibili.mjs'
import { up as addCreatorAvatar, down as removeCreatorAvatar } from '@/migrations/20261030_000000_creator_avatar'

let payload: any, root: string
const req = { context: {} }
const uid = '4168597', bvid = 'BV1GnYi63Ews'
const avatar = 'https://i0.hdslb.com/bfs/face/creator.jpg'
const source = { uid, bvid, title: '鲸鱼娘手书', description: 'DeepSeek娘同人短片', url: `https://www.bilibili.com/video/${bvid}/`, cover: 'https://i0.hdslb.com/bfs/archive/cover.jpg', creatorName: '作者甲', creatorAvatar: avatar, publishedAt: '2026-10-22T00:00:00.000Z', duration: 30, storyboard: { image: 'https://i0.hdslb.com/bfs/videoshot/shot.jpg', frames: 10 } }
const registration = { homepage: `https://space.bilibili.com/${uid}?spm_id_from=test`, intro: '创作鲸鱼娘同人手书', confirm: true }
const one = async (collection: string, where = {}) => (await payload.find({ collection, where, overrideAccess: true, depth: 0 })).docs[0]
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'creator-videos-'))
  payload = await getPayload({ config: buildConfig({ collections: [Users, Creators, Videos, Characters, AuditEvents], secret: 'isolated-video-tests', db: sqliteAdapter({ client: { url: `file:${path.join(root, 'test.db').replace(/\\/g, '/')}` }, push: true, transactionOptions: { behavior: 'immediate' } }) }) })
  await payload.create({ collection: 'characters', data: { characterId: 'deepseek', name: 'DeepSeek娘', status: 'active' }, overrideAccess: true, context: { audit: false } })
})
afterAll(async () => { await payload?.destroy(); payload?.db?.client?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }, 30000)
describe('Bilibili 作者登记、发现、AI 审核与公开导出', () => {
  it('仅接受 Bilibili 自己的主页，重复登记不覆盖资料或恢复暂停作者', async () => {
    for (const homepage of ['https://space.bilibili.com.evil.test/123', 'http://space.bilibili.com/123', 'https://space.bilibili.com@evil.test/123', 'https://www.bilibili.com/video/BV1GnYi63Ews/', 'https://space.bilibili.com:123/123']) expect(() => normalizeCreator({ ...registration, homepage })).toThrow()
    expect(normalizeCreator({ homepage: uid, intro: registration.intro }).uid).toBe(uid)
    expect(() => normalizeCreator({ ...registration, intro: '<script>alert(1)</script>' })).toThrow()
    await registerCreator(payload, registration, req)
    await registerCreator(payload, { ...registration, intro: '试图覆盖原介绍' }, req)
    expect((await one('creators')).intro).toBe(registration.intro)
    expect((await one('creators')).needsPublish).toBe(false)
    expect((await one('creators')).homepage).toBe(`https://space.bilibili.com/${uid}`)
    expect((await payload.count({ collection: 'creators', overrideAccess: true })).totalDocs).toBe(1)
  })
  it('发现视频只入队；风控保存重试状态，成功重试按 BV 号去重', async () => {
    const bad = await syncVideoCreators(payload, req, { client: { creator: async () => ({ name: source.creatorName, avatar }), page: async () => { throw new Error('Bilibili 返回 -352，稍后重试') } } as any })
    expect(bad.errors).toHaveLength(1)
    const c = await one('creators')
    expect(c.avatar).toBe(avatar)
    expect(c.name).toBe(source.creatorName)
    expect(c.lastSyncedAt).toBeFalsy()
    expect(c.retryAt).toBeTruthy()
    await payload.update({ collection: 'creators', id: c.id, data: { retryAt: null }, overrideAccess: true })
    const client: any = { page: async () => ({ items: [{ bvid }], hasMore: false }), video: async () => ({ ...source }) }
    expect((await syncVideoCreators(payload, req, { client })).discovered).toBe(1)
    const v = await one('videos')
    expect(v.status).toBe('queued')
    expect((await one('creators')).avatar).toBe(avatar)
    expect(v.source.creatorAvatar).toBeUndefined()
    expect(publicVideoArchive([await one('creators')], [v]).videos).toEqual([])
    await payload.update({ collection: 'creators', id: c.id, data: { retryAt: null }, overrideAccess: true })
    expect((await syncVideoCreators(payload, req, { client })).discovered).toBe(0)
  })
  it('读取作者卡片时核验 UID、规范头像地址并拒绝不可信来源', async () => {
    const make = (card: any) => createBilibiliClient({ fetchImpl: async (url: string) => {
      expect(url).toContain('/x/web-interface/card?mid=' + uid)
      return new Response(JSON.stringify({ code: 0, data: { card } }))
    } })
    await expect(make({ mid: Number(uid), name: '作者甲', face: '//i0.hdslb.com/bfs/face/creator.jpg' }).creator(uid)).resolves.toEqual({ name: '作者甲', avatar })
    await expect(make({ mid: Number(uid), name: '作者甲', face: 'https://evil.test/avatar.jpg' }).creator(uid)).resolves.toEqual({ name: '作者甲', avatar: '' })
    await expect(make({ mid: 999, name: '其他人', face: avatar }).creator(uid)).rejects.toThrow('不匹配')
    await expect(make({ mid: Number(uid), face: avatar }).creator('../123')).rejects.toThrow('UID 非法')
  })
  it('视频详情提供头像时可作为作者资料的补充，不影响预览帧失败处理', async () => {
    const client = createBilibiliClient({ fetchImpl: async (url: string) => {
      const data = url.includes('/x/player/videoshot') ? { code: -1 } : { code: 0, data: { bvid, owner: { mid: Number(uid), name: '作者甲', face: avatar }, state: 0, title: source.title, desc: source.description, pic: source.cover, cid: 123, pubdate: 1792636800, duration: 30 } }
      return new Response(JSON.stringify(data))
    } })
    await expect(client.video(bvid, uid)).resolves.toMatchObject({ creatorName: '作者甲', creatorAvatar: avatar, storyboard: null })
  })
  it('平台视频详情必须属于登记作者', async () => {
    const client = createBilibiliClient({ fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: { ...source, owner: { mid: 999, name: '其他人' }, state: 0, cid: 123 } })) })
    await expect(client.video(bvid, uid)).rejects.toThrow('不属于登记作者')
  })
  it('通过审核必须读取封面和预览帧，并明确属于 AI 娘二创', async () => {
    const v = await one('videos')
    const claim = await videoAgent(payload, { action: 'claim', id: String(v.id) }, req)
    await expect(videoAgent(payload, { action: 'claim', id: String(v.id) }, req)).rejects.toThrow('已被领取')
    const review = { verdict: 'pass', reason: '标题、简介与预览帧均呈现 DeepSeek娘同人手书', sourceHash: videoHash(v.source), isAiCharacter: true, isFanwork: true, confidence: 0.95, characterIds: ['deepseek'], i18n: { en: { title: 'DeepSeek Chan animatic', description: 'A DeepSeek Chan fan animatic.', creatorIntro: 'I create DeepSeek Chan animatics.' }, ja: { title: 'DeepSeekちゃんの手描き動画', description: 'DeepSeekちゃんの二次創作動画。', creatorIntro: 'DeepSeekちゃんの手描き動画を制作しています。' } } }
    const input = { action: 'complete', id: String(v.id), token: claim.token, review }
    await expect(videoAgent(payload, input, req)).rejects.toThrow('必须读取封面')
    const client: any = { image: async () => ({ bytes: Buffer.from('fake-image'), mime: 'image/png' }) }
    await videoAgent(payload, { action: 'image', id: String(v.id), token: claim.token, imagePart: 'cover' }, req, { client })
    await videoAgent(payload, { action: 'image', id: String(v.id), token: claim.token, imagePart: 'storyboard' }, req, { client })
    await expect(videoAgent(payload, { ...input, review: { ...review, isFanwork: false } }, req)).rejects.toThrow('仅明确属于')
    await expect(videoAgent(payload, { ...input, review: { ...review, sourceHash: 'stale' } }, req)).rejects.toThrow('仅明确属于')
    await expect(videoAgent(payload, { ...input, review: { ...review, i18n: { ...review.i18n, en: { ...review.i18n.en, title: 'Big Fat Fish Teaches You Quantitative Trading' } } } }, req)).rejects.toThrow('Wrong character terminology')
    await expect(videoAgent(payload, { ...input, review: { ...review, i18n: { ...review.i18n, en: { ...review.i18n.en, description: '未翻译的中文' } } } }, req)).rejects.toThrow('Chinese left')
    expect((await videoAgent(payload, input, req)).status).toBe('approved')
    expect((await one('creators')).needsPublish).toBe(true)
    const archive = publicVideoArchive([await one('creators')], [await one('videos')])
    expect(archive.videos).toHaveLength(1)
    expect(archive.creators[0].name).toBe(source.creatorName)
    expect(archive.creators[0].avatar).toBe(avatar)
    expect(archive.creators[0].i18n?.en).toContain('DeepSeek Chan')
    expect(JSON.stringify(archive)).not.toContain('sourceHash')
  })
  it('已登记作者没有新视频时也补齐或更新头像，失败保留原头像并继续同步', async () => {
    const c = await one('creators')
    await payload.update({ collection: 'creators', id: c.id, data: { avatar: null, needsPublish: false, retryAt: null }, overrideAccess: true, context: { skipNeedsPublish: true } })
    const client: any = { page: async () => ({ items: [], hasMore: false }), creator: async () => ({ name: source.creatorName, avatar }) }
    expect((await syncVideoCreators(payload, req, { client })).errors).toEqual([])
    let updated = await one('creators')
    expect(updated.avatar).toBe(avatar)
    expect(updated.needsPublish).toBe(true)
    expect(publicVideoArchive([updated], [await one('videos')]).creators[0].avatar).toBe(avatar)
    await payload.update({ collection: 'creators', id: c.id, data: { needsPublish: false, retryAt: null }, overrideAccess: true, context: { skipNeedsPublish: true } })
    client.creator = async () => { throw new Error('Bilibili 头像暂不可用') }
    expect((await syncVideoCreators(payload, req, { client })).errors).toEqual([])
    updated = await one('creators')
    expect(updated.avatar).toBe(avatar)
    expect(updated.needsPublish).toBe(false)
    await payload.update({ collection: 'creators', id: c.id, data: { retryAt: null }, overrideAccess: true })
    client.creator = async () => ({ name: source.creatorName, avatar: 'https://evil.test/avatar.jpg' })
    expect((await syncVideoCreators(payload, req, { client })).errors).toEqual([])
    expect((await one('creators')).avatar).toBe(avatar)
    const exported = publicVideoArchive([{ ...updated, avatar: 'https://evil.test/avatar.jpg' }], [await one('videos')])
    expect(exported.creators[0].avatar).toBeUndefined()
    await payload.update({ collection: 'creators', id: c.id, data: { retryAt: null, needsPublish: false }, overrideAccess: true, context: { skipNeedsPublish: true } })
    const nextAvatar = 'https://i1.hdslb.com/bfs/face/new.jpg'
    client.creator = async () => ({ name: source.creatorName, avatar: nextAvatar })
    client.page = async () => { throw new Error('订阅暂不可用') }
    expect((await syncVideoCreators(payload, req, { client })).errors).toHaveLength(1)
    updated = await one('creators')
    expect(updated.avatar).toBe(nextAvatar)
    expect(updated.needsPublish).toBe(true)
    expect(updated.error).toContain('订阅暂不可用')
  })
  it('增量迁移保留旧作者记录并允许回退', async () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec("CREATE TABLE creators(id INTEGER PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL); INSERT INTO creators VALUES(1,'4168597','作者甲');")
      const migration = { db: { run: async (statement: any) => db.exec(statement.queryChunks.map((chunk: any) => chunk.value?.join('') || '').join('')) } } as any
      await addCreatorAvatar(migration)
      expect(db.prepare('SELECT uid,name,avatar FROM creators').get()).toMatchObject({ uid, name: '作者甲', avatar: null })
      db.prepare('UPDATE creators SET avatar=? WHERE id=1').run(avatar)
      expect(db.prepare('SELECT avatar FROM creators').get()).toMatchObject({ avatar })
      await removeCreatorAvatar(migration)
      expect(db.prepare('SELECT uid,name FROM creators').get()).toMatchObject({ uid, name: '作者甲' })
    } finally { db.close() }
  })
  it('暂停作者会移除公开档案，公开重复登记不会解除暂停', async () => {
    const c = await one('creators')
    await payload.update({ collection: 'creators', id: c.id, data: { status: 'paused' }, overrideAccess: true })
    await registerCreator(payload, registration, req)
    expect((await one('creators')).status).toBe('paused')
    expect(publicVideoArchive([await one('creators')], [await one('videos')]).videos).toEqual([])
    expect((await one('creators')).needsPublish).toBe(true)
  })
  it('证据不足可以保留待复核；旧领取过期后不能写回，也不能从后台直接改成 AI 通过', async () => {
    const v = await payload.create({ collection: 'videos', data: { bvid: 'BV18dbN63EMw', title: '资料不足', creator: (await one('creators')).id, source: { ...source, bvid: 'BV18dbN63EMw', storyboard: null }, status: 'queued' }, overrideAccess: true })
    const claim = await videoAgent(payload, { action: 'claim', id: String(v.id) }, req)
    await expect(videoAgent(payload, { action: 'complete', id: String(v.id), token: claim.token, review: { verdict: 'manual', reason: '缺少视频预览帧' } }, req, { now: Date.now() + 11 * 60_000 })).rejects.toThrow('领取已过期')
    const next = await videoAgent(payload, { action: 'claim', id: String(v.id) }, req, { now: Date.now() + 12 * 60_000 })
    await expect(videoAgent(payload, { action: 'complete', id: String(v.id), token: claim.token, review: { verdict: 'reject', reason: '旧处理者' } }, req)).rejects.toThrow('领取已过期')
    expect((await videoAgent(payload, { action: 'complete', id: String(v.id), token: next.token, review: { verdict: 'manual', reason: '缺少视频预览帧' } }, req)).status).toBe('manual')
    await expect(payload.update({ collection: 'videos', id: v.id, data: { status: 'approved' }, overrideAccess: true })).rejects.toThrow('必须通过后台 AI 审核')
  })
  it('同一页超出预算会留在原分页，后续轮次去重并继续，不跳过未处理视频', async () => {
    const c = await one('creators')
    await payload.update({ collection: 'creators', id: c.id, data: { status: 'active', retryAt: null }, overrideAccess: true })
    const ids = ['BV1GnYi63Ew1','BV1GnYi63Ew2','BV1GnYi63Ew3','BV1GnYi63Ew4']
    const client: any = { page: async (_uid: string, page: number) => { expect(page).toBe(1); return { items: ids.map(bvid => ({ bvid })), hasMore: true } }, video: async (bvid: string) => ({ ...source, bvid }) }
    expect((await syncVideoCreators(payload, req, { client })).discovered).toBe(3)
    expect((await one('creators')).syncPage).toBe(1)
    expect((await syncVideoCreators(payload, req, { client, now: Date.now() + 6 * 60_000 })).discovered).toBe(1)
    expect((await one('creators')).syncPage).toBe(2)
    const candidate = await one('videos', { bvid: { equals: ids[0] } })
    const result = publicVideoArchive([await one('creators')], [candidate])
    expect(result.videos).toEqual([])
  })
  it('超过 100 位作者处于退避期时，后面的到期作者仍能继续同步', async () => {
    const c = await one('creators')
    const now = Date.now()
    for (let i = 0; i < 101; i++) {
      const otherUid = String(9000000 + i)
      await payload.create({ collection: 'creators', data: { uid: otherUid, homepage: `https://space.bilibili.com/${otherUid}`, name: '等待重试', intro: '同人动画', status: 'queued', retryAt: new Date(now + 3600000).toISOString() }, overrideAccess: true })
    }
    await payload.update({ collection: 'creators', id: c.id, data: { retryAt: null }, overrideAccess: true })
    const client: any = { page: async (nextUid: string) => { expect(nextUid).toBe(uid); return { items: [], hasMore: false } } }
    const stats = await syncVideoCreators(payload, req, { client, now })
    expect(stats.creators).toBe(1)
    expect(stats.errors).toEqual([])
    expect((await one('creators', { uid: { equals: uid } })).lastSyncedAt).toBe(new Date(now).toISOString())
  })
})
