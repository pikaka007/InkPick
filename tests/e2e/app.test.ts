/**
 * 端到端验收：跑通 MVP 的 4 件事 —— 读、钉、看、存。
 *
 * 这是 docs/MVP.md 里「验收标准」的自动化版本：
 * 攒出词表和笔记 → 能点回原文 → 关掉重开还在。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron } from 'playwright-core'
import type { ElectronApplication, Page } from 'playwright-core'
import { parseCsvRecords } from '../../src/core/csv'

const require = createRequire(import.meta.url)
const electronPath = require('electron') as unknown as string

let app: ElectronApplication
let page: Page
let userDataDir: string
let exportDir: string

/** 把主进程的保存对话框换成固定路径，才能真的验证导出的文件内容 */
async function stubSaveDialog(filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const store = globalThis as unknown as { __inkpickSuggested?: string }
    dialog.showSaveDialog = async (options) => {
      // 签名的第一个参数是重载联合类型，这里按实际调用方式取
      store.__inkpickSuggested = (options as { defaultPath?: string } | undefined)?.defaultPath ?? ''
      return { canceled: false, filePath: target }
    }
  }, filePath)
}

async function lastSuggestedName(): Promise<string> {
  return app.evaluate(() => (globalThis as unknown as { __inkpickSuggested?: string }).__inkpickSuggested ?? '')
}

/** 导出被取消的场景 */
async function stubSaveDialogCanceled(): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
}

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

async function collectWord(segmentIndex: number, word: string): Promise<void> {
  await selectInParagraph(segmentIndex, word)
  await page.getByRole('button', { name: '＋ 单词' }).click()
}

/** 定位某个词条分组，并等到它出现 */
async function vocabGroup(lemma: string) {
  const group = page.locator('.vocab-group').filter({ has: page.locator(`strong:text-is("${lemma}")`) })
  await group.waitFor()
  return group
}

beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'inkpick-e2e-'))
  exportDir = await mkdtemp(join(tmpdir(), 'inkpick-export-'))
  await launch()

  // 数据隔离：绝不能把测试数据写进真实 userData
  const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(actual.replace(/\\/g, '/')).toBe(userDataDir.replace(/\\/g, '/'))
})

