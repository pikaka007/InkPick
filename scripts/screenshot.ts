/**
 * 截图工具 —— 把界面跑起来并出图，人工看外观用。
 *
 *   npm run shot
 *
 * 产物在 .shots/ 下（已 gitignore），三套主题各一张，外加一张选中态的工具栏。
 * 为什么要它：主题、字号、行宽这类改动，单测和 E2E 只能验证「值变了」，
 * 好不好看最终还得人眼看。CI 里跑不了窗口，所以做成手动工具。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
import type { Page } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronPath = require('electron') as unknown as string

const OUT_DIR = join(process.cwd(), '.shots')
const THEMES = ['light', 'sepia', 'dark'] as const

await mkdir(OUT_DIR, { recursive: true })
const userDataDir = await mkdtemp(join(tmpdir(), 'inkpick-shot-'))

const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', `--user-data-dir=${userDataDir}`],
  cwd: process.cwd()
})
const page = await app.firstWindow()
await page.waitForSelector('.app')

await page.getByRole('button', { name: '先看看示例' }).click()
await page.waitForSelector('.reader')

/** 用真实 Range 造选区，再触发阅读器的选区识别 */
async function select(segmentIndex: number, word: string, offset = 0): Promise<void> {
  await page.evaluate(
    ({ index, text, delta }) => {
      const paragraph = document.querySelector(`[data-seg="${index}"]`)
      if (!paragraph) throw new Error(`段落 ${index} 不存在`)
      const node = paragraph.firstChild as Text
      const at = node.data.indexOf(text) + delta
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + text.length)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      paragraph.closest('.reader-scroll')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    },
    { index: segmentIndex, text: word, delta: offset }
  )
  await page.waitForSelector('.selection-toolbar')
}

async function collect(segmentIndex: number, word: string, offset = 0): Promise<void> {
  await select(segmentIndex, word, offset)
  await page.getByRole('button', { name: '＋ 单词' }).click()
  await page.waitForTimeout(120)
}

// 攒一点真实内容，否则侧栏是空的，看不出效果
await collect(0, 'Reading')
await collect(2, 'word')
await collect(5, 'words')
await collect(1, 'gist')
await collect(3, 'strikes')

await select(1, 'Speed')
await page.getByRole('button', { name: '＋ 笔记' }).click()
await page.locator('.modal textarea').fill('这句概括了整本书的动机')
await page.getByRole('button', { name: /保存/ }).click()
await page.waitForSelector('.modal', { state: 'detached' })

async function shoot(name: string): Promise<void> {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`) })
  console.log(`  .shots/${name}.png`)
}

async function setTheme(target: string): Promise<void> {
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme
  }, target)
  await page.waitForTimeout(120)
}

console.log('主题：')
for (const theme of THEMES) {
  await setTheme(theme)
  await shoot(`theme-${theme}`)
}

// 回到浅色，再出几张交互态的图
await setTheme('light')
await select(4, 'Annotating')
await page.waitForTimeout(300)
await shoot('selection-toolbar')

await setTheme('dark')
await page.waitForTimeout(200)
await shoot('dark-with-toolbar')

// 搜索态：全部命中淡高亮 + 当前命中强高亮

// 搜索态：全部命中淡高亮 + 当前命中强高亮
await page.getByRole('button', { name: '搜索', exact: true }).click()
await page.locator('.search-input').fill('the')
await page.locator('.search-input').press('Enter')
await page.waitForTimeout(400)
await shoot('search')
await page.locator('.search-input').press('Escape')

// 侧栏收起：正文占满宽度
await page.getByRole('button', { name: '隐藏侧栏' }).click()
await page.waitForTimeout(200)
await shoot('sidebar-collapsed')
await page.getByRole('button', { name: '显示侧栏' }).click()

// 书多到侧栏需要滚动 —— 用来看自绘滚动条的样子
const bulkDir = join(userDataDir, 'bulk')
await mkdir(bulkDir, { recursive: true })
for (let i = 1; i <= 14; i++) {
  const file = join(bulkDir, `book-${String(i).padStart(2, '0')}.txt`)
  await writeFile(file, `Book ${i}. The word habit appears here. Reading slowly is a habit.\n`, 'utf-8')
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, file)
  await page.getByRole('button', { name: '打开 TXT' }).click()
  await page.waitForTimeout(60)
}
await page.waitForTimeout(300)
await shoot('sidebar-with-scrollbar')

// 章节：目录 + 章头导航 + 章尾分隔线
const chapterDir = join(userDataDir, 'novel')
await mkdir(chapterDir, { recursive: true })
const chapterFile = join(chapterDir, 'novel.txt')
const parts: string[] = []
for (let c = 1; c <= 12; c++) {
  parts.push(`第${c}章 ${['重生', '试探', '旧事', '夜行', '重逢', '离别', '归途', '风起'][c % 8]}`)
  for (let p = 1; p <= 8; p++) {
    parts.push(
      '　　他站在门口，看着远处的灯火，心里想的是另一件事。风从巷口吹过来，带着一点潮湿的味遒。'
    )
  }
}
await writeFile(chapterFile, `${parts.join('\n')}\n`, 'utf-8')
await app.evaluate(({ dialog }, target) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
}, chapterFile)
await page.getByRole('button', { name: '打开 TXT' }).click()
await page.waitForSelector('.chapter-nav')
await page.waitForTimeout(200)
await shoot('chapters-reader')

// 目录面板
await page.getByRole('button', { name: '目录', exact: true }).click()
await page.waitForSelector('.chapter-list')
await page.waitForTimeout(200)
await shoot('chapters-toc')

// 章尾分隔线：跳到第 2 章，往回滚一点就能看到「本章完」
await page.locator('.chapter-item').nth(1).click()
await page.waitForTimeout(200)
await page.evaluate(() => {
  const container = document.querySelector('.reader-scroll')
  if (container) container.scrollTop -= 260
})
await page.waitForTimeout(200)
await shoot('chapter-divider')

// 手动记词：输入条展开着，并且已经攒了几个不在书里的词
await page.getByRole('button', { name: '手动添加单词' }).click()
await page.waitForSelector('.add-word-input')
for (const word of ['solitude', 'serendipity', 'ephemeral', 'resilience']) {
  await page.locator('.add-word-input').fill(word)
  await page.locator('.add-word-input').press('Enter')
  await page.waitForTimeout(150)
}
await page.locator('.add-word-input').fill('habitual')
await page.waitForTimeout(200)
await shoot('manual-word')

await app.close()
await rm(userDataDir, { recursive: true, force: true })
console.log(`\n完成，产物在 ${OUT_DIR}`)
