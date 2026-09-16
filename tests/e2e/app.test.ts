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
import { DEFAULT_DAILY_NEW } from '../../src/core/review'

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

/** 把原生确认框换成固定回答，并记下它收到的文案 */
async function stubConfirm(response: 0 | 1): Promise<void> {
  await app.evaluate(({ dialog }, value) => {
    const store = globalThis as unknown as { __inkpickConfirm?: unknown }
    dialog.showMessageBox = (async (options: unknown) => {
      store.__inkpickConfirm = options
      return { response: value, checkboxChecked: false }
    }) as unknown as typeof dialog.showMessageBox
  }, response)
}

interface ConfirmOptionsSeen {
  message?: string
  detail?: string
  buttons?: string[]
  defaultId?: number
}

async function lastConfirmOptions(): Promise<ConfirmOptionsSeen> {
  return app.evaluate(
    () => (globalThis as unknown as { __inkpickConfirm?: ConfirmOptionsSeen }).__inkpickConfirm ?? {}
  )
}

/** 导出被取消的场景 */
async function stubSaveDialogCanceled(): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
}

/**
 * 相对亮度 → 对比度（WCAG 2.x）。公式抄自规范，用来代替「肉眼看一眼」。
 * 纯计算，不依赖日志库，这样开发脚本里也能用。
 */
