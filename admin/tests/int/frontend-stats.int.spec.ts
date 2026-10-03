import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// 复用 Vitest 已有的 jsdom，显式声明测试窗口，避免引入仅供测试的额外类型依赖。
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: string; pretendToBeVisual: boolean }) => { window: Window & typeof globalThis }
}

const publicDir = path.resolve(import.meta.dirname, '../../../frontend/public')
const statsScript = fs.readFileSync(path.join(publicDir, 'work-stats.js'), 'utf8')
const siteScript = fs.readFileSync(path.join(publicDir, 'v2.js'), 'utf8')
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)) }

function browser({ available = true, direct = false, defaultDownloads = false } = {}) {
  const ids = Array.from({ length: 60 }, (_, i) => 'w' + i)
  const cards = ids.slice(0, 24).map(id => `<article class="media-card"><a href="/works/${id}.html" data-work="${id}"><img><p data-work-stats="${id}"></p></a></article>`).join('')
  const dom = new JSDOM(`<div class="sort-bar" ${defaultDownloads ? 'data-default-sort="downloads"' : ''}><button data-sort="latest" aria-pressed="true">最新</button><button data-sort="popular" disabled>热度</button><button data-sort="downloads" disabled>下载</button><button data-sort="random">随机</button></div><p data-stats-note></p><div data-feed data-total="60" data-slugs='${JSON.stringify(ids)}' data-next="/page/2.html" ${direct ? 'data-open="w0"' : ''}>${cards}</div>`, { url: direct ? 'http://localhost/works/w0.html' : 'http://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true })
  const win = dom.window
  const events: unknown[][] = []
  const requests: string[] = []
  const data = Object.fromEntries(ids.map(id => [id, { id, n: id, c: '角色', cid: 'deepseek', w: 100, h: 100, l: '/large.webp', i: '/thumb.webp', o: 'https://example.test/image.png', k: ['meme'], lk: 'unknown', lt: '未知', dt: '2026.10.03' }]))
  // 不属于当前列表的作品即使计数更大，也不能参与排序。
  data.outside = { ...data.w0, id: 'outside', n: 'outside' }
  const snapshot = { available, startDate: '2026-10-03', syncedAt: new Date().toISOString(), works: Object.fromEntries([...ids.map((id, i) => [id, { views: i, downloads: i === 30 ? 500 : 0 }]), ['outside', { views: 999, downloads: 999 }]]) }
  Object.assign(win, {
    fetch: async (url: string) => { requests.push(url); if (url === '/works-v2.json') return { ok: true, json: async () => data }; if (url === '/cms-api/analytics/public') return { ok: true, json: async () => snapshot }; throw new Error('意外请求 ' + url) },
    gtag: (...args: unknown[]) => events.push(args),
    scrollTo: () => {},
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  })
  win.eval(statsScript); win.eval(siteScript)
  return { win, events, requests, dom }
}

describe('前台作品统计与完整列表排序', () => {
  it('默认按下载量，未同步回退，并保留等待期间用户选择的最新顺序', async () => {
    const first = browser({ defaultDownloads: true }); await settle()
    expect(first.win.document.querySelector('[data-feed] [data-work]')?.getAttribute('data-work')).toBe('w30')
    expect(first.win.document.querySelector('[data-sort="downloads"]')?.getAttribute('aria-pressed')).toBe('true')
    first.dom.window.close()
    const missing = browser({ defaultDownloads: true, available: false }); await settle()
    expect(missing.win.document.querySelector('[data-feed] [data-work]')?.getAttribute('data-work')).toBe('w0')
    missing.dom.window.close()
    const manual = browser({ defaultDownloads: true })
    manual.win.document.querySelector<HTMLElement>('[data-sort="latest"]')!.click(); await settle()
    expect(manual.win.document.querySelector('[data-feed] [data-work]')?.getAttribute('data-work')).toBe('w0')
    manual.dom.window.close()
  })
  it('浏览及下载上报稳定 ID，语言切换不重复计数', async () => {
    const { win, events, dom } = browser()
    await settle()
    win.document.querySelector<HTMLElement>('[data-work="w0"]')!.click(); await settle()
    expect(events.filter(e => e[1] === 'work_view')).toHaveLength(1)
    expect(events[0][2]).toMatchObject({ work_id: 'w0' })
    win.document.dispatchEvent(new win.CustomEvent('site:langchange')); await settle()
    expect(events.filter(e => e[1] === 'work_view')).toHaveLength(1)
    win.document.querySelector('[data-download-work]')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    expect(events.filter(e => e[1] === 'work_download')[0][2]).toMatchObject({ work_id: 'w0' })
    win.document.querySelector<HTMLElement>('.wm .next')!.click(); await settle()
    expect(events.filter(e => e[1] === 'work_view')[1][2]).toMatchObject({ work_id: 'w1' })
    dom.window.close()
  })

  it('直达作品地址只产生一次作品浏览', async () => {
    const { events, dom } = browser({ direct: true }); await settle()
    expect(events.filter(e => e[1] === 'work_view')).toHaveLength(1)
    dom.window.close()
  })

  it('热度、下载排序包括未加载作品，保持范围且分批显示', async () => {
    const { win, requests, dom } = browser(); await settle()
    win.document.querySelector<HTMLElement>('[data-sort="popular"]')!.click(); await settle()
    expect(win.document.querySelector('[data-feed] [data-work]')?.getAttribute('data-work')).toBe('w59')
    expect(win.document.querySelectorAll('[data-feed] .media-card')).toHaveLength(24)
    expect(requests).not.toContain('/page/2.html')
    expect(win.document.querySelector('[data-feed] [data-work="outside"]')).toBeNull()
    win.document.querySelector<HTMLElement>('[data-sort="downloads"]')!.click(); await settle()
    expect(win.document.querySelector('[data-feed] [data-work]')?.getAttribute('data-work')).toBe('w30')
    win.document.querySelector<HTMLElement>('[data-sort="latest"]')!.click(); await settle()
    expect(win.document.querySelector('[data-feed] [data-work]')?.getAttribute('data-work')).toBe('w0')
    dom.window.close()
  })

  it('未同步显示占位且禁用统计排序，下载与浏览仍能上报', async () => {
    const { win, events, dom } = browser({ available: false }); await settle()
    expect(win.document.querySelector<HTMLButtonElement>('[data-sort="popular"]')!.disabled).toBe(true)
    expect(win.document.querySelector('[data-work-stats]')!.textContent).toContain('—')
    win.document.querySelector<HTMLElement>('[data-work="w0"]')!.click(); await settle()
    expect(events.filter(e => e[1] === 'work_view')).toHaveLength(1)
    dom.window.close()
  })
})
