// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isRightsIssue,
  issueSnapshot,
  matchRequestedWork,
  validateRightsDecision,
  validateRightsReady,
  checkRightsLocale,
  queueRightsReplies,
  rightsVersion,
} from '@/lib/rights-requests'
import { requestAgentHandler } from '@/endpoints/request-agent'
import { sourceHash } from '@/lib/localization.mjs'
import { applyPublishStatus } from '@/lib/publish'

const work: any = {
  id: 1,
  workId: 'sticker_a',
  slug: 'deepseek-fixed',
  status: 'published',
  origin: {},
  license: { type: 'submitter-permission' },
  updatedAt: 'old',
}
const body =
  '### 哪张作品\nhttps://xn--pssy23gqgbz2d718b.com/en/works/deepseek-fixed.html\n### 你与这张图的关系\n我本人创作并投稿此作品\n### 具体诉求\n作者小鱼；下架这张作品；许可原文：仅限非商业用途\n- [x] 我确认上述请求真实'
const record: any = {
  id: 4,
  requestId: 'github-rights-42',
  status: 'investigating',
  work: 1,
  issueData: { number: 42, login: 'creator', body },
}
const original: any = {
  name: 'test',
  tags: [],
  characterId: 'deepseek',
  categoryIds: ['meme'],
  origin: {},
  license: work.license,
}
const decision: any = {
  verdict: 'apply',
  reason: '原作者明确要求',
  quote: '作者小鱼',
  requestType: 'attribution',
  patch: { author: '小鱼' },
}
let directory: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete process.env.ADMIN_ISSUE_REPLY_DIR
  delete process.env.ADMIN_WORKER_TOKEN
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('申请业务边界', () => {
  it('仅导入开放的 takedown Issue，排除 Bug、功能、PR 和投稿', () => {
    const issue = { title: '[署名/删除]', state: 'open', labels: [{ name: 'takedown' }] }
    expect(isRightsIssue(issue)).toBe(true)
    for (const override of [
      { title: '[Bug] test' },
      { title: '[Feature] test' },
      { title: '[投稿]' },
      { state: 'closed' },
      { labels: [] },
      { pull_request: {} },
    ])
      expect(isRightsIssue({ ...issue, ...override })).toBe(false)
  })
  it('只凭固定站点的唯一详情链接认图，忽略站外 URL、模糊名称和多图', () => {
    expect(matchRequestedWork(record.issueData, [work])).toEqual(work)
    expect(
      matchRequestedWork({ body: 'https://evil.test/works/deepseek-fixed.html' }, [work]),
    ).toBeNull()
    expect(matchRequestedWork({ body: 'deepseek-fixed' }, [work])).toBeNull()
    expect(
      matchRequestedWork(
        { body: body + '\nhttps://xn--pssy23gqgbz2d718b.com/works/another.html' },
        [work, { ...work, id: 2, workId: 'other', slug: 'another' }],
      ),
    ).toBeNull()
  })
  it('可补充空缺作者，保持投稿署名、授权与其他字段', () => {
    const result = validateRightsDecision(decision, record, work, original, '')
    expect(result.draft.origin.author).toBe('小鱼')
    expect(result.draft.license).toEqual(original.license)
    expect(original.origin).toEqual({})
  })
  it('拒绝冲突作者、编造内容、额外字段和其他未发布更改', () => {
    expect(() =>
      validateRightsDecision(
        decision,
        record,
        { ...work, origin: { author: '别人' } },
        original,
        '',
      ),
    ).toThrow('冲突')
    expect(() =>
      validateRightsDecision(
        { ...decision, patch: { author: '杜撰' } },
        record,
        work,
        original,
        'creator',
      ),
    ).toThrow('逐字')
    expect(() =>
      validateRightsDecision(
        { ...decision, patch: { author: '小鱼', status: 'deleted' } },
        record,
        work,
        original,
        'creator',
      ),
    ).toThrow('对应字段')
    expect(() =>
      validateRightsDecision(
        decision,
        record,
        { ...work, needsPublish: true },
        original,
        'creator',
      ),
    ).toThrow('待发布')
  })
  it('下架必须匹配原投稿账号，申请不允许物理删除补丁', () => {
    const remove = { ...decision, requestType: 'takedown', quote: '下架这张作品', patch: {} }
    expect(() => validateRightsDecision(remove, record, work, original, 'someone')).toThrow(
      '原投稿账号',
    )
    expect(validateRightsDecision(remove, record, work, original, 'creator').draft).toEqual(
      original,
    )
    expect(() =>
      validateRightsDecision(
        { ...remove, patch: { status: 'deleted' } },
        record,
        work,
        original,
        'creator',
      ),
    ).toThrow('对应字段')
  })
  it('授权备注照录，保留授权类型，使旧译文失效', () => {
    const corrected = validateRightsDecision(
      { ...decision, requestType: 'license-correction', patch: { licenseNote: '仅限非商业用途' } },
      record,
      work,
      { ...original, i18n: { en: {}, ja: {} } },
      'creator',
    )
    expect(corrected.draft.license).toEqual({
      type: 'submitter-permission',
      note: '授权说明照录：仅限非商业用途',
    })
    expect(corrected.draft.i18n).toEqual({ sourceHash: sourceHash(corrected.draft) })
    expect(() => validateRightsReady(corrected)).toThrow()
  })
  it('译文只准更正授权备注；保留已有标题与 FAQ', () => {
    const progress = {
      decision: { requestType: 'license-correction' },
      original: {
        i18n: {
          en: {
            name: 'Original',
            faq: [{ question: 'Q', answer: 'A' }],
            originNote: '',
            licenseNote: 'old',
          },
        },
      },
    }
    const locale = { ...progress.original.i18n.en, licenseNote: 'new' }
    expect(() => checkRightsLocale(locale, 'en', progress)).not.toThrow()
    expect(() => checkRightsLocale({ ...locale, name: 'changed' }, 'en', progress)).toThrow('name')
  })
  it('人工复核和下架不强求无用译文，更正要求完整译文', () => {
    expect(() => validateRightsReady({ decision: { verdict: 'manual' } })).not.toThrow()
    expect(() => validateRightsReady({ decision: { requestType: 'takedown' } })).not.toThrow()
    expect(() => validateRightsReady({ decision, draft: original })).toThrow('译文')
  })
  it('发布前不排队回复，发布后只生成一个固定申请文件', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rights-replies-'))
    process.env.ADMIN_ISSUE_REPLY_DIR = directory
    const saved = {
      ...record,
      status: 'approved',
      agentProgress: { stage: 'awaiting_publish', decision, draft: original },
    }
    const current = { ...work, needsPublish: true }
    const payload: any = {
      find: vi.fn(async () => ({ docs: [saved] })),
      findByID: vi.fn(async () => current),
      update: vi.fn(async ({ data }) => Object.assign(saved, data)),
    }
    expect(await queueRightsReplies(payload)).toBe(0)
    expect(await fs.readdir(directory)).toEqual([])
    current.needsPublish = false
    expect(await queueRightsReplies(payload)).toBe(1)
    expect(await queueRightsReplies(payload)).toBe(0)
    const file = JSON.parse(
      await fs.readFile(path.join(directory, 'github-rights-42.json'), 'utf8'),
    )
    expect(file).toMatchObject({
      schema: 'issue-reply/2',
      stateReason: 'completed',
      expected: { workId: work.workId, status: 'published' },
    })
  })
})