function contrast(foreground: string, background: string): number {
  const luminance = (color: string): number => {
    const channels = (color.match(/\d+/g) ?? ['0', '0', '0'])
      .slice(0, 3)
      .map((value) => {
        const c = Number(value) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }

  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
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
  // 中间有测试会自己关掉应用，已经关了就别再关
  try {
    if (app) await app.close()
  } catch {
    // 已经退出，忽略
  }
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

  it('笔记条目里先显示原文（位置），再显示自己写的内容', async () => {
    // 用户反馈：这两行换一下更好认 —— 靠原文句子认出「这条记在哪儿」更快
    const order = await page
      .locator('.annotation')
      .first()
      .locator('.annotation-text > *')
      .evaluateAll((nodes) => nodes.map((node) => node.tagName.toLowerCase()))
    expect(order.slice(0, 2)).toEqual(['em', 'strong'])

    // 上一个是原文那句，下一个是自己写的
    expect(await page.locator('.annotation em').textContent()).toContain('trained to skim')
    expect(await page.locator('.annotation strong').textContent()).toBe('这句是关键')
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

  it('切到「全部」后同一个词跨书合并成一组，并标出各自出处', async () => {
    await page.getByRole('button', { name: '全部', exact: true }).click()

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

describe('阅读体验', () => {
  const bodyFontSize = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.querySelector('.reader-body')!).fontSize)

  const bodyLineHeight = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.querySelector('.reader-body')!).lineHeight)

  const bodyWidth = (): Promise<number> =>
    page.evaluate(() => document.querySelector('.reader-body')!.getBoundingClientRect().width)

  const theme = (): Promise<string> =>
    page.evaluate(() => document.documentElement.dataset.theme ?? '')

  const appBackground = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  const scrollTopOfReader = (): Promise<number> =>
    page.evaluate(() => Math.round(document.querySelector('.reader-scroll')?.scrollTop ?? -1))

  /**
   * 等滚动停下来。
   * Chromium 的滚轮滚动带惯性动画，不等它结束的话，后面设置的 scrollTop
   * 会被仍在运行的动画盖掉（实测踩过，表现为「置 0 之后自己跑到 30」）。
   */
  const waitForScrollSettled = async (): Promise<void> => {
    let last = -1
    for (let i = 0; i < 40; i++) {
      const now = await scrollTopOfReader()
      if (now === last) return
      last = now
      await page.waitForTimeout(50)
    }
  }

  // 设置现在全在工具栏上，不需要「关面板」了

  it('四组设置都在工具栏上，一次点击到位', async () => {
    // 字号：微调用 A- / A+
    expect(await page.getByRole('button', { name: '放大字号' }).count()).toBe(1)
    expect(await page.getByRole('button', { name: '缩小字号' }).count()).toBe(1)

    // 行距 / 行宽 / 主题：每个选项一个按钮，不用先展开面板
    for (const label of ['行距 紧凑', '行距 标准', '行距 宽松', '行宽 窄', '行宽 中', '行宽 宽', '主题 浅色', '主题 护眼', '主题 深色']) {
      expect(await page.getByRole('button', { name: label }).count(), label).toBe(1)
    }

    // 不再有需要先打开的面板
    expect(await page.locator('.settings-panel').count()).toBe(0)
  })

  it('当前档位在工具栏上能看出来', async () => {
    expect(await page.getByRole('button', { name: '主题 浅色' }).getAttribute('aria-pressed')).toBe('true')
    expect(await page.getByRole('button', { name: '主题 深色' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('放大字号会真的改变正文字号', async () => {
    const before = await bodyFontSize()
    await page.getByRole('button', { name: '放大字号' }).click()
    await expect.poll(bodyFontSize).not.toBe(before)
    expect(parseFloat(await bodyFontSize())).toBeGreaterThan(parseFloat(before))
  })

  it('字号到顶后不再变化（不循环回最小值）', async () => {
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '放大字号' }).click()
    expect(await bodyFontSize()).toBe('24px')

    await page.getByRole('button', { name: '缩小字号' }).click()
    await expect.poll(bodyFontSize).toBe('21px')
  })

  it('点行距按钮直接切到那一档，不用按顺序转一圈', async () => {
    const before = await bodyLineHeight()

    await page.getByRole('button', { name: '行距 紧凑' }).click()
    await expect.poll(bodyLineHeight).not.toBe(before)
    expect(parseFloat(await bodyLineHeight())).toBeLessThan(parseFloat(before))

    // 直接跳到另一档，中间那档不需要经过
    await page.getByRole('button', { name: '行距 宽松' }).click()
    await expect.poll(async () => parseFloat(await bodyLineHeight())).toBeGreaterThan(parseFloat(before))
  })

  it('点行宽按钮会改变正文宽度', async () => {
    const before = await bodyWidth()

    await page.getByRole('button', { name: '行宽 宽' }).click()
    await expect.poll(bodyWidth).toBeGreaterThan(before)

    await page.getByRole('button', { name: '行宽 窄' }).click()
    await expect.poll(bodyWidth).toBeLessThan(before)
  })

  it('点主题按钮会换掉整页配色', async () => {
    const light = await appBackground()
    expect(await theme()).toBe('light')

    await page.getByRole('button', { name: '主题 护眼' }).click()
    await expect.poll(theme).toBe('sepia')
    const sepia = await appBackground()
    expect(sepia).not.toBe(light)

    await page.getByRole('button', { name: '主题 深色' }).click()
    await expect.poll(theme).toBe('dark')
    expect(await appBackground()).not.toBe(sepia)
  })

  it('阅读区不再有原生滚动条，正文不再被它占掉宽度', async () => {
    const metrics = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.reader-scroll')!
      return {
        // 有原生滚动条时 offset - client 约等于 15
        scrollbarWidth: el.offsetWidth - el.clientWidth,
        overflow: el.scrollHeight - el.clientHeight
      }
    })

    // 先确认内容确实超出一屏，否则「没滚动条」是靠不住的空断言
    expect(metrics.overflow).toBeGreaterThan(50)
    expect(metrics.scrollbarWidth).toBe(0)
  })

  it('没有滚动条也能滚：滚轮与 PageDown 都行', async () => {
    await page.evaluate(() => {
      document.querySelector('.reader-scroll')!.scrollTop = 0
    })

    await page.mouse.move(400, 400)
    await page.mouse.wheel(0, 200)
    await expect.poll(scrollTopOfReader).toBeGreaterThan(50)

    const afterWheel = await scrollTopOfReader()
    // 点一下正文再按 PageDown
    await page.locator('.reader-body').click({ position: { x: 40, y: 40 } })
    await page.keyboard.press('PageDown')
    await expect.poll(scrollTopOfReader).toBeGreaterThan(afterWheel)

    await waitForScrollSettled()
  })

  it('正文可聚焦，键盘用户能拿到焦点提示', async () => {
    expect(await page.evaluate(() => document.querySelector('.reader-scroll')!.getAttribute('tabindex'))).toBe('0')
  })

  it('三套主题的正文对比度都达得到 WCAG AA', async () => {
    // 看不到界面的时候，算对比度比“看一眼”更可靠
    const themes = ['light', 'sepia', 'dark']
    for (const target of themes) {
      await page.evaluate((name) => {
        document.documentElement.dataset.theme = name
      }, target)

      const colors = await page.evaluate(() => {
        const body = getComputedStyle(document.body)
        const reader = getComputedStyle(document.querySelector('.reader-body')!)
        const meta = getComputedStyle(document.querySelector('.reader-meta')!)
        const docs = getComputedStyle(document.querySelector('.doc-item')!)
        return {
          bg: body.backgroundColor,
          text: body.color,
          reader: reader.color,
          meta: meta.color,
          docItem: docs.color
        }
      })

      // 正文（正常字号）要求 4.5:1
      expect(contrast(colors.reader, colors.bg), `${target} 正文对比度`).toBeGreaterThanOrEqual(4.5)
      // 次要信息（小字）放宽到 4.5 仍应满足，至少不能低于 3
      expect(contrast(colors.meta, colors.bg), `${target} 次要文字对比度`).toBeGreaterThanOrEqual(3)
      expect(contrast(colors.docItem, colors.bg), `${target} 侧栏文字对比度`).toBeGreaterThanOrEqual(4.5)
    }

    // 切回深色，后面的测试与存档断言依赖它
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
  })

  it('进度条能显示百分比并跳转', async () => {
    // 先回到顶部，确保有可滚动的空间
    await page.evaluate(() => {
      document.querySelector('.reader-scroll')!.scrollTop = 0
    })
    await expect.poll(async () => page.locator('.progress-value').textContent()).toBe('0%')

    const track = page.locator('.progress-track')
    const box = (await track.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2)

    await expect.poll(async () => parseFloat((await page.locator('.progress-value').textContent()) ?? '0')).toBeGreaterThan(60)
    expect(await page.evaluate(() => document.querySelector('.reader-scroll')!.scrollTop)).toBeGreaterThan(0)
  })

  it('阅读偏好会写进存档', async () => {
    await app.close()
    const raw = await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')
    const persisted = JSON.parse(raw) as { prefs?: Record<string, unknown> }

    // 行宽/行距/主题停在前面几个用例最后点的那一档
    expect(persisted.prefs).toMatchObject({ fontSize: 21, lineHeight: 2.1, measure: 'narrow', theme: 'dark' })
    await launch()
  })

  it('重开后偏好还在', async () => {
    await page.waitForSelector('.reader')
    expect(await theme()).toBe('dark')
    expect(await bodyFontSize()).toBe('21px')
  })
})

describe('文档管理', () => {
  it('可以重命名文档', async () => {
    await page.getByRole('button', { name: '重命名 second-book' }).click()
    await page.locator('.doc-rename').fill('第二本书')
    await page.keyboard.press('Enter')

    await expect.poll(async () => page.locator('.doc-title').allTextContents()).toContain('第二本书')
    expect(await page.locator('.doc-rename').count()).toBe(0)
  })

  it('取消删除时什么都不会发生', async () => {
    await stubConfirm(1)
    await page.getByRole('button', { name: '删除 第二本书' }).click()

    const options = await lastConfirmOptions()
    // 必须写清会连带删掉多少东西
    expect(options.detail).toContain('1 条标注')
    expect(options.detail).toContain('不可撤销')
    expect(options.buttons?.[0]).toBe('删除')
    // 默认与 Esc 都停在「取消」上，随手回车不该删数据
    expect(options.defaultId).toBe(1)

    expect(await page.locator('.doc-item').count()).toBe(2)
  })

  it('确认删除后级联清掉它的标注', async () => {
    await stubConfirm(0)
    await page.getByRole('button', { name: '删除 第二本书' }).click()

    await expect.poll(async () => page.locator('.doc-item').count()).toBe(1)
    expect(await page.locator('.toast').textContent()).toContain('已删除《第二本书》和 1 条标注')

    // 当前打开的示例文档不受影响
    expect(await page.locator('.reader-header h1').textContent()).toBe('示例 · On Reading')
  })

  it('跨文档视图下已删文档的标注不会再冒出来', async () => {
    await page.getByRole('button', { name: '全部', exact: true }).click()

    const group = await vocabGroup('word')
    await expect.poll(async () => group.locator('.occurrence').count()).toBe(2)

    // 出处标签里不应再出现已删的那本书
    const sources = await group.locator('.occurrence-source').allTextContents()
    expect(sources).toEqual(['示例 · On Reading', '示例 · On Reading'])

    await page.getByRole('button', { name: '本文件' }).click()
  })
})

describe('删除标注可以撤销', () => {
  it('删完弹出带撤销按钮的提示', async () => {
    const inkpick = await vocabGroup('InkPick')
    await inkpick.locator('.annotation-remove').click()

    await expect.poll(async () => page.locator('.vocab-group').count()).toBe(2)
    expect(await page.locator('.toast-action').textContent()).toBe('撤销')
  })

  it('点撤销后标注回到原来的位置', async () => {
    await page.locator('.toast-action').click()

    await expect.poll(async () => page.locator('.vocab-group').count()).toBe(3)
    await expect.poll(async () => page.locator('.toast').textContent()).toContain('已恢复')

    // 手写释义跟着一起回来，说明恢复的是完整对象而不是重建的
    const inkpick = await vocabGroup('InkPick')
    expect(await inkpick.locator('.vocab-definition').textContent()).toBe('这个阅读器本身')
  })
})

describe('笔记可以编辑', () => {
  it('点编辑后带着现有内容进入编辑态', async () => {
    await page.getByRole('button', { name: '编辑笔记' }).click()

    await page.waitForSelector('.note-editor textarea')
    expect(await page.locator('.note-editor textarea').inputValue()).toBe('这句是关键')
  })

  it('Esc 取消后内容不变', async () => {
    await page.locator('.note-editor textarea').fill('改了但不保存')
    await page.keyboard.press('Escape')

    await expect.poll(async () => page.locator('.note-editor').count()).toBe(0)
    expect(await page.locator('.annotation strong').textContent()).toBe('这句是关键')
  })

  it('保存后内容真的改了', async () => {
    await page.getByRole('button', { name: '编辑笔记' }).click()
    await page.locator('.note-editor textarea').fill('这句概括了整本书')
    await page.getByRole('button', { name: '保存' }).click()

    await expect.poll(async () => page.locator('.note-editor').count()).toBe(0)
    expect(await page.locator('.annotation strong').textContent()).toBe('这句概括了整本书')
  })
})

describe('侧栏', () => {
  const sidebarWidth = (): Promise<number> =>
    page.evaluate(() => document.querySelector('.sidebar-wrap')?.getBoundingClientRect().width ?? 0)

  it('可以收起，收起后侧栏不再渲染', async () => {
    await expect.poll(sidebarWidth).toBeGreaterThan(200)

    await page.getByRole('button', { name: '隐藏侧栏' }).click()

    await expect.poll(async () => page.locator('.sidebar').count()).toBe(0)
    expect(await page.locator('.app').getAttribute('data-sidebar')).toBe('collapsed')
  })

  it('收起后按钮变成「显示侧栏」，正文占满宽度', async () => {
    const toggle = page.getByRole('button', { name: '显示侧栏' })
    expect(await toggle.count()).toBe(1)

    const readerLeft = await page.evaluate(
      () => document.querySelector('.reader-header')!.getBoundingClientRect().left
    )
    expect(readerLeft).toBeLessThan(40)
  })

  it('Ctrl+B 也能切换，且在输入框里不抢键', async () => {
    await page.keyboard.press('Control+b')
    await expect.poll(async () => page.locator('.sidebar').count()).toBe(1)

    // 在搜索框以外的输入框里（重命名）按 Ctrl+B 不应折叠侧栏
    await page.keyboard.press('Control+b')
    await expect.poll(async () => page.locator('.sidebar').count()).toBe(0)
    await page.keyboard.press('Control+b')
    await expect.poll(async () => page.locator('.sidebar').count()).toBe(1)
  })

  it('拖动把手可以调宽', async () => {
    const before = await sidebarWidth()
    const handle = page.locator('.sidebar-resizer')
    const box = (await handle.boundingBox())!

    await page.mouse.move(box.x + box.width / 2, box.y + 200)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + 200, { steps: 5 })
    await page.mouse.up()

    await expect.poll(sidebarWidth).toBeGreaterThan(before + 60)
  })

  it('宽度被夹在合法范围里', async () => {
    const handle = page.locator('.sidebar-resizer')
    const box = (await handle.boundingBox())!

    // 注意：拖拽路径必须留在窗口内。把指针拖出窗口再松手，pointerup 可能递不到。
    // 不能用 viewportSize()：Electron 里它是 null，要用窗口自身的宽度
    const windowWidth = await page.evaluate(() => window.innerWidth)

    // 拽到极窄
    await page.mouse.move(box.x + box.width / 2, box.y + 200)
    await page.mouse.down()
    await page.mouse.move(5, box.y + 200, { steps: 3 })
    await page.mouse.up()
    //
    // 必须用 expect.poll，不能裸读：pointermove 属于「连续事件」，
    // React 会把这一串 setState 批处理，page.evaluate 可能在渲染前就执行，
    // 于是读到拖拽前的宽度。实测这个写法大约有一半概率会假失败。
    await expect.poll(sidebarWidth).toBe(200)

    // 拽到极宽（但仍在窗口内）
    const again = (await handle.boundingBox())!
    await page.mouse.move(again.x + again.width / 2, again.y + 200)
    await page.mouse.down()
    await page.mouse.move(windowWidth - 5, again.y + 200, { steps: 3 })
    await page.mouse.up()
    await expect.poll(sidebarWidth).toBe(520)
  })

  it('双击把手复位成默认宽度', async () => {
    await page.locator('.sidebar-resizer').dblclick()
    await expect.poll(sidebarWidth).toBe(320)
  })

  it('宽度会写进存档', async () => {
    const handle = page.locator('.sidebar-resizer')
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 200)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + 200, { steps: 3 })
    await page.mouse.up()

    await expect.poll(sidebarWidth, { message: '拖动后应立即变宽' }).toBeGreaterThan(340)
    const width = await sidebarWidth()
    await app.close()

    const raw = await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')
    const persisted = JSON.parse(raw) as { prefs?: { sidebarWidth?: number } }
    expect(persisted.prefs?.sidebarWidth).toBe(Math.round(width))

    await launch()
  })

  it('重开后宽度和收起状态都还在', async () => {
    await page.waitForSelector('.reader')
    await expect.poll(sidebarWidth).toBe(365)

    await page.getByRole('button', { name: '隐藏侧栏' }).click()
    await app.close()
    await launch()

    await page.waitForSelector('.reader')
    expect(await page.locator('.sidebar').count()).toBe(0)

    // 恢复成展开，后续测试要用侧栏
    await page.getByRole('button', { name: '显示侧栏' }).click()
    await expect.poll(async () => page.locator('.sidebar').count()).toBe(1)
  })
})

describe('搜索', () => {
  const scrollTop = (): Promise<number> =>
    page.evaluate(() => Math.round(document.querySelector('.reader-scroll')?.scrollTop ?? -1))

  /** 当前视口顶部所在的段落序号 —— 「回到原处」承诺的就是这个 */
  const topSegment = (): Promise<string | null> =>
    page.evaluate(() => {
      const container = document.querySelector('.reader-scroll')
      if (!container) return null
      const top = container.scrollTop + 8
      for (const element of document.querySelectorAll<HTMLElement>('[data-seg]')) {
        if (element.offsetTop + element.offsetHeight > top) return element.getAttribute('data-seg')
      }
      return null
    })

  /** 每个用例自己保证搜索框是开着的，不依赖上一个用例的收尾状态 */
  const openSearchBox = async (): Promise<void> => {
    if ((await page.locator('.search-input').count()) === 0) {
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await page.waitForSelector('.search-input')
    }
  }

  const currentMatch = async (): Promise<string> =>
    page.evaluate(() => {
      const highlight = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get(
        'inkpick-search-current'
      )
      return highlight ? [...highlight][0]?.toString() ?? '' : ''
    })

  const allMatchCount = async (): Promise<number> =>
    page.evaluate(() => {
      const highlight = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get('inkpick-search')
      return highlight ? [...highlight].length : 0
    })

  /**
   * 当前命中在文中的位置，编码成可比较的数：段序号 * 10000 + 段内偏移。
   * 不能比文本（都是同一个词），也不能比纵坐标（同一行的两处 Y 相同）。
   */
  const currentMatchPosition = async (): Promise<number> =>
    page.evaluate(() => {
      const highlight = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get(
        'inkpick-search-current'
      )
      const range = highlight ? [...highlight][0] : undefined
      if (!range) return -1
      const node = range.startContainer
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
      const segment = element?.closest('[data-seg]')
      if (!segment) return -1
      return Number(segment.getAttribute('data-seg')) * 10000 + range.startOffset
    })

  it('点搜索才打开输入框', async () => {
    expect(await page.locator('.search-input').count()).toBe(0)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    expect(await page.locator('.search-input').count()).toBe(1)
  })

  it('输入后显示命中数，但不自动跳过去', async () => {
    await openSearchBox()
    const before = await scrollTop()
    await page.locator('.search-input').fill('habit')

    // 示例文本里 habit 只出现一次。0/1 = 有命中但还没跳过去
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe('0/1')
    expect(await allMatchCount()).toBe(1)
    expect(await currentMatch()).toBe('')

    // 关键：边输入边被拉走是上一版的毛病，现在不能发生
    expect(await scrollTop()).toBe(before)
  })

  it('按回车才跳到第一处', async () => {
    await openSearchBox()
    await page.locator('.search-input').press('Enter')

    await expect.poll(async () => page.locator('.search-count').textContent()).toBe('1/1')
    expect(await currentMatch()).toContain('habit')
  })

  it('命中多处时能上下跳，并绕回', async () => {
    await openSearchBox()
    await page.locator('.search-input').fill('the')

    const total = await allMatchCount()
    expect(total).toBeGreaterThan(3)
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe(`0/${total}`)

    await page.getByRole('button', { name: '下一个匹配' }).click()
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe(`1/${total}`)

    await page.getByRole('button', { name: '下一个匹配' }).click()
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe(`2/${total}`)

    // 上一个回到第一处
    await page.getByRole('button', { name: '上一个匹配' }).click()
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe(`1/${total}`)

    // 从第一处往前绕到最后一处
    await page.getByRole('button', { name: '上一个匹配' }).click()
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe(`${total}/${total}`)
  })

  it('点下一个后当前命中会真的挪到下一处', async () => {
    await openSearchBox()
    await page.locator('.search-input').fill('the')

    await page.getByRole('button', { name: '下一个匹配' }).click()
    await expect.poll(currentMatchPosition).toBeGreaterThan(0)
    const first = await currentMatchPosition()

    await page.getByRole('button', { name: '下一个匹配' }).click()
    // 当前命中的文字都是 the，只能靠位置判断有没有往前跳
    await expect.poll(currentMatchPosition).toBeGreaterThan(first)
  })

  it('回车等于下一个，Shift+回车等于上一个', async () => {
    await openSearchBox()
    await page.locator('.search-input').fill('read')
    const total = await allMatchCount()
    expect(total).toBeGreaterThan(1)

    await page.locator('.search-input').press('Enter')
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe(`1/${total}`)

    await page.locator('.search-input').press('Enter')
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe(`2/${total}`)

    await page.locator('.search-input').press('Shift+Enter')
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe(`1/${total}`)
  })

  it('【回到原处】能回到开始搜索前读到的那一段', async () => {
    await openSearchBox()

    // 先把阅读位置挪到相对靠后的地方
    await page.evaluate(() => {
      const container = document.querySelector('.reader-scroll')!
      container.scrollTop = Math.round((container.scrollHeight - container.clientHeight) * 0.7)
    })
    await expect.poll(topSegment).not.toBe('0')
    const origin = await topSegment()

    // 关掉再重新打开搜索，让它记住当前位置
    await page.locator('.search-input').press('Escape')
    await expect.poll(async () => page.locator('.search-input').count()).toBe(0)
    await openSearchBox()

    // 跳到几处命中，确实离开了原处
    await page.locator('.search-input').fill('the')
    await page.locator('.search-input').press('Enter')
    await page.locator('.search-input').press('Enter')
    await page.locator('.search-input').press('Enter')

    await page.getByRole('button', { name: '回到原处' }).click()

    await expect.poll(topSegment).toBe(origin)
    // 回到原处后搜索框也关掉了
    expect(await page.locator('.search-input').count()).toBe(0)
  })

  it('搜不到时明确说「无匹配」，不留上一轮的高亮', async () => {
    await openSearchBox()
    await page.locator('.search-input').fill('zzzzqqqq')

    await expect.poll(async () => page.locator('.search-count').textContent()).toBe('无匹配')
    expect(await allMatchCount()).toBe(0)
    expect(await currentMatch()).toBe('')
  })

  it('大小写不敏感', async () => {
    await openSearchBox()
    await page.locator('.search-input').fill('HABIT')
    await expect.poll(async () => page.locator('.search-count').textContent()).toBe('0/1')
  })

  it('Esc 关闭并清空搜索', async () => {
    await openSearchBox()
    await page.locator('.search-input').fill('habit')
    await page.locator('.search-input').press('Escape')

    await expect.poll(async () => page.locator('.search-input').count()).toBe(0)
    expect(await allMatchCount()).toBe(0)
  })

  it('Ctrl+F 能直接打开搜索', async () => {
    await page.keyboard.press('Control+f')
    await expect.poll(async () => page.locator('.search-input').count()).toBe(1)

    // 收尾，后面的测试不依赖搜索框
    await page.locator('.search-input').press('Escape')
    await expect.poll(async () => page.locator('.search-input').count()).toBe(0)
  })
})

describe('看', () => {
  it('点某一次收藏能跳回原文，并标出当前位置', async () => {
    const group = await vocabGroup('word')
    await group.locator('.occurrence').first().click()

    await expect.poll(async () => group.locator('.occurrence.active').count()).toBe(1)

    // 跳转是平滑滚动，必须等动画走完，不能立即断言
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const paragraph = document.querySelector('[data-seg="2"]')
          if (!paragraph) return false
          const rect = paragraph.getBoundingClientRect()
          return rect.top >= -5 && rect.top < window.innerHeight
        })
      )
      .toBe(true)
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

    expect(persisted.docs).toHaveLength(1)
    expect(persisted.annotations).toHaveLength(4)

    const note = persisted.annotations.find((item) => item.type === 'note')
    // 笔记已被删，这里只剩词条；上面已断言总数为 4
    expect(note).toBeUndefined()

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

/**
 * 放在最后：这个 describe 会往书库里塞一批文档，
 * 前面的用例对文档数量有断言，所以不能提前跑。
 */
describe('侧栏布局', () => {
  const sectionBox = async (selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return null
      return {
        clientHeight: Math.round(el.clientHeight),
        scrollHeight: Math.round(el.scrollHeight),
        scrollbarWidth: el.offsetWidth - el.clientWidth
      }
    }, selector)

  it('塞进十几本书，文档区不会把标注区挤没', async () => {
    for (let i = 1; i <= 12; i++) {
      const file = join(exportDir, `bulk-${i}.txt`)
      await writeFile(file, `Book number ${i}. The word habit appears here.\n`, 'utf-8')
      await app.evaluate(({ dialog }, target) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
      }, file)
      await page.getByRole('button', { name: '打开 TXT' }).click()
      await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe(`bulk-${i}`)
    }

    const sidebarHeight = await page.evaluate(
      () => document.querySelector('.sidebar')!.getBoundingClientRect().height
    )
    const docSection = (await sectionBox('.sidebar-section'))!
    const annotationSection = (await sectionBox('.sidebar-section.grow'))!

    // 文档区被上限夹住，内容超出就自己滚
    expect(docSection.clientHeight).toBeLessThanOrEqual(Math.round(sidebarHeight * 0.42))
    expect(docSection.scrollHeight).toBeGreaterThan(docSection.clientHeight)

    // 标注区仍然有可用高度，而不是被压成一条
    expect(annotationSection.clientHeight).toBeGreaterThan(120)
  })

  it('侧栏滚动条宽度是可预期的，不再由系统主题决定', async () => {
    // 自绘滚动条仍然占位，但宽度固定在 12px（原来是系统给的 15px）
    const docSection = (await sectionBox('.sidebar-section'))!
    expect(docSection.scrollbarWidth).toBeLessThanOrEqual(12)
  })
})