afterAll(async () => {
  if (app) await app.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (exportDir) await rm(exportDir, { recursive: true, force: true })
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

describe('钉 · 词典', () => {
  it('收藏单词后自动回填音标与释义', async () => {
    await collectWord(0, 'Reading')

    // 回填后词条头部用词典里的规范形式（小写），所以这里等 'reading' 出现就等于等到了回填
    const group = await vocabGroup('reading')
    expect(await group.locator('.phonetic').textContent()).toMatch(/\S/)
    expect(await group.locator('.vocab-definition').textContent()).toContain('阅读')
    // 只有一次收藏时不显示计数
    expect(await group.locator('.times').count()).toBe(0)
  })

  it('同一词的不同形态归到同一组，而不是散成多条', async () => {
    await collectWord(2, 'word')
    await vocabGroup('word')

    await collectWord(5, 'words')
    const group = await vocabGroup('word')

    // words → word，两次收藏在同一组里
    await expect.poll(async () => group.locator('.occurrence').count()).toBe(2)
    expect(await group.locator('.times').textContent()).toBe('×2')
    // 变形那一条上标出用户当时选中的原样
    expect(await group.locator('.occurrence-form').textContent()).toBe('words')
  })

  it('释义经过收敛，不会把整段词典原文摆上来', async () => {
    const group = await vocabGroup('word')
    const definition = (await group.locator('.vocab-definition').textContent()) ?? ''

    expect(definition).not.toContain('[')
    expect(definition.length).toBeLessThan(60)
    expect(definition).toContain('词')
  })

  it('笔记不进单词本', async () => {
    await selectInParagraph(1, 'trained to skim')
    await page.getByRole('button', { name: '＋ 笔记' }).click()
    await page.waitForSelector('.modal textarea')
    await page.locator('.modal textarea').fill('这句是关键')
    await page.getByRole('button', { name: /保存/ }).click()
    await page.waitForSelector('.modal', { state: 'detached' })

    expect(await page.locator('.annotation').count()).toBe(1)
    expect(await page.locator('.annotation strong').textContent()).toBe('这句是关键')
    expect(await page.locator('.vocab-group').count()).toBe(2)
  })

  it('词典查不到时显示未收录，并允许自己补一句释义', async () => {
    await collectWord(5, 'InkPick')

    const group = await vocabGroup('InkPick')
    await expect.poll(async () => group.locator('.vocab-definition .missing').textContent()).toBe('词典未收录')
    expect(await group.locator('.missing-hint').count()).toBe(1)

    await group.locator('.define-button').click()
    await group.locator('.define-editor input').fill('这个阅读器本身')
    await group.locator('.define-editor button').click()

    await expect.poll(async () => group.locator('.vocab-definition').textContent()).toBe('这个阅读器本身')
    expect(await group.locator('.missing-hint').count()).toBe(0)
  })
})

describe('导出', () => {
  it('导出 Anki CSV：一个词一行，多次收藏合成多行上下文', async () => {
    const target = join(exportDir, 'out.csv')
    await stubSaveDialog(target)

    await page.getByRole('button', { name: '导出 CSV' }).click()
    await expect.poll(async () => readFile(target, 'utf-8').catch(() => null)).not.toBeNull()
    await expect.poll(async () => page.locator('.toast').textContent()).toContain('已导出到')

    // 建议文件名带上了文档标题与用途
    expect(await lastSuggestedName()).toBe('示例 · On Reading-词表.csv')

    const records = parseCsvRecords(await readFile(target, 'utf-8'))
    expect(records.map((row) => row.Word)).toEqual(['reading', 'word', 'InkPick'])
    expect(records[0].Phonetic).not.toBe('')
    expect(records[0].Source).toBe('示例 · On Reading')

    // word 组里有 word 与 words 两次收藏
    const wordRow = records.find((row) => row.Word === 'word')!
    expect(wordRow.Context.split('\n')).toHaveLength(2)

    // 词典查不到的词导出的是手写释义
    expect(records.find((row) => row.Word === 'InkPick')!.Definition).toBe('这个阅读器本身')
  })

  it('导出 Markdown：词表与笔记两个小节都在', async () => {
    const target = join(exportDir, 'out.md')
    await stubSaveDialog(target)

    await page.getByRole('button', { name: '导出 MD' }).click()
    await expect.poll(async () => readFile(target, 'utf-8').catch(() => '')).toContain('## 单词')

    expect(await lastSuggestedName()).toBe('示例 · On Reading-笔记.md')

    const markdown = await readFile(target, 'utf-8')
    expect(markdown.startsWith('# 示例 · On Reading')).toBe(true)
    expect(markdown).toContain('3 条词条 / 1 条笔记')
    expect(markdown).toContain('## 单词')
    expect(markdown).toContain('## 笔记')
    expect(markdown).toContain('### 这句是关键')
    // 词形与原形不同时标出来
    expect(markdown).toContain('*(words)*')
  })

  it('取消保存时不报错也不写文件', async () => {
    const target = join(exportDir, 'never.csv')
    await stubSaveDialogCanceled()

    await page.getByRole('button', { name: '导出 CSV' }).click()
    await expect.poll(async () => page.locator('.toast').textContent()).toBe('已取消导出')
    expect(await readFile(target, 'utf-8').catch(() => null)).toBeNull()
  })
})

describe('跨文档单词本', () => {
  it('可以打开第二本书', async () => {
    // 路径要在这里算：describe 体在收集阶段就执行了，那时 exportDir 还没创建
    const secondDocPath = join(exportDir, 'second-book.txt')
    await writeFile(secondDocPath, 'The word appears here too. A habit of reading.\n', 'utf-8')
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, secondDocPath)

    await page.getByRole('button', { name: '打开 TXT' }).click()
    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe('second-book')
    expect(await page.locator('.doc-item').count()).toBe(2)
  })

  it('在新书里收藏同一个词，本文件范围下只看得到这一条', async () => {
    await collectWord(0, 'word')

    const group = await vocabGroup('word')
    await expect.poll(async () => group.locator('.occurrence').count()).toBe(1)
    expect(await group.locator('.occurrence-source').count()).toBe(0)
  })

  it('切到「全部文档」后同一个词跨书合并成一组，并标出各自出处', async () => {
    await page.getByRole('button', { name: '全部文档' }).click()

    const group = await vocabGroup('word')
    await expect.poll(async () => group.locator('.occurrence').count()).toBe(3)
    expect(await group.locator('.times').textContent()).toBe('×3')

    const sources = (await group.locator('.occurrence-source').allTextContents()).sort()
    expect(sources).toEqual(['second-book', '示例 · On Reading', '示例 · On Reading'])
  })

  it('跨文档导出：Source 列出全部来源，上下文一条不丢', async () => {
    const target = join(exportDir, 'all.csv')
    await stubSaveDialog(target)

    await page.getByRole('button', { name: '导出 CSV' }).click()
    await expect.poll(async () => readFile(target, 'utf-8').catch(() => null)).not.toBeNull()

    // 跨文档时文件名不再叫某个文档的名字
    expect(await lastSuggestedName()).toBe('InkPick-全部词表.csv')

    const records = parseCsvRecords(await readFile(target, 'utf-8'))
    const wordRow = records.find((row) => row.Word === 'word')!
    expect(wordRow.Source).toBe('示例 · On Reading / second-book')
    expect(wordRow.Context.split('\n')).toHaveLength(3)
  })

  it('点另一本书的收藏会自动切过去', async () => {
    const target = page.locator('.occurrence').filter({
      has: page.locator('.occurrence-source:text-is("second-book")')
    })
    await target.first().click()

    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe('second-book')
    expect(await page.locator('.doc-item.active .doc-title').textContent()).toBe('second-book')
  })

  it('切回本文件范围并回到示例文档', async () => {
    await page.getByRole('button', { name: '本文件' }).click()
    await page.locator('.doc-item', { hasText: '示例 · On Reading' }).click()
    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe('示例 · On Reading')
  })
})

describe('看', () => {
  it('点某一次收藏能跳回原文，并标出当前位置', async () => {
    const group = await vocabGroup('word')
    await group.locator('.occurrence').first().click()

    await expect.poll(async () => group.locator('.occurrence.active').count()).toBe(1)

    const visible = await page.evaluate(() => {
      const paragraph = document.querySelector('[data-seg="2"]')
      if (!paragraph) return false
      const rect = paragraph.getBoundingClientRect()
      return rect.top >= -5 && rect.top < window.innerHeight
    })
    expect(visible).toBe(true)
  })

  it('标注计数反映的是收藏次数而不是分组数', async () => {
    // Reading + word + words + InkPick + 1 条笔记
    expect(await page.locator('.reader-meta').textContent()).toContain('5 条标注')
  })

  it('可以删除笔记', async () => {
    await page.locator('.annotation .annotation-remove').click()
    await expect.poll(async () => page.locator('.annotation').count()).toBe(0)
  })
})

describe('存', () => {
  it('刚收藏完就关窗（防抖还没触发）也不丢数据', async () => {
    // 不等防抖，直接关。主进程必须等渲染进程落盘
    await app.close()

    const raw = await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')
    const persisted = JSON.parse(raw) as {
      docs: unknown[]
      annotations: {
        type: string
        term?: string
        lemma?: string
        senses?: { pos: string; translation: string }[]
        manualDefinition?: string
        lookupStatus?: string
      }[]
    }

    expect(persisted.docs).toHaveLength(2)
    expect(persisted.annotations).toHaveLength(5)

    const words = persisted.annotations.find((item) => item.term === 'words')
    expect(words?.lookupStatus).toBe('found')
    expect(words?.lemma).toBe('word')
    expect(words?.senses?.length).toBeGreaterThan(0)

    const inkpick = persisted.annotations.find((item) => item.term === 'InkPick')
    expect(inkpick?.lookupStatus).toBe('missing')
    expect(inkpick?.manualDefinition).toBe('这个阅读器本身')
  })

  it('重开后文档、分组、释义、手写释义都还在', async () => {
    await launch()

    await page.waitForSelector('.reader')
    expect(await page.locator('.welcome').count()).toBe(0)
    expect(await page.locator('.reader-header h1').textContent()).toBe('示例 · On Reading')

    // 3 个词条分组（word 组内含 2 次收藏），笔记已删
    await expect.poll(async () => page.locator('.vocab-group').count()).toBe(3)
    expect(await page.locator('.annotation').count()).toBe(0)

    const wordGroup = await vocabGroup('word')
    expect(await wordGroup.locator('.occurrence').count()).toBe(2)
    expect(await wordGroup.locator('.vocab-definition').textContent()).not.toContain('词典未收录')

    const inkpick = await vocabGroup('InkPick')
    expect(await inkpick.locator('.vocab-definition').textContent()).toBe('这个阅读器本身')
  })
})
