/**
 * 端到端验收：跑通 MVP 的 4 件事 —— 读、钉、看、存。
 *
 * 这是 docs/MVP.md 里「验收标准」的自动化版本：
 * 攒出词表和笔记 → 能点回原文 → 关掉重开还在。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron } from 'playwright-core'
import type { ElectronApplication, Page } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronPath = require('electron') as unknown as string

let app: ElectronApplication
let page: Page
let userDataDir: string

async function launch(): Promise<void> {
  app = await electron.launch({
    executablePath: electronPath,
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: process.cwd()
  })
  page = await app.firstWindow()
  await page.waitForSelector('.app')
}

/** 用真实的 DOM Range 造出一次选区，再模拟 mouseup 触发阅读器的选区识别 */
async function selectInParagraph(segmentIndex: number, word: string): Promise<void> {
  await page.evaluate(
    ({ index, text: needle }) => {
      const paragraph = document.querySelector(`[data-seg="${index}"]`)
      if (!paragraph) throw new Error(`段落 ${index} 不存在`)

      const textNode = paragraph.firstChild
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) throw new Error('段落里没有文本节点')

      const source = (textNode as Text).data
      const at = source.indexOf(needle)
      if (at < 0) throw new Error(`段落 ${index} 中找不到「${needle}」`)

      const range = document.createRange()
      range.setStart(textNode, at)
      range.setEnd(textNode, at + needle.length)

      const selection = window.getSelection()
      if (!selection) throw new Error('拿不到 selection')
      selection.removeAllRanges()
      selection.addRange(range)

      paragraph.closest('.reader-scroll')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    },
    { index: segmentIndex, text: word }
  )

  await page.waitForSelector('.selection-toolbar')
}

beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'inkpick-e2e-'))
  await launch()

  // 数据隔离：绝不能把测试数据写进真实 userData
  const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(actual.replace(/\\/g, '/')).toBe(userDataDir.replace(/\\/g, '/'))
})

afterAll(async () => {
  if (app) await app.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
})

describe('读', () => {
  it('首次启动显示欢迎页', async () => {
    expect(await page.locator('.welcome h1').textContent()).toBe('InkPick')
  })

  it('载入示例后进入阅读态，正文被切成段落', async () => {
    await page.getByRole('button', { name: '先看看示例' }).click()

    await page.waitForSelector('.reader')
    expect(await page.locator('.welcome').count()).toBe(0)
    expect(await page.locator('[data-seg]').count()).toBeGreaterThan(3)
    expect(await page.locator('[data-seg="0"]').textContent()).toBe(
      'Reading slowly is a habit that few people cultivate.'
    )
  })
})

describe('钉', () => {
  it('选中单词后弹出工具栏，收藏后进入单词本并带上原句上下文', async () => {
    await selectInParagraph(0, 'Reading')

    await page.getByRole('button', { name: '＋ 单词' }).click()
    await page.waitForSelector('.annotation')

    expect(await page.locator('.selection-toolbar').count()).toBe(0)

    const first = page.locator('.annotation').first()
    expect(await first.locator('strong').textContent()).toBe('Reading')
    expect(await first.locator('em').textContent()).toBe('Reading slowly is a habit that few people cultivate.')
    expect(await first.locator('.badge').textContent()).toBe('词')
  })

  it('选中一段文字可以写笔记', async () => {
    await selectInParagraph(1, 'trained to skim')

    await page.getByRole('button', { name: '＋ 笔记' }).click()
    await page.waitForSelector('.modal textarea')
    await page.locator('.modal textarea').fill('这句是关键')

    await page.getByRole('button', { name: /保存/ }).click()
    await page.waitForSelector('.modal', { state: 'detached' })

    expect(await page.locator('.annotation').count()).toBe(2)

    const note = page.locator('.annotation').nth(1)
    expect(await note.locator('strong').textContent()).toBe('这句是关键')
    expect(await note.locator('.badge').textContent()).toBe('记')
  })

  it('标注计数出现在文档头部', async () => {
    expect(await page.locator('.reader-meta').textContent()).toContain('2 条标注')
  })
})

describe('看', () => {
  it('点击列表项能定位回原文，并把该条标记为当前项', async () => {
    const first = page.locator('.annotation').first()
    await first.locator('.annotation-main').click()

    await page.waitForSelector('.annotation.active')
    expect(await page.locator('.annotation.active strong').textContent()).toBe('Reading')

    // 跳转后目标段落应滚进可视区
    const visible = await page.evaluate(() => {
      const paragraph = document.querySelector('[data-seg="0"]')
      if (!paragraph) return false
      const rect = paragraph.getBoundingClientRect()
      return rect.top >= -5 && rect.top < window.innerHeight
    })
    expect(visible).toBe(true)
  })

  it('可以删除标注', async () => {
    const note = page.locator('.annotation').nth(1)
    await note.locator('.annotation-remove').click()

    expect(await page.locator('.annotation').count()).toBe(1)
  })
})

describe('存', () => {
  it('刚标注完就关窗（防抖还没触发）也不丢数据', async () => {
    await selectInParagraph(3, 'tool')
    await page.getByRole('button', { name: '＋ 单词' }).click()
    await page.waitForSelector('.annotation')
    expect(await page.locator('.annotation').count()).toBe(2)

    // 不等防抖，直接关。主进程必须等渲染进程落盘
    await app.close()

    const raw = await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')
    const persisted = JSON.parse(raw) as {
      docs: unknown[]
      annotations: { term?: string }[]
      progress: Record<string, unknown>
    }
    expect(persisted.docs).toHaveLength(1)
    expect(persisted.annotations.map((item) => item.term)).toEqual(['Reading', 'tool'])
    expect(Object.keys(persisted.progress)).toHaveLength(1)
  })

  it('重开后回到上次的文档，标注与位置都还在', async () => {
    await launch()

    await page.waitForSelector('.reader')
    expect(await page.locator('.welcome').count()).toBe(0)
    expect(await page.locator('.reader-header h1').textContent()).toBe('示例 · On Reading')

    expect(await page.locator('.annotation').count()).toBe(2)
    expect(await page.locator('.annotation strong').allTextContents()).toEqual(['Reading', 'tool'])
    expect(await page.locator('.annotation em').first().textContent()).toBe(
      'Reading slowly is a habit that few people cultivate.'
    )
  })
})