/**
 * 章节。放在最后：这个 describe 会导入一本新的书并切换当前文档，
 * 前面的用例对文档数量与当前文档有断言。
 */
describe('章节', () => {
  /** 每章：1 个标题 + 10 段正文。所以第 c 章（从 1 数）的标题在第 (c-1)*11 段 */
  const BODY_PER_CHAPTER = 10
  const SEG_PER_CHAPTER = BODY_PER_CHAPTER + 1
  const TOTAL = 5
  const chapterHeadSeg = (c: number): number => (c - 1) * SEG_PER_CHAPTER

  const chapterFileName = 'chapters.txt'

  const scrollTop = (): Promise<number> =>
    page.evaluate(() => Math.round(document.querySelector('.reader-scroll')?.scrollTop ?? -1))

  /** 视口顶部所在的段落序号 —— 章节断言一律比段号，不比纵坐标 */
  const topSegment = (): Promise<number> =>
    page.evaluate(() => {
      const container = document.querySelector('.reader-scroll')
      if (!container) return -1
      const top = container.scrollTop + 8
      for (const element of document.querySelectorAll<HTMLElement>('[data-seg]')) {
        if (element.offsetTop + element.offsetHeight > top) {
          return Number(element.getAttribute('data-seg'))
        }
      }
      return -1
    })

  const chapterName = async (): Promise<string> =>
    (await page.locator('.chapter-name').textContent()) ?? ''
  const chapterPos = async (): Promise<string> =>
    (await page.locator('.chapter-pos').textContent()) ?? ''

  /** 每个用例自己保证目录是开着的，不依赖上一个用例的收尾状态 */
  const openToc = async (): Promise<void> => {
    if ((await page.locator('.chapter-list').count()) === 0) {
      await page.getByRole('button', { name: '目录', exact: true }).click()
      await page.waitForSelector('.chapter-list')
    }
  }

  const openDocs = async (): Promise<void> => {
    if ((await page.locator('.doc-list').count()) === 0) {
      await page.getByRole('button', { name: '文档', exact: true }).click()
      await page.waitForSelector('.doc-list')
    }
  }

  const clickChapter = async (title: string): Promise<void> => {
    await openToc()
    await page.locator('.chapter-item', { hasText: title }).first().click()
    await expect.poll(chapterName).toBe(title)
  }

  it('导入一本有章节的书，目录里章数与标题都正确', async () => {
    const parts: string[] = []
    for (let c = 1; c <= TOTAL; c++) {
      parts.push(`第${c}章 第${c}段故事`)
      for (let p = 1; p <= BODY_PER_CHAPTER; p++) {
        parts.push(`这是第${c}章的第${p}段正文，写长一点，让每一章都比一屏更高，上下章跳转才有可见的效果。`)
      }
    }
    const file = join(exportDir, chapterFileName)
    await writeFile(file, `${parts.join('\n')}\n`, 'utf-8')
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, file)
    await page.getByRole('button', { name: '打开 TXT' }).click()

    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe('chapters')
    // 章节栏出现，且显示第 1 章
    await page.waitForSelector('.chapter-nav')
    await openToc()
    await expect.poll(async () => page.locator('.chapter-item').count()).toBe(TOTAL)
    expect(await page.locator('.chapter-item-title').allTextContents()).toEqual([
      '第1章 第1段故事',
      '第2章 第2段故事',
      '第3章 第3段故事',
      '第4章 第4段故事',
      '第5章 第5段故事'
    ])
  })

  it('目录里的每一章都标了字数，点它能跳过去', async () => {
    await openToc()
    expect(await page.locator('.chapter-item-meta').first().textContent()).toMatch(/\d[\d,]* 字符/)

    const before = await scrollTop()
    await clickChapter('第4章 第4段故事')

    // 顶端对齐：视口顶部正好是第 4 章的标题段
    expect(await topSegment()).toBe(chapterHeadSeg(4))
    expect(await scrollTop()).toBeGreaterThan(before)
    expect(await chapterPos()).toBe(`4 / ${TOTAL}`)
    // 目录高亮跟着走
    expect(await page.locator('.chapter-item.active .chapter-item-title').textContent()).toBe('第4章 第4段故事')
  })

  it('「下一章」到下一章开头，「上一章」回到本章开头', async () => {
    await clickChapter('第2章 第2段故事')
    expect(await topSegment()).toBe(chapterHeadSeg(2))

    await page.getByRole('button', { name: '下一章', exact: true }).click()
    await expect.poll(topSegment).toBe(chapterHeadSeg(3))
    expect(await chapterName()).toBe('第3章 第3段故事')

    await page.getByRole('button', { name: '上一章', exact: true }).click()
    await expect.poll(topSegment).toBe(chapterHeadSeg(2))
    expect(await chapterName()).toBe('第2章 第2段故事')
  })

  it('«上一章» 在章中间时先回本章开头，再按一次才去上一章', async () => {
    await clickChapter('第3章 第3段故事')

    // 往下滚过几段，停在章中间（不跨章）
    await page.evaluate(() => {
      const container = document.querySelector('.reader-scroll')
      if (container) container.scrollTop += 400
    })
    await expect.poll(topSegment).toBeGreaterThan(chapterHeadSeg(3))
    const mid = await topSegment()

    // 第一次：回到本章开头，而不是直接跳走
    await page.getByRole('button', { name: '上一章', exact: true }).click()
    await expect.poll(topSegment).toBe(chapterHeadSeg(3))
    expect(await chapterName()).toBe('第3章 第3段故事')
    expect(mid).toBeGreaterThan(chapterHeadSeg(3))

    // 第二次：已经在开头了，这才去上一章
    await page.getByRole('button', { name: '上一章', exact: true }).click()
    await expect.poll(topSegment).toBe(chapterHeadSeg(2))
  })

  it('章首时「上一章」不可点，章尾时「下一章」不可点', async () => {
    await clickChapter('第1章 第1段故事')
    expect(await page.getByRole('button', { name: '上一章', exact: true }).isDisabled()).toBe(true)
    expect(await page.getByRole('button', { name: '下一章', exact: true }).isDisabled()).toBe(false)

    // 滚到第 1 章中段，「上一章」应该可以点了（回本章开头是有意义的）
    await page.evaluate(() => {
      const container = document.querySelector('.reader-scroll')
      if (container) container.scrollTop += 400
    })
    await expect.poll(async () => page.getByRole('button', { name: '上一章', exact: true }).isDisabled()).toBe(false)

    await clickChapter(`第${TOTAL}章 第${TOTAL}段故事`)
    expect(await page.getByRole('button', { name: '下一章', exact: true }).isDisabled()).toBe(true)
  })

  it('快捷键 [ 和 ] 也能翻章', async () => {
    await clickChapter('第1章 第1段故事')
    await page.locator('.reader-body').click({ position: { x: 40, y: 40 } })

    await page.keyboard.press(']')
    await expect.poll(topSegment).toBe(chapterHeadSeg(2))

    await page.keyboard.press(']')
    await expect.poll(topSegment).toBe(chapterHeadSeg(3))

    await page.keyboard.press('[')
    await expect.poll(topSegment).toBe(chapterHeadSeg(2))
  })

  it('在输入框里按 [ 不翻章', async () => {
    await clickChapter('第2章 第2段故事')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page.locator('.search-input').fill('正文')
    await page.locator('.search-input').press('[')
    // 输入框里的 [ 应该进到输入框，而不是触发翻章
    expect(await page.locator('.search-input').inputValue()).toContain('[')
    expect(await topSegment()).toBe(chapterHeadSeg(2))
    await page.getByRole('button', { name: '关闭搜索', exact: true }).click()
  })

  it('章名跟着滚动位置更新', async () => {
    await clickChapter('第1章 第1段故事')
    expect(await chapterName()).toBe('第1章 第1段故事')

    // 直接滚到底：最后一章比一屏高，视口顶部必然落在最后一章里
    await page.evaluate(() => {
      const container = document.querySelector('.reader-scroll')
      if (container) container.scrollTop = container.scrollHeight - container.clientHeight
    })
    await expect.poll(chapterName).toBe(`第${TOTAL}章 第${TOTAL}段故事`)
    expect(await chapterPos()).toBe(`${TOTAL} / ${TOTAL}`)

    // 回顶：书名下面那一段不属于任何一章，显示「卷首」
    await page.evaluate(() => {
      const container = document.querySelector('.reader-scroll')
      if (container) container.scrollTop = 0
    })
    await expect.poll(chapterName).toBe('第1章 第1段故事')
  })

  it('章尾有「本章完」分隔线，且它没有嵌进段落里', async () => {
    // 5 章 → 4 条分隔线（第一章前面不需要）
    expect(await page.locator('.chapter-divider').count()).toBe(TOTAL - 1)
    expect(await page.locator('.chapter-divider').first().textContent()).toBe('本章完')

    // ★ 防回归：分隔线必须是 [data-seg] 段落的兄弟节点。
    // 一旦有人把它挪进段落，selection.ts 的 textNodeOf() 会取到非文本节点，
    // 那个段落的所有高亮与跳转会静默失效。
    //
    // 这个坑隐蔽的地方在于：它**只影响章标题那一小段**（最不可能被标注的位置），
    // 其它用例全都发现不了 —— 所以这条结构断言是唯一的防线，必须逐条查。
    const structure = await page.evaluate(() =>
      [...document.querySelectorAll('.chapter-divider')].map((divider) => ({
        nested: divider.closest('[data-seg]') !== null,
        parent: divider.parentElement?.className ?? ''
      }))
    )
    expect(structure).toHaveLength(TOTAL - 1)
    for (const item of structure) {
      expect(item.nested).toBe(false)
      expect(item.parent).toBe('reader-body')
    }

    // 不让选区端点落在它上面，否则整个选区会被丢弃
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('.chapter-divider') as Element).userSelect
      )
    ).toBe('none')
  })

  it('有分隔线的情况下，划词收藏的位置依然准确', async () => {
    // 第 2 章的第一段正文在 seg 12。能选中并正确回填，就说明
    // 分隔线没有打乱「段落序号 ⇄ 全文偏移」这套换算。
    //
    // 先把这段滚进视口：浮动工具条是按选区矩形定位的，
    // 选区在屏幕外时工具条也会落在屏幕外（真实使用中选不中屏幕外的字，
    // 所以这里只要把场景摆对；工具条被裁切是另一个已知问题）。
    await page.evaluate(() => {
      document.querySelector('[data-seg="12"]')?.scrollIntoView({ block: 'center' })
    })
    await collectWord(12, '第2章')
    const group = await vocabGroup('第2章')

    // 高亮的范围必须落回同一段，且文本与选中一致
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const highlights = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights
          const highlight = highlights?.get('inkpick-vocab')
          const range = highlight ? [...highlight][0] : undefined
          if (!range) return null
          const node = range.startContainer
          const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
          return { text: range.toString(), seg: element?.closest('[data-seg]')?.getAttribute('data-seg') }
        })
      )
      .toEqual({ text: '第2章', seg: '12' })

    // 上下文取的是所在句，不会取到隔壁章去
    expect(await group.locator('.occurrence-context').first().textContent()).toContain('这是第2章的第1段正文')
  })

  it('没有章节标记的书：章节栏隐藏，目录标签不可点', async () => {
    await openDocs()
    await page.locator('.doc-item', { hasText: '示例 · On Reading' }).first().click()
    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe('示例 · On Reading')

    // 识别不出章节时整个功能消失，而不是给一堆垃圾章节
    expect(await page.locator('.chapter-nav').count()).toBe(0)
    expect(await page.locator('.chapter-divider').count()).toBe(0)
    expect(await page.getByRole('button', { name: '目录', exact: true }).isDisabled()).toBe(true)

    // 正文照常可读
    expect(await page.locator('[data-seg]').count()).toBeGreaterThan(3)
  })
})

