import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const SHOTS = 'E:/quick-site-studio/tmp/s3-shots'
const OWNER = {
  email: process.env.S3_ADMIN_OWNER_EMAIL || 'owner@local.test',
  password: process.env.S3_ADMIN_OWNER_PASSWORD || '',
}

if (!OWNER.password) {
  throw new Error('缺少 S3_ADMIN_OWNER_PASSWORD，无法运行后台 E2E。')
}

test.describe.configure({ mode: 'serial' })

test.setTimeout(180_000)

async function shot(page: Page, name: string) {
  await page.screenshot({ fullPage: true, path: `${SHOTS}/${name}.png` })
}

async function goNav(page: Page, label: string) {
  const hrefs: Record<string, string> = {
    '作品库': '/admin/library',
    '发布': '/admin/publish',
    '专题': '/admin/topics-board',
    '机器人': '/admin/bots',
    '投稿审核': '/admin/review',
  }
  const href = hrefs[label]
  await expect(page.locator('.s3-nav-link', { hasText: label }).first()).toHaveAttribute('href', href)
  await page.goto(href)
}
async function login(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/admin(?:\/login)?$/)
  await page.goto('/admin/login')
  await page.locator('#field-email').fill(OWNER.email)
  await page.locator('#field-password').fill(OWNER.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin\/?$/)
  await expect(page.getByRole('heading', { name: '概览' })).toBeVisible()
}