describe('申请工具的事务和权限', () => {
  function request(action: string, fixture: any, extra = {}) {
    process.env.ADMIN_WORKER_TOKEN = 'test-worker'
    return {
      headers: new Headers({ authorization: 'Bearer test-worker' }),
      json: async () => ({ action, id: record.requestId, token: 'lease', ...extra }),
      payload: fixture,
    } as any
  }
  function fixture() {
    const r = structuredClone(record)
    r.agentProgress = {
      token: 'lease',
      expiresAt: Date.now() + 60_000,
      attempt: 1,
      original,
      draft: original,
      workVersion: rightsVersion(work),
    }
    const w = structuredClone(work)
    return {
      r,
      w,
      db: {
        beginTransaction: vi.fn(async () => 'tx'),
        commitTransaction: vi.fn(),
        rollbackTransaction: vi.fn(),
      },
      find: vi.fn(async ({ collection }) => ({
        docs: collection === 'takedown-requests' ? [r] : [],
      })),
      findByID: vi.fn(async ({ collection }) => (collection === 'works' ? w : r)),
      update: vi.fn(async ({ collection, data }) =>
        Object.assign(collection === 'works' ? w : r, data),
      ),
      create: vi.fn(async () => ({})),
    }
  }
  it('拒绝公共聊天或普通 bot 的直接访问', async () => {
    process.env.ADMIN_WORKER_TOKEN = 'secret'
    const response = await requestAgentHandler({
      headers: new Headers(),
      user: { role: 'bot' },
    } as any)
    expect(response.status).toBe(401)
  })
  it('过期领取不能写入，事务回滚', async () => {
    const f = fixture()
    f.r.agentProgress.expiresAt = 0
    expect((await requestAgentHandler(request('draft', f, { decision }))).status).toBe(409)
    expect(f.db.rollbackTransaction).toHaveBeenCalled()
    expect(f.update).not.toHaveBeenCalled()
  })
  it('中途人工修改阻止写入，但仍允许 release', async () => {
    const f = fixture()
    f.w.updatedAt = 'human-edit'
    expect((await requestAgentHandler(request('draft', f, { decision }))).status).toBe(409)
    expect((await requestAgentHandler(request('release', f, { reason: '版本变化' }))).status).toBe(
      200,
    )
    expect(f.r.agentProgress).toMatchObject({ token: null, stage: 'retry', lastError: '版本变化' })
  })
  it('发布快照之后的新更正不会被误清掉待发布标记', async () => {
    const f = fixture()
    f.w.needsPublish = true
    f.w.updatedAt = 'newer'
    f.find.mockImplementation(async ({ collection }: any) => ({
      docs: collection === 'works' ? [f.w] : [],
    }))
    await applyPublishStatus(
      { payload: f } as any,
      { id: 1, plannedChanges: { snapshotVersions: { [work.workId]: 'older' } } },
      { results: { works: [] } },
    )
    expect(f.update).not.toHaveBeenCalled()
    expect(f.w.needsPublish).toBe(true)
  })
  it('完成下架只写 removed 和待发布标记，保留原图；不排队关闭 Issue', async () => {
    const f = fixture()
    const issue = {
      number: 42,
      title: '[署名/删除]',
      state: 'open',
      labels: [{ name: 'takedown' }],
      user: { login: 'creator' },
      body,
    }
    f.r.issueData = issueSnapshot(issue)
    f.r.agentProgress.originalLogin = 'creator'
    f.r.agentProgress.decision = {
      ...decision,
      requestType: 'takedown',
      quote: '下架这张作品',
      patch: {},
    }
    f.w.legacyPaths = { path: 'original.png', fullPath: 'full.webp' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => Response.json(url.includes('/comments') ? [] : issue)),
    )
    const response = await requestAgentHandler(request('complete', f))
    expect(await response.json()).toMatchObject({ ok: true, stage: 'awaiting_publish' })
    expect(f.w).toMatchObject({
      status: 'removed',
      needsPublish: true,
      changeAction: 'remove',
      legacyPaths: { path: 'original.png', fullPath: 'full.webp' },
    })
    expect(f.r.status).toBe('approved')
    expect(f.r.agentProgress.token).toBeNull()
  })
  it('完成时重新核验申请原文，编辑过的 Issue 不改变作品', async () => {
    const f = fixture()
    f.r.agentProgress.decision = { verdict: 'manual', reason: '权属不明' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.includes('/comments')
            ? []
            : {
                number: 42,
                title: '[署名/删除]',
                state: 'open',
                labels: [{ name: 'takedown' }],
                user: { login: 'creator' },
                body: 'edited',
              },
        ),
      ),
    )
    expect((await requestAgentHandler(request('complete', f))).status).toBe(409)
    expect(f.update).not.toHaveBeenCalled()
    expect(f.w.status).toBe('published')
  })
})