/**
 * 手动记词。放在最后：它会改词表内容，前面的用例对列表有断言。
 *
 * 这个 describe 检查的主线是「**不导入任何书也能用**」——
 * 一个只想记单词、不读书的用户，不应该在任何一步卡住。
 */
describe('手动记词', () => {
  const openAddWord = async (): Promise<void> => {
    if ((await page.locator('.add-word-input').count()) === 0) {
      await page.getByRole('button', { name: '手动添加单词' }).click()
      await page.waitForSelector('.add-word-input')
    }
  }

  const addWord = async (term: string): Promise<void> => {
    await openAddWord()
    await page.locator('.add-word-input').fill(term)
    await page.locator('.add-word-input').press('Enter')
  }

  /** 词表里能看到的所有词条名 */
  const lemmaList = (): Promise<string[]> =>
    page.locator('.vocab-head strong').allTextContents()

  it('没有导入任何书时，词表也是可用的（这里曾经是两个灰按钮）', async () => {
    // 删掉所有书，回到「只有手动记的词」的状态。
    // 注意两件事：确认框的桩必须在点之前装好（不然会弹真的原生框卡住），
    // 以及按钮名要用 exact —— 不写的话「删除 bulk-1」会同时命中 bulk-10/11/12。
    await page.getByRole('button', { name: '文档', exact: true }).click()
    for (let guard = 0; guard < 40; guard++) {
      const count = await page.locator('.doc-item').count()
      if (count === 0) break
      const title = await page.locator('.doc-item .doc-title').first().textContent()
      await stubConfirm(0)
      await page.getByRole('button', { name: `删除 ${title}`, exact: true }).click()
      await expect.poll(async () => page.locator('.doc-item').count()).toBe(count - 1)
    }
    await expect.poll(async () => page.locator('.doc-item').count()).toBe(0)

    // 关键：范围按钮不再是灰的，「全部」能点、能看词表
    const allTab = page.getByRole('button', { name: '全部', exact: true })
    expect(await allTab.isDisabled()).toBe(false)
    expect(await page.locator('.annotation-list').count()).toBe(1)
  })

  it('在欢迎页也能直接记一个词', async () => {
    await expect.poll(async () => page.locator('.welcome h1').count()).toBe(1)
    await page.getByRole('button', { name: '先记一个单词' }).click()

    // 侧栏收着的时候要先展开，否则输入框根本不在屏幕上
    await page.waitForSelector('.add-word-input')
    expect(await page.locator('.sidebar').count()).toBe(1)

    await page.locator('.add-word-input').fill('solitude')
    await page.locator('.add-word-input').press('Enter')
    await expect.poll(lemmaList).toContain('solitude')
  })

  it('连接着记多个：回车后清空并保持焦点', async () => {
    await openAddWord()
    const input = page.locator('.add-word-input')

    await input.fill('serendipity')
    await input.press('Enter')
    // 输入框清空，焦点还在 —— 这样能连着记一串而不用碰鼠标
    await expect.poll(async () => input.inputValue()).toBe('')
    expect(
      await page.evaluate(() => document.activeElement?.className ?? '')
    ).toContain('add-word-input')

    await input.fill('ephemeral')
    await input.press('Enter')
    await expect.poll(lemmaList).toContain('ephemeral')
    await expect.poll(lemmaList).toContain('serendipity')
  })

  it('释义自动查好，不用手填', async () => {
    await addWord('habit')
    const group = await vocabGroup('habit')
    // 手动记的词也走同一套查词：音标 + 释义
    await expect.poll(async () => (await group.locator('.vocab-definition').textContent()) ?? '').toMatch(/\S/)
  })

  it('词表里标出这个词是手动记的', async () => {
    const group = await vocabGroup('solitude')
    await expect.poll(async () => group.locator('.badge.manual').count()).toBe(1)
    expect(await group.locator('.badge.manual').textContent()).toBe('手动')
  })

  it('同一个词记两次会被拦住，不会变成两条', async () => {
    await addWord('habit')
    await expect.poll(async () => page.locator('.toast').textContent()).toContain('已经在词表里')

    // 大小写与空白不敏感
    await addWord('  HABIT  ')
    await expect.poll(async () => page.locator('.toast').textContent()).toContain('已经在词表里')

    // 词表里仍然只有一条 habit，而不是两条
    const habitCount = (await lemmaList()).filter((name) => name.toLowerCase() === 'habit').length
    expect(habitCount).toBe(1)
  })

  it('空输入不会存下任何东西', async () => {
    await openAddWord()
    const before = (await lemmaList()).length
    await page.locator('.add-word-input').fill('   ')
    await page.locator('.add-word-input').press('Enter')
    expect((await lemmaList()).length).toBe(before)
  })

  it('词典里查不到的词可以自己补一句释义', async () => {
    // 造一个词典里肯定没有的「词」
    await addWord('zzq-notaword')
    const group = await vocabGroup('zzq-notaword')

    await expect.poll(async () => group.locator('.missing').count()).toBeGreaterThan(0)
    await group.locator('.define-button').click()
    await group.locator('.define-editor input').fill('我自己编的释义')
    await group.locator('.define-editor button').click()
    await expect.poll(async () => group.locator('.vocab-definition').textContent()).toBe('我自己编的释义')
  })

  it('手动词会被写进存档，重开后还在', async () => {
    await app.close()
    const raw = await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')
    const persisted = JSON.parse(raw) as { annotations: { term?: string; anchor?: unknown; docId?: unknown }[] }

    const manual = persisted.annotations.filter((item) => item.term === 'solitude')
    expect(manual).toHaveLength(1)
    // 手动词在存档里就是没有 docId、没有 anchor
    expect(manual[0].anchor).toBeUndefined()
    expect(manual[0].docId).toBeUndefined()

    await launch()
    await page.waitForSelector('.welcome')
    await expect.poll(lemmaList).toContain('solitude')
  })

  it('手动词可以删掉，也能撤销回来', async () => {
    const group = await vocabGroup('ephemeral')
    await group.locator('.occurrence').first().locator('..').locator('.annotation-remove').click()

    await expect.poll(async () => page.locator('.toast').textContent()).toContain('已删除')
    await page.getByRole('button', { name: '撤销' }).click()
    await expect.poll(lemmaList).toContain('ephemeral')
  })
})