async function ensureTestData(request: APIRequestContext) {
  const loginResponse = await request.post('/cms-api/users/login', { data: OWNER })
  if (!loginResponse.ok()) throw new Error('API 登录失败：' + loginResponse.status())
  const loginBody = await loginResponse.json()
  const headers = { Authorization: 'JWT ' + loginBody.token }

  const json = async (path: string, data?: unknown, method = 'GET') => {
    const response = await request.fetch(path, {
      data,
      headers,
      method,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok()) throw new Error(body?.errors?.[0]?.message || body?.message || 'setup request failed ' + response.status())
    return body
  }

  const activeRuns = await json('/cms-api/publish-runs?limit=100&where[status][in]=queued,in_progress')
  for (const run of activeRuns.docs || []) {
    await json('/cms-api/publish-runs/' + run.id, undefined, 'DELETE')
  }

  const bots = await json('/cms-api/users?limit=100&where[role][equals]=bot')
  if (!bots.docs?.length) {
    await json('/cms-api/users', {
      apiKey: 's3-e2e-bot-key-0123456789abcdef',
      displayName: 'Hermes E2E',
      email: 'hermes-e2e@bot.local',
      enableAPIKey: true,
      password: 'unused-e2e-password',
      role: 'bot',
    }, 'POST')
  }

  const sourceResult = await json('/cms-api/works?limit=1&depth=0&sort=createdAt')
  const source = sourceResult.docs?.[0]
  if (!source) throw new Error('作品库为空，无法准备 E2E 数据')
  // 上一轮 E2E 会隐藏种子作品；重跑时恢复隔离测试库的夹具。
  if (source.status !== 'published') await json('/cms-api/works/' + source.id, { status: 'published' }, 'PATCH')

  const stamp = Date.now().toString()
  const pendingName = 'S3 E2E 待发布 ' + stamp
  const pending = await json('/cms-api/works', {
    categories: source.categories || [],
    channel: 'web',
    character: source.character,
    commentary: 'E2E 详情正文',
    description: 'E2E 说明',
    kind: 'submission',
    name: pendingName,
    needsPublish: true,
    preview: source.preview,
    review: { confidence: 0.93, model: 'e2e', reason: 'E2E AI 初审通过', verdict: 'pass' },
    sha256: stamp.padEnd(64, 'a').slice(0, 64),
    status: 'pending',
    submissionId: 'e2e_' + stamp,
    tags: [{ value: 'E2E' }],
    workId: 'sticker_' + stamp.slice(-24),
  }, 'POST')

  return { pendingName, pendingWorkId: pending.doc.workId }
}

test('后台运营台完整流程', async ({ page, request }) => {
  await login(page)
  const setup = await ensureTestData(request)

  await expect(page.getByRole('heading', { name: '概览' })).toBeVisible()
  await shot(page, '01-dashboard')

  await goNav(page, '投稿审核')
  await expect(page.getByRole('heading', { name: '投稿审核' })).toBeVisible()
  await page.locator('.s3-tab', { hasText: 'GitHub' }).click()
  await page.locator('.s3-tab', { hasText: '全部' }).click()
  await expect(page.locator('.s3-card').filter({ hasText: setup.pendingName })).toBeVisible()
  await shot(page, '02-review-list')

  const pendingCard = page.locator('.s3-card').filter({ hasText: setup.pendingName }).first()
  await pendingCard.locator('.s3-card-main').click()
  const drawer = page.locator('.s3-drawer')
  await expect(drawer).toBeVisible()
  await drawer.getByLabel('名称').fill(setup.pendingName + ' 已编辑')
  await drawer.getByLabel('说明').fill('抽屉内已编辑说明')
  await drawer.getByRole('button', { name: '保存修改' }).click()
  await expect(drawer.getByText('保存成功，已标记为待发布。')).toBeVisible()
  await shot(page, '03-review-drawer')
  await drawer.locator('.s3-drawer-footer').getByRole('button', { name: '关闭' }).click()

  const editedCard = page.locator('.s3-card').filter({ hasText: setup.pendingName + ' 已编辑' }).first()
  await editedCard.locator('.s3-select input').check()
  await page.getByRole('button', { name: '批量移除' }).click()
  await expect(page.getByText('已移除，未发布作品不会进入公开清单。')).toBeVisible()
  await shot(page, '04-review-remove')

  await goNav(page, '作品库')
  await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible()
  await page.getByLabel('状态').selectOption('published')
  await expect(page.locator('.s3-card').first()).toBeVisible()
  await shot(page, '05-library-filter')
  await page.locator('.s3-card').first().locator('.s3-select input').check()
  await page.getByRole('button', { name: '改分类' }).click()
  const categoryModal = page.locator('.s3-modal')
  await categoryModal.locator('input[type="radio"]').first().check()
  await categoryModal.getByRole('button', { name: '保存分类' }).click()
  await expect(page.getByText('批量操作已完成。')).toBeVisible()
  await page.locator('.s3-card').first().locator('.s3-select input').check()
  await page.getByRole('button', { name: '隐藏', exact: true }).click()
  await expect(page.getByText('批量操作已完成。')).toBeVisible()
  await shot(page, '06-library-bulk')

  await goNav(page, '专题')
  await expect(page.getByRole('heading', { name: '专题', exact: true })).toBeVisible()
  const newTopicButton = page.getByRole('button', { name: '新建专题', exact: true })
  await expect(newTopicButton).toBeEnabled()
  await newTopicButton.click()
  const topicId = 's3-topic-' + Date.now().toString().slice(-8)
  await page.getByLabel('topicId').fill(topicId)
  await page.getByLabel('中文名称').fill('S3 自动化专题')
  await page.getByLabel('中文简介').fill('用于验证专题三语文案、封面、作品排序和上线。')
  await page.locator('.s3-topic-picker input[type="search"], .s3-topic-picker input').first().fill('S3')
  const pickerItems = page.locator('.s3-topic-work-item')
  await expect(pickerItems.first()).toBeVisible()
  await pickerItems.nth(0).locator('input[type="checkbox"]').check()
  if ((await pickerItems.count()) > 1) {
    await pickerItems.nth(1).locator('input[type="checkbox"]').check()
    const rows = page.locator('.s3-sortable-row')
    await expect(rows).toHaveCount(2)
    const sourceBox = await rows.nth(1).boundingBox()
    const targetBox = await rows.nth(0).boundingBox()
    if (sourceBox && targetBox) {
      await page.mouse.move(sourceBox.x + 18, sourceBox.y + sourceBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(targetBox.x + 18, targetBox.y + targetBox.height / 2, { steps: 12 })
      await page.mouse.up()
    }
  }
  await page.getByLabel('状态').selectOption('active')
  await page.getByRole('button', { name: '保存专题' }).click()
  await expect(page.getByText('专题已保存，并标记为待发布。')).toBeVisible()
  await shot(page, '07-topic-editor')

  await goNav(page, '发布')
  await expect(page.getByRole('heading', { name: '发布' })).toBeVisible()
  await expect(page.locator('.s3-plan-section').first()).toBeVisible()
  await shot(page, '08-publish-plan')
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await page.locator('.s3-modal').getByRole('button', { name: '确认发布' }).click()
  await expect(page.getByText(/发布请求已创建/)).toBeVisible()
  await shot(page, '09-publish-queued')

  await goNav(page, '机器人')
  await expect(page.getByRole('heading', { name: '机器人' })).toBeVisible()
  await page.getByRole('button', { name: '重置 API Key' }).first().click()
  await expect(page.locator('.s3-modal').getByText('新的 API Key')).toBeVisible()
  await expect(page.locator('.s3-key-display code')).not.toHaveText('')
  await shot(page, '10-bot-key')
})

test('首页人工审核入口直达待处理列表，已处理记录可查', async ({ page, request }) => {
  const loginResponse = await request.post('/cms-api/users/login', { data: OWNER })
  const headers = { Authorization: 'JWT ' + (await loginResponse.json()).token }
  const works = await request.get('/cms-api/works?limit=1&depth=0', { headers })
  const work = (await works.json()).docs[0]
  for (const [submissionId, title, linked] of [
    ['sub_browser_manual', '浏览器验收转人工', false],
    ['sub_browser_handled', '浏览器验收已处理', true],
  ] as const) {
    const existing = await request.get(`/cms-api/submissions?where[submissionId][equals]=${submissionId}`, { headers })
    if (!(await existing.json()).docs.length) {
      const created = await request.post('/cms-api/submissions', { headers, data: {
        submissionId, title, source: 'web', state: 'needs_manual',
        fields: { character: 'deepseek' }, review: { verdict: 'manual', reason: 'E2E 人工审核记录' },
        ...(linked ? { work: work.id } : {}),
      } })
      expect(created.ok()).toBe(true)
    }
  }
  await login(page)
  const entry = page.locator('.s3-stat-card').filter({ hasText: 'AI 拒绝 / 转人工' })
  await expect(entry).toHaveAttribute('href', '/admin/review?mode=rejected')
  await entry.click()
  await expect(page.getByRole('heading', { name: '投稿审核' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 拒绝 / 转人工', exact: true })).toHaveClass(/s3-subtab--active/)
  await expect(page.locator('.s3-card').filter({ hasText: '浏览器验收转人工' })).toBeVisible()
  await page.getByRole('button', { name: '已处理的 AI 记录' }).click()
  await expect(page.locator('.s3-card').filter({ hasText: '浏览器验收已处理' })).toBeVisible()
  await expect(page.locator('.s3-card').filter({ hasText: '浏览器验收转人工' })).toHaveCount(0)
  await shot(page, '11-review-handled')
})

test('多选写字段提交持久任务；页面关闭后执行器处理，重新打开可查结果', async ({ page, request, browser }) => {
  const auth = await request.post('/cms-api/users/login', { data: OWNER })
  const headers = { Authorization: 'JWT ' + (await auth.json()).token }
  const source = (await (await request.get('/cms-api/works?limit=1&depth=0', { headers })).json()).docs[0]
  const stamp = Date.now(); const keys = [`bulk_browser_${stamp}_a`, `bulk_browser_${stamp}_b`]
  for (const workId of keys) {
    const response = await request.post('/cms-api/works', { headers, data: { name: workId, workId, character: source.character, categories: source.categories, channel: 'web', kind: 'submission', status: 'published', needsPublish: false } })
    expect(response.ok()).toBe(true)
  }
  await login(page); await page.goto('/admin/library')
  await page.getByLabel('搜索').fill(`bulk_browser_${stamp}`)
  await expect(page.locator('.s3-card')).toHaveCount(2)
  await page.getByRole('button', { name: '选择本页' }).click()
  await page.getByRole('button', { name: '批量写字段', exact: true }).click()
  const modal = page.locator('.s3-modal')
  await modal.getByLabel('说明', { exact: true }).check()
  await modal.getByLabel('批量说明', { exact: true }).fill('关闭浏览器后的批量写入')
  await modal.getByLabel('我已确认所选条目和本次修改范围').check()
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/bulk/request') && r.request().method() === 'POST')
  await modal.getByRole('button', { name: '提交后台任务' }).click()
  const submitted = await (await responsePromise).json()
  expect(submitted.job.status).toBe('queued')
  await page.close()
  // 测试通过独立执行器契约推进，不调用任何前端列表或轮询接口。
  const workerHeaders = { Authorization: 'Bearer ' + process.env.ADMIN_WORKER_TOKEN }
  for (let n = 0; n < 2; n++) {
    const processed = await request.post('/cms-api/bulk/process-next', { headers: workerHeaders })
    expect(processed.ok()).toBe(true)
  }
  const saved = await request.get('/cms-api/works?where[workId][in]=' + keys.join(','), { headers })
  expect((await saved.json()).docs.every((w: { description: string }) => w.description === '关闭浏览器后的批量写入')).toBe(true)
  const reopened = await browser.newPage(); await login(reopened); await reopened.goto('/admin/library')
  await expect(reopened.getByText(/批量写字段 · 完成 · 2\/2/).first()).toBeVisible()
  await shot(reopened, '12-bulk-completed')
  await reopened.close()
})

test('移动端主要页面不横向溢出', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const routes = [
    ['/admin', '概览'],
    ['/admin/review', '投稿审核'],
    ['/admin/library', '作品库'],
    ['/admin/topics-board', '专题'],
    ['/admin/publish', '发布'],
    ['/admin/bots', '机器人'],
  ] as const
  for (const [route, heading] of routes) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(2)
  }
})
