/**
 * 截图工具 —— 把界面跑起来并出图，人工看外观用。
 *
 *   npm run shot
 *
 * 产物在 .shots/ 下（已 gitignore），三套主题各一张，外加一张选中态的工具栏。
 * 为什么要它：主题、字号、行宽这类改动，单测和 E2E 只能验证「值变了」，
 * 好不好看最终还得人眼看。CI 里跑不了窗口，所以做成手动工具。
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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

// 回到浅色，再出一张「选中态 + 工具栏」和一张「深色主题下的选中态」
await setTheme('light')
await select(4, 'Annotating')
await page.waitForTimeout(300)
await shoot('selection-toolbar')

await setTheme('dark')
await page.waitForTimeout(200)
await shoot('dark-with-toolbar')

await app.close()
await rm(userDataDir, { recursive: true, force: true })
console.log(`\n完成，产物在 ${OUT_DIR}`)