/**
 * 用户报的两个 bug 的回归测试。放在最后，沿用上面 describe 留下的应用实例。
 *
 * 依赖关系处理：这两个用例各自把需要的前置条件造出来（要书就自己导入一本书），
 * 不依赖上一个用例的收尾状态。
 */
describe('修过的两个 bug', () => {
  const openAddWord = async (): Promise<void> => {
    if ((await page.locator('.add-word-input').count()) === 0) {
      await page.getByRole('button', { name: '手动添加单词' }).click()
      await page.waitForSelector('.add-word-input')
    }
  }

  const addWord = async (term: string): Promise<void> => {
    await openAddWord()
    await page.locator('.add-word-input').fill(term)
    await page.locator('.add-word-input').press('Enter')
  }

  it('bug1：手动记的词那一行不再是「点了没反应的按钮」', async () => {
    await addWord('habit')
    const group = await vocabGroup('habit')

    // 它现在是一个 div —— 点了没反应的按钮比不能点更让人困惑
    await expect.poll(async () => group.locator('.occurrence-static').count()).toBe(1)
    expect(await group.locator('button.occurrence').count()).toBe(0)
    // 但「手动」标记还在，用户仍然能看出这个词是自己记的
    expect(await group.locator('.badge.manual').textContent()).toBe('手动')
    // 它也不该看起来能点：光标不能是手型
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('.occurrence-static') as Element).cursor
      )
    ).toBe('default')
  })

  it('bug1 反面：书里划到的词那一行仍然可以点回原文', async () => {
    // 造一本书，并把 resilience 同时做成「手动记的」和「书里划到的」
    const file = join(exportDir, 'mixed-source.txt')
    await writeFile(file, 'Reading slowly is a resilience habit worth keeping.\n', 'utf-8')
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, file)
    await page.getByRole('button', { name: '打开 TXT' }).click()
    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe('mixed-source')

    // 自己把范围切到「全部」：打开一本书会把列表切回「本文件」，
    // 而手动词不属于任何书，不切就看不到。不依赖上一个用例的收尾状态。
    await page.getByRole('button', { name: '全部', exact: true }).click()

    await addWord('solitude') // 造一个纯手动词的对照
    await addWord('resilience') // 已有则被去重拦住，不影响下面的断言
    await collectWord(0, 'resilience')

    const mixed = await vocabGroup('resilience')
    await expect.poll(async () => mixed.locator('.occurrence').count()).toBe(2)
    // 同一个词的两条：手动那条不可点，书里那条可点
    expect(await mixed.locator('.occurrence-static').count()).toBe(1)
    expect(await mixed.locator('button.occurrence').count()).toBe(1)

    await mixed.locator('button.occurrence').click()
    await expect.poll(async () => mixed.locator('.occurrence.active').count()).toBe(1)

    // 纯手动词的那个词里，一条可点的都没有
    const pure = await vocabGroup('solitude')
    expect(await pure.locator('button.occurrence').count()).toBe(0)
    expect(await pure.locator('.occurrence-static').count()).toBe(1)
  })

  it('bug2：给词典里有释义的词改写释义，显示的就是改写后的', async () => {
    // 手动词不属于任何书，先确保范围是「全部」
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await addWord('habit')
    const group = await vocabGroup('habit')

    // 前置条件：词典确实给了释义 —— 不然这条测的不是用户报的那个场景
    const before = (await group.locator('.vocab-definition').textContent()) ?? ''
    expect(before).not.toBe('')
    expect(before).not.toBe('我自己的理解')

    // 按钮上有词典释义时写的是「改写释义」，那就得真的能改写
    expect(await group.locator('.define-button').getAttribute('title')).toBe('改写释义')
    await group.locator('.define-button').click()
    await group.locator('.define-editor input').fill('我自己的理解')
    await group.locator('.define-editor button').click()

    await expect.poll(async () => group.locator('.vocab-definition').textContent()).toBe('我自己的理解')
  })

  it('bug2 补充：清空手写释义后回到词典的', async () => {
    await page.getByRole('button', { name: '全部', exact: true }).click()
    const group = await vocabGroup('habit')
    expect(await group.locator('.vocab-definition').textContent()).toBe('我自己的理解')

    await group.locator('.define-button').click()
    await group.locator('.define-editor input').fill('')
    await group.locator('.define-editor button').click()

    await expect.poll(async () => group.locator('.vocab-definition').textContent()).not.toBe('我自己的理解')
    await expect.poll(async () => (await group.locator('.vocab-definition').textContent()) ?? '').toContain('习惯')
  })
})

