import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const OWNER = {
  email: process.env.S3_ADMIN_OWNER_EMAIL || 'owner@local.test',
  password: process.env.S3_ADMIN_OWNER_PASSWORD || '',
}
if (!OWNER.password || !process.env.S3_ADMIN_DATABASE_URL?.includes('admin-usability-qa'))
  throw new Error('E2E 仅允许使用已配置密码的 admin-usability-qa 隔离库')
test.describe.configure({ mode: 'serial' })
test.setTimeout(180000)
async function login(page: Page) {
  await page.goto('/admin/login')
  await page.locator('#field-email').fill(OWNER.email)
  await page.locator('#field-password').fill(OWNER.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '任务中心', exact: true })).toBeVisible()
}
async function nav(page: Page, label: string) {
  const open = page.getByRole('button', { name: '打开 菜单', exact: true })
  if (await open.isVisible()) await open.click()
  await page
    .getByRole('navigation', { name: '后台主导航' })
    .getByRole('link', { name: label, exact: true })
    .click()
}
async function shot(page: Page, name: string) {
  await page.screenshot({
    fullPage: true,
    path: path.resolve('../.build/admin-qa-shots/' + name + '.png'),
  })
}
test('任务直达看图审核，一次提交收录与翻译，离开页面后可追踪', async ({ page, request }) => {
  const loginResponse = await request.post('/cms-api/users/login', { data: OWNER })
  expect(loginResponse.ok()).toBe(true)
  const headers = { Authorization: 'JWT ' + (await loginResponse.json()).token }
  const source = (await (await request.get('/cms-api/works?limit=1&depth=0', { headers })).json())
    .docs[0]
  const characters = (
    await (await request.get('/cms-api/characters?limit=100', { headers })).json()
  ).docs
  const categories = (
    await (await request.get('/cms-api/categories?limit=100', { headers })).json()
  ).docs
  const title = '界面一键收录 ' + Date.now(),
    id = 'sub_ui_' + Date.now()
  const created = await request.post('/cms-api/submissions', {
    headers,
    data: {
      submissionId: id,
      title,
      source: 'manual',
      state: 'needs_manual',
      sha256: 'b'.repeat(64),
      media: source.preview,
      fields: {
        name: title,
        character: characters[0].characterId,
        categoryId: categories[0].categoryId,
      },
      review: { verdict: 'manual', reason: '隔离环境的看图审核验收' },
    },
  })
  expect(created.ok()).toBe(true)
  await login(page)
  await shot(page, '01-task-home')
  const row = page.locator('.s3-task-row').filter({ hasText: title })
  await expect(row).toBeVisible()
  await row.click()
  await page.getByRole('link', { name: '打开看图审核', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '作品详情' })
  await expect(editor).toBeVisible()
  await expect(editor.locator('.s3-review-image-pane img')).toBeVisible()
  await expect(editor.getByText('隔离环境的看图审核验收')).toBeVisible()
  const bounds = await editor.boundingBox()
  expect(bounds!.width).toBeGreaterThan(850)
  await expect(editor.getByRole('button', { name: /补全|翻译/ })).toHaveCount(0)
  await shot(page, '02-image-review')
  await editor.getByRole('button', { name: '人工收录', exact: true }).click()
  await expect(editor.getByRole('button', { name: '任务已提交' })).toBeDisabled()
  const taskLink = editor.getByRole('link', { name: '查看收录与翻译任务' })
  const href = await taskLink.getAttribute('href')
  await taskLink.click()
  await expect(page.getByRole('heading', { name: '任务中心', exact: true })).toBeVisible()
  await expect(page.getByText('生成英文和日文')).toBeVisible()
  await page.reload()
  await expect(page.getByText('生成英文和日文')).toBeVisible()
  const jobId = new URL(href!, 'http://localhost').searchParams.get('task')
  const job = (await (await request.get('/cms-api/bulk/jobs?jobId=' + jobId, { headers })).json())
    .job
  expect(job.operation).toBe('manual-include')
  expect(job.total).toBe(1)
  await shot(page, '03-unified-job')
})
test('作品图片打开编辑，专题和发布入口可用，设置保留完整权限说明', async ({ page }) => {
  await login(page)
  await nav(page, '作品库')
  await expect(page.locator('.s3-card').first()).toBeVisible()
  await page.locator('.s3-card-main').first().click()
  const editor = page.getByRole('dialog', { name: '作品详情' })
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeVisible()
  await editor
    .locator('.s3-drawer-footer')
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await nav(page, '专题')
  await expect(page.getByRole('button', { name: '新建专题', exact: true })).toBeEnabled()
  await nav(page, '任务中心')
  await page.getByRole('link', { name: '检查并发布内容', exact: true }).click()
  await expect(page.getByRole('heading', { name: '发布', exact: true })).toBeVisible()
  await shot(page, '04-publish')
  await nav(page, '设置')
  await expect(page.getByRole('heading', { name: '本地机器人', exact: true })).toBeVisible()
  await expect(page.getByText('创建专题与选择作品', { exact: true })).toBeVisible()
  await expect(page.getByText('管理成员与设置', { exact: true })).toBeVisible()
  await shot(page, '05-device-settings')
})
test('手机主要页面不横向溢出', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [route, title] of [
    ['/admin', '任务中心'],
    ['/admin/review', '投稿审核'],
    ['/admin/library', '作品库'],
    ['/admin/topics-board', '专题'],
    ['/admin/publish', '发布'],
    ['/admin/bots', '设置'],
  ]) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(2)
  }
  await shot(page, '06-mobile')
})