/**
 * 编码识别 / 存档备份恢复 / 划词去重。
 *
 * 这三条都是「让应用不出事」的修补，各自都能独立验证，
 * 所以放一起但互不依赖。放在最后：会导入新文档。
 */
describe('编码 · 备份 · 去重', () => {
  /** 用字节写文件，绕过 TextEncoder（它只会 UTF-8） */
  async function writeBytes(name: string, bytes: number[]): Promise<string> {
    const file = join(exportDir, name)
    await writeFile(file, Buffer.from(bytes))
    return file
  }

  async function importFile(file: string, expectTitle: string): Promise<void> {
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, file)
    await page.getByRole('button', { name: '打开 TXT' }).click()
    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe(expectTitle)
  }

  const firstParagraph = (): Promise<string> =>
    page.evaluate(() => document.querySelector('[data-seg="0"]')?.textContent ?? '')

  const secondParagraph = (): Promise<string> =>
    page.evaluate(() => document.querySelector('[data-seg="1"]')?.textContent ?? '')

  /** 输入条可能被上一个用例留着开着，先确认状态再点 */
  const openAddWordInput = async (): Promise<void> => {
    if ((await page.locator('.add-word-input').count()) === 0) {
      await page.getByRole('button', { name: '手动添加单词' }).click()
      await page.waitForSelector('.add-word-input')
    }
  }

  const addManualWord = async (term: string): Promise<void> => {
    await openAddWordInput()
    await page.locator('.add-word-input').fill(term)
    await page.locator('.add-word-input').press('Enter')
  }

  /** 等提示自己消失 —— 不然后面断言「没有提示」会被上一个用例残留的 toast 骗到 */
  const waitToastGone = async (): Promise<void> => {
    await expect.poll(async () => page.locator('.toast').count(), { timeout: 8000 }).toBe(0)
  }

  it('GBK 中文小说不再是一片乱码', async () => {
    // 「第一章\n正文第一段。\n」的 GBK 字节。
    // 注意标题必须**独占一行** —— 和正文写在同一行会被「拒绝句读」规则正确地拦掉
    const file = await writeBytes('gbk-novel.txt', [
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, // 第一章
      0x0a,
      0xd5, 0xfd, 0xce, 0xc4, 0xb5, 0xda, 0xd2, 0xbb, 0xb6, 0xce, // 正文第一段
      0xa1, 0xa3, // 。
      0x0a
    ])

    await importFile(file, 'gbk-novel')

    // 正文读对了，而不是「���ġ�」
    expect(await firstParagraph()).toBe('第一章')
    expect(await secondParagraph()).toBe('正文第一段。')

    // 换了编码要告诉用户，而且说明是推测的
    await expect.poll(async () => page.locator('.toast').textContent()).toContain('GBK')
    expect(await page.locator('.toast').textContent()).toContain('推测')
  })

  it('★ 章节功能在 GBK 文件上也能用（编码不对时它会静默失效）', async () => {
    // 这本书只有一章，所以只验证「认出来了」这一件事
    await expect.poll(async () => page.locator('.chapter-nav').count()).toBe(1)
    expect(await page.locator('.chapter-name').textContent()).toBe('第一章')
  })

  it('UTF-8 文件不提示编码（默认情况不该每次都多一句话）', async () => {
    await waitToastGone()

    const file = join(exportDir, 'utf8-novel.txt')
    await writeFile(file, '第一章\n正文第一段。\n', 'utf-8')
    await importFile(file, 'utf8-novel')

    expect(await secondParagraph()).toBe('正文第一段。')
    // 没换编码就不该有提示
    await page.waitForTimeout(400)
    expect(await page.locator('.toast').count()).toBe(0)
  })

  it('★ 主存档被写坏时，用备份恢复，并且明确告诉用户', async () => {
    // 先攒一点数据，确保 .bak 有内容
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await addManualWord('resilient')
    await expect.poll(async () => page.locator('.vocab-head strong').allTextContents()).toContain('resilient')

    // 关窗会触发一次落盘：这时 .bak 里就是「有 resilient」的那一版
    await app.close()
    const before = await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')
    expect(before).toContain('resilient')

    // 把主存档写坏，模拟被外部程序改烂 / 写一半断电
    await writeFile(join(userDataDir, 'inkpick-store.json'), '{"docs": [ 这不是 JSON', 'utf-8')

    await launch()
    await page.waitForSelector('.app')

    // 数据从备份回来了，而不是退回空库
    await expect.poll(async () => page.locator('.doc-item').count()).toBeGreaterThan(0)
    // 而且明确告诉用户发生了什么
    await expect.poll(async () => page.locator('.toast').textContent()).toContain('备份')
  })

  it('主存档坏了不会把好备份也毁掉（备份前先确认内容是合法的）', async () => {
    // 造一个「好备份 + 坏主文件」的局面：这正是备份存在的意义
    const good = JSON.stringify({
      version: 1,
      docs: [{ id: 'keep-me', title: '保命书', content: '正文', createdAt: 1 }],
      annotations: [],
      progress: {},
      lastDocId: 'keep-me',
      prefs: {}
    })
    await app.close()
    await writeFile(join(userDataDir, 'inkpick-store.json.bak'), good, 'utf-8')
    await writeFile(join(userDataDir, 'inkpick-store.json'), '{"docs": [ 被截断了', 'utf-8')

    await launch()
    await page.waitForSelector('.app')
    // 从备份恢复，书在
    await expect.poll(async () => page.locator('.doc-item').count()).toBe(1)

    // 现在动一下让它落盘。如果实现是「无条件拷主文件」，
    // 那一刻会把坏内容拷成 .bak，好备份就永久没了
    await page.getByRole('button', { name: '手动添加单词' }).click()
    await page.locator('.add-word-input').fill('after-corruption')
    await page.locator('.add-word-input').press('Enter')
    await page.waitForTimeout(500)
    await app.close()

    const backup = await readFile(join(userDataDir, 'inkpick-store.json.bak'), 'utf-8')
    // 备份里仍然是那份好数据，而不是被截断的垃圾
    expect(backup).toContain('保命书')
    expect(backup).not.toContain('被截断')

    await launch()
    await page.waitForSelector('.app')
  })

  it('主存档和备份都坏了也不会崩，只是退回空库', async () => {
    await app.close()
    await writeFile(join(userDataDir, 'inkpick-store.json'), 'garbage', 'utf-8')
    await writeFile(join(userDataDir, 'inkpick-store.json.bak'), 'also garbage', 'utf-8')

    await launch()
    await page.waitForSelector('.app')
    // 起来是能起来的，显示欢迎页
    await expect.poll(async () => page.locator('.welcome h1').count()).toBe(1)
  })

  it('写入前会把上一版留成 .bak（否则坏了就没有退路）', async () => {
    // 上一步两个文件都写坏了，库是空的。重新攒一点数据。
    await page.getByRole('button', { name: '先看看示例' }).click()
    await page.waitForSelector('.reader')
    // 等第一次落盘发生（防抖 300ms）。这一次不产生备份：
    // 启动时读到的是坏文件，内容不明，不拷贝。
    await page.waitForTimeout(500)

    // 手动词不属于任何书，得把范围切到「全部」才看得到
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await addManualWord('backupcheck')
    await expect.poll(async () => page.locator('.vocab-head strong').allTextContents()).toContain('backupcheck')
    // 等第二次落盘：这次会把上一份（已知合法）拷成 .bak
    await page.waitForTimeout(500)

    await app.close()

    const backup = await readFile(join(userDataDir, 'inkpick-store.json.bak'), 'utf-8').catch(() => '')
    expect(backup).toContain('"version"')
    // 备份的是**上一版**，所以还没有刚加的那个词（否则它就不是「恢复点」而是副本）
    expect(backup).not.toContain('backupcheck')

    await launch()
    await page.waitForSelector('.app')
  })

  it('★ 同一位置重复收藏不会生成两条', async () => {
    // 这本书有示例正文，划一个词收藏两次
    await page.getByRole('button', { name: '全部', exact: true }).click()
    const before = await page.locator('.vocab-group').count()

    await collectWord(0, 'Reading')
    await expect.poll(async () => page.locator('.vocab-group').count()).toBe(before + 1)

    // 再来一次：同一个词、同一个位置
    await collectWord(0, 'Reading')
    await expect.poll(async () => page.locator('.toast').textContent()).toContain('已经收过')
    // 词条数没变，也没有变成 ×2
    expect(await page.locator('.vocab-group').count()).toBe(before + 1)

    const group = await vocabGroup('reading')
    expect(await group.locator('.occurrence').count()).toBe(1)
    expect(await group.locator('.times').count()).toBe(0)
  })

  it('同一句话可以写两条不同的笔记（去重只针对词条）', async () => {
    const before = await page.locator('.annotation').count()

    await selectInParagraph(1, 'Speed')
    await page.getByRole('button', { name: '＋ 笔记' }).click()
    await page.locator('.modal textarea').fill('第一条')
    // 必须限定在弹层里：侧栏的「手动记词」行也有一个「保存」按钮
    await page.locator('.modal').getByRole('button', { name: /保存/ }).click()
    await page.waitForSelector('.modal', { state: 'detached' })

    await selectInParagraph(1, 'Speed')
    await page.getByRole('button', { name: '＋ 笔记' }).click()
    await page.locator('.modal textarea').fill('第二条')
    await page.locator('.modal').getByRole('button', { name: /保存/ }).click()
    await page.waitForSelector('.modal', { state: 'detached' })

    await expect.poll(async () => page.locator('.annotation').count()).toBe(before + 2)
  })
})

/**
 * 跳转后能回到原处。
 *
 * 用户报的问题：点侧栏的词/笔记跳到原文之后，回不到刚才读的地方。
 * 这里要守两件事，缺一件都等于位置真的丢了：
 *   1. 有个「返回」入口，能退回去（而且能连退几步）
 *   2. 跳转本身**不改写阅读进度** —— 否则忘了点返回、或者直接关掉应用，就真丢了
 *
 * 断言的写法：位置一律用「精确相等」而不是大小比较。
 * 大小比较看着更宽松，其实很脆 —— 跳转是「居中显示」，视口顶部会比目标段靠前，
 * 目标在文档末尾时更是会被夹到底部，于是「跳过去之后段号变大」根本不成立。
 */
describe('跳转后能回到原处', () => {
  const BOOK = 'jump-target'

  const topSegment = (): Promise<number> =>
    page.evaluate(() => {
      const container = document.querySelector('.reader-scroll')
      if (!container) return -1
      const top = container.scrollTop + 8
      for (const element of document.querySelectorAll<HTMLElement>('[data-seg]')) {
        if (element.offsetTop + element.offsetHeight > top) {
          return Number(element.getAttribute('data-seg'))
        }
      }
      return -1
    })

  /** 某个段落此刻在不在视口里 —— 「跳过去了」的正面证据 */
  const segmentVisible = (index: number): Promise<boolean> =>
    page.evaluate((target) => {
      const element = document.querySelector(`[data-seg="${target}"]`)
      const container = document.querySelector('.reader-scroll')
      if (!element || !container) return false
      const rect = element.getBoundingClientRect()
      const view = container.getBoundingClientRect()
      return rect.bottom > view.top && rect.top < view.bottom
    }, index)

  const waitScrollSettled = async (): Promise<void> => {
    let last = -1
    for (let i = 0; i < 40; i++) {
      const now = await page.evaluate(
        () => Math.round(document.querySelector('.reader-scroll')?.scrollTop ?? -1)
      )
      if (now === last) return
      last = now
      await page.waitForTimeout(50)
    }
  }

  /** 用滚轮滚 —— 程序设 scrollTop 不算「用户自己滚」，不会写阅读进度 */
  const wheelTo = async (deltaY: number): Promise<void> => {
    await page.locator('.reader-scroll').hover()
    await page.mouse.wheel(0, deltaY)
    await waitScrollSettled()
  }

  const backButton = () => page.getByRole('button', { name: '返回上一个位置' })

  /**
   * 把视口带到文档中段。
   *
   * 先滚到底再往回滚一段，而不是直接「往下滚一点」——
   * 上一个用例可能已经停在底部，再往下滚等于没动，起点就不确定了。
   */
  const scrollToMiddle = async (): Promise<void> => {
    await wheelTo(4000)
    await wheelTo(-900)
  }

  const clickAnnotation = async (lemma: string): Promise<void> => {
    const group = await vocabGroup(lemma)
    await group.locator('button.occurrence').first().click()
  }

  it('准备：导入一本够长的书，在两个不同位置各收一个词', async () => {
    const parts: string[] = []
    for (let i = 1; i <= 40; i++) {
      parts.push(`第${i}段 这是用来验证跳转的正文，写长一点才有滚动可言，也好判断位置。`)
    }
    parts[4] = '第五段 这里放一个 ancient 词，位置靠前。'
    parts[39] = '第四十段 这里放一个 sentinel 词，位置靠后。'

    const file = join(exportDir, `${BOOK}.txt`)
    await writeFile(file, `${parts.join('\n')}\n`, 'utf-8')
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, file)
    await page.getByRole('button', { name: '打开 TXT' }).click()
    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe(BOOK)

    await page.evaluate(() => document.querySelector('[data-seg="4"]')?.scrollIntoView({ block: 'center' }))
    await collectWord(4, 'ancient')
    await page.evaluate(() => document.querySelector('[data-seg="39"]')?.scrollIntoView({ block: 'center' }))
    await collectWord(39, 'sentinel')

    // 词条列表要看得到（手动词之外还有别的书里的词）
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await expect.poll(async () => page.locator('.vocab-group').count()).toBeGreaterThan(1)
  })

  it('点词跳走之后能原路返回（跳之前没有返回按钮）', async () => {
    // 一开始没跳过，不该有返回按钮
    expect(await backButton().count()).toBe(0)

    // 滚到文档中段（目标词在末尾，此刻应该看不见）
    await scrollToMiddle()
    const origin = await topSegment()
    expect(origin).toBeGreaterThan(0)
    expect(await segmentVisible(39)).toBe(false)

    // 点末尾那个词，跳过去
    await clickAnnotation('sentinel')
    await expect.poll(async () => segmentVisible(39)).toBe(true)
    // 平滑滚动还在跑的时候读到的位置是中间值，等它停
    await waitScrollSettled()
    const jumped = await topSegment()
    expect(jumped).not.toBe(origin)

    // 出现返回按钮，点一下回到刚才读的地方
    await expect.poll(async () => backButton().count()).toBe(1)
    await backButton().click()
    await expect.poll(topSegment).toBe(origin)

    // 栈空了，按钮消失
    await expect.poll(async () => backButton().count()).toBe(0)
  })

  it('连着跳两次能连退两步（不是只记一个位置）', async () => {
    await scrollToMiddle()
    const start = await topSegment()
    expect(start).toBeGreaterThan(0)
    expect(await segmentVisible(39)).toBe(false)

    await clickAnnotation('sentinel')
    await expect.poll(async () => segmentVisible(39)).toBe(true)
    await waitScrollSettled()
    const afterFirst = await topSegment()

    await clickAnnotation('ancient')
    await expect.poll(async () => segmentVisible(4)).toBe(true)
    await waitScrollSettled()
    const afterSecond = await topSegment()
    expect(afterSecond).not.toBe(afterFirst)

    // 第一步退回上一个跳转点（不是一路退回最开始）
    await backButton().click()
    await expect.poll(topSegment).toBe(afterFirst)
    // 第二步才回到最开始读的地方
    await backButton().click()
    await expect.poll(topSegment).toBe(start)
    await expect.poll(async () => backButton().count()).toBe(0)
  })

  it('★ 跳转不会把阅读进度改成跳过去的位置（关掉重开也还在原处）', async () => {
    await scrollToMiddle()
    const origin = await topSegment()
    expect(origin).toBeGreaterThan(0)
    expect(await segmentVisible(39)).toBe(false)

    await clickAnnotation('sentinel')
    await expect.poll(async () => segmentVisible(39)).toBe(true)
    await waitScrollSettled()

    // 「返回」按钮只是个入口；真正保证不丢的是进度没被改写。
    // 所以这里**故意不点返回**，直接关掉应用看存档。
    await app.close()

    const persisted = JSON.parse(await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')) as {
      docs: { id: string; title: string }[]
      annotations: { term?: string; anchor?: { start: number } }[]
      progress: Record<string, { start: number }>
    }
    const doc = persisted.docs.find((item) => item.title === BOOK)!
    const sentinel = persisted.annotations.find((item) => item.term === 'sentinel')!
    const saved = persisted.progress[doc.id].start

    // 进度停在用户滚到的位置，而不是跳过去的那个词的位置
    expect(saved).toBeGreaterThan(0)
    expect(saved).toBeLessThan(sentinel.anchor!.start)

    // 重开之后回到那个位置（而不是词的旁边）
    await launch()
    await page.waitForSelector('.reader')
    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe(BOOK)
    expect(await topSegment()).toBe(origin)
  })
})

/**
 * 复习。放在最后：它会把词表里所有词都评一遍分，改变复习状态。
 *
 * 这一轮做的是**调度 + 最简面板**（一次一个词）。卡片模式的花活
 * （翻面动画、跳回原文、统计）留给下一轮。
 */
describe('复习', () => {
  const entry = () => page.locator('.review-entry')

  /** 侧栏那个按钮上的数字 */
  const entryCount = async (): Promise<number> => {
    const text = (await entry().textContent()) ?? ''
    return Number(text.replace(/[^\d]/g, '')) || 0
  }

  const vocabGroupCount = (): Promise<number> => page.locator('.vocab-group').count()

  const startReview = async (): Promise<void> => {
    await entry().click()
    await page.waitForSelector('.review-panel')
  }

  const progressText = async (): Promise<string> =>
    (await page.locator('.review-progress').textContent()) ?? ''

  const reveal = async (): Promise<void> => {
    await page.locator('.review-reveal').click()
    await expect.poll(async () => page.locator('.review-definition').count()).toBe(1)
  }

  it('侧栏显示待复习的词数，且等于词表里的词数（都还没复习过）', async () => {
    // 复习看的是整个词表，先把范围和筛选都放开
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await page.getByRole('button', { name: '不限', exact: true }).click()

    const total = await vocabGroupCount()
    expect(total).toBeGreaterThan(0)
    await expect.poll(entryCount).toBe(total)
  })

  it('面板：先遮住释义，没显示释义之前不能评分（不然就只是「标记一下」）', async () => {
    await startReview()

    expect(await page.locator('.review-word').count()).toBe(1)
    expect(await page.locator('.review-definition').count()).toBe(0)
    expect(await page.locator('.grade').first().isDisabled()).toBe(true)
    expect(await progressText()).toBe(`1 / ${await vocabGroupCount()}`)
  })

  it('显示释义后能看到原句 —— 这是别的背单词软件给不了的一行', async () => {
    await reveal()
    // 词表里既有从书里收的词（有原句），也可能有手动记的
    const contexts = await page.locator('.review-context').count()
    const contextsOrManual = contexts + (await page.locator('.review-context-manual').count())
    expect(contextsOrManual).toBeGreaterThan(0)
    expect(await page.locator('.grade').first().isDisabled()).toBe(false)
  })

  it('键盘也能过一轮：空格翻面，1/2/3 评分', async () => {
    await page.keyboard.press('3')
    await expect.poll(progressText).toBe(`2 / ${await vocabGroupCount()}`)

    // 下一张卡又是遮住的状态
    expect(await page.locator('.review-definition').count()).toBe(0)
    await page.keyboard.press(' ')
    await expect.poll(async () => page.locator('.review-definition').count()).toBe(1)

    await page.keyboard.press('1')
    await expect.poll(progressText).toBe(`3 / ${await vocabGroupCount()}`)
  })

  it('把剩下的评完，面板显示「过完了」', async () => {
    const total = await vocabGroupCount()
    // 已经评掉两个了
    for (let done = 2; done < total; done++) {
      await reveal()
      await page.locator('.grade.remembered').click()
    }
    await expect.poll(async () => page.locator('.review-done').count()).toBe(1)
  })

  it('评完就不再待复习（到期的都推到了以后）', async () => {
    await page.locator('.review-close').click()
    await expect.poll(entryCount).toBe(0)
    expect(await entry().isDisabled()).toBe(true)
  })

  it('★ 复习进度写进存档：关掉重开也还记得，不会又变成「全是新词」', async () => {
    await app.close()

    const persisted = JSON.parse(await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')) as {
      review: Record<string, { interval: number; reps: number; firstAt: number; due: number }>
    }
    const keys = Object.keys(persisted.review)
    expect(keys.length).toBeGreaterThan(0)
    // 刚评完的词都排到了以后，而不是立刻又到期
    for (const key of keys) {
      expect(persisted.review[key].due).toBeGreaterThan(Date.now())
      expect(persisted.review[key].firstAt).toBeLessThanOrEqual(Date.now())
    }

    await launch()
    await page.waitForSelector('.app')
    // 重开后依然没有待复习的（今天已经复习完了）
    await expect.poll(entryCount).toBe(0)
  })

  it('★ 每天引进的新词有上限，不会一口气全堆进队列', async () => {
    // 上一个用例重启过应用，范围回到默认的「本文件」，
    // 而手动词不属于任何书 —— 不切到「全部」就看不到它们
    await page.getByRole('button', { name: '全部', exact: true }).click()

    // 上面已经把整个词表评了一遍，等于「今天已经引入了 N 个新词」。
    // 现在词表里有几个词，就是今天引进了几个。
    const reviewedToday = await vocabGroupCount()
    expect(reviewedToday).toBeGreaterThan(0)

    // 一口气加超过上限那么多个新词
    const added = DEFAULT_DAILY_NEW + 2
    for (let i = 1; i <= added; i++) {
      if ((await page.locator('.add-word-input').count()) === 0) {
        await page.getByRole('button', { name: '手动添加单词' }).click()
      }
      await page.locator('.add-word-input').fill(`bulkword${i}`)
      await page.locator('.add-word-input').press('Enter')
    }
    await expect.poll(vocabGroupCount).toBe(reviewedToday + added)

    // 但今天的名额已经用掉一部分了，超出的要等明天
    const expected = Math.max(0, DEFAULT_DAILY_NEW - reviewedToday)
    await expect.poll(entryCount).toBe(expected)
    expect(await page.locator('.review-entry').getAttribute('title')).toContain('待复习')
  })
})

/** 复习设置（每天新词上限、复习范围）。 */
describe('复习设置', () => {
  const entry = () => page.locator('.review-entry')
  const settingsToggle = () => page.getByRole('button', { name: '复习设置' })
  const entryCount = async (): Promise<number> => {
    const text = (await entry().textContent()) ?? ''
    return Number(text.replace(/[^\d]/g, '')) || 0
  }
  const openSettings = async (): Promise<void> => {
    if ((await page.locator('.review-settings').count()) === 0) {
      await settingsToggle().click()
      await page.waitForSelector('.review-settings')
    }
  }

  it('设置入口能打开，显示当前的上限与范围', async () => {
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await openSettings()

    expect(await page.locator('.review-daily-new').inputValue()).toBe('10')
    expect(await page.locator('.review-settings .tab.active').textContent()).toBe('全部')
  })

  it('★ 调大每日上限，待复习数立刻跟着变（名额是按范围里已引入的算的）', async () => {
    await openSettings()
    const before = await entryCount()
    expect(before).toBeGreaterThan(0)

    // 上限 0 = 今天只清到期，不引入新词
    await page.locator('.review-daily-new').fill('0')
    await expect.poll(entryCount).toBe(0)

    // 调大就会多放进来一些
    await page.locator('.review-daily-new').fill('50')
    const more = await entryCount()
    expect(more).toBeGreaterThan(before)

    await page.locator('.review-daily-new').fill('10')
    await expect.poll(entryCount).toBe(before)
  })

  it('上限夹在合法范围里（填超大数不会失控）', async () => {
    await openSettings()
    await page.locator('.review-daily-new').fill('999')
    // 0~50
    expect(Number(await page.locator('.review-daily-new').inputValue())).toBeLessThanOrEqual(50)

    await page.locator('.review-daily-new').fill('-3')
    expect(Number(await page.locator('.review-daily-new').inputValue())).toBeGreaterThanOrEqual(0)
    await page.locator('.review-daily-new').fill('10')
  })

  it('★ 切成「手动」范围后，只复习手动记的词（书里收的要被排除）', async () => {
    // 造一个绝对不是手动的词：从一本书里划一个
    const file = join(exportDir, 'review-source.txt')
    await writeFile(
      file,
      ['We are trained to read closely.', 'Speed feels like progress.', 'Reading is a habit.'].join('\n'),
      'utf-8'
    )
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, file)
    await page.getByRole('button', { name: '打开 TXT' }).click()
    await expect.poll(async () => page.locator('.reader-header h1').textContent()).toBe('review-source')
    await collectWord(0, 'trained')

    // 手动词的名单（按词表里带「手动」标记的分组取）
    const manualWords = (
      await page
        .locator('.vocab-group')
        .filter({ has: page.locator('.badge.manual') })
        .locator('.vocab-head strong')
        .allTextContents()
    ).map((word) => word.toLowerCase())
    // 前提：刚收的那个词确实不在手动名单里，否则这条测不出东西
    expect(manualWords.length).toBeGreaterThan(0)
    expect(manualWords).not.toContain('train')

    await openSettings()
    // 上限调到远大于词表，数量就只反映范围，不反映名额
    await page.locator('.review-daily-new').fill('50')
    await page.locator('.review-settings .tab', { hasText: '全部' }).click()
    const allCount = await entryCount()
    expect(allCount).toBeGreaterThan(0)

    await page.locator('.review-settings .tab', { hasText: '手动' }).click()
    const manualCount = await entryCount()
    // ★ 关键断言：换到手动范围后，至少少掉了刚从书里收的那一个
    expect(manualCount).toBeLessThan(allCount)

    // 而且面板里出现的词都在手动名单里
    await entry().click()
    await page.waitForSelector('.review-panel')
    const shown = ((await page.locator('.review-word').textContent()) ?? '').toLowerCase()
    await page.locator('.review-close').click()
    expect(manualWords).toContain(shown)

    await openSettings()
    await page.locator('.review-daily-new').fill('10')
  })

  it('★ 卡片上的原句可以点开看原文，而且没评完的还在', async () => {
    // 上一个用例已经导入了 review-source 并从里面收了一个词，
    // 所以「本书」范围下队列里一定是有原句的词
    await openSettings()
    await page.locator('.review-daily-new').fill('50')
    await page.locator('.review-settings .tab', { hasText: '本书' }).click()
    await expect.poll(async () => page.locator('.review-settings .tab.active').textContent()).toBe('本书')

    await entry().click()
    await page.waitForSelector('.review-panel')
    await page.locator('.review-reveal').click()

    const contexts = await page.locator('button.review-context').count()
    if (contexts === 0) {
      // 先把面板关掉再抛：否则它会挡住侧栏，后面的用例全跟着倒
      await page.locator('.review-close').click()
      throw new Error('「本书」范围下应该能找到带原句的卡')
    }

    // 点原句 → 面板收起、跳到原文
    await page.locator('button.review-context').first().click()
    await expect.poll(async () => page.locator('.review-panel').count()).toBe(0)
    // 跳过去之后能返回（复用导航历史）
    await expect.poll(async () => page.getByRole('button', { name: '返回上一个位置' }).count()).toBe(1)
    await page.getByRole('button', { name: '返回上一个位置' }).click()

    // 没评完的词还在待复习里，重开面板能接着过
    await expect.poll(entryCount).toBeGreaterThan(0)
    await entry().click()
    await page.waitForSelector('.review-panel')
    expect(await page.locator('.review-word').count()).toBe(1)
    await page.locator('.review-close').click()
  })

  it('设置会写进存档', async () => {
    await openSettings()
    await page.locator('.review-settings .tab', { hasText: '手动' }).click()
    await page.locator('.review-daily-new').fill('6')

    await app.close()
    const persisted = JSON.parse(await readFile(join(userDataDir, 'inkpick-store.json'), 'utf-8')) as {
      reviewSettings: { dailyNew: number; scope: string }
    }
    expect(persisted.reviewSettings).toEqual({ dailyNew: 6, scope: 'manual' })

    await launch()
    await page.waitForSelector('.app')
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await openSettings()
    expect(await page.locator('.review-daily-new').inputValue()).toBe('6')
    expect(await page.locator('.review-settings .tab.active').textContent()).toBe('手动')
  })
})
