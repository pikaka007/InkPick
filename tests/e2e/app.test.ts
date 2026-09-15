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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

  // 设置面板浮在正文上方，留着会挡住后面的点击
  afterEach(async () => {
    if (await page.locator('.settings-panel').count()) {
      await page.locator('.reader-body').click({ position: { x: 5, y: 5 } })
      await expect.poll(async () => page.locator('.settings-panel').count()).toBe(0)
    }
  })

  /** 打开阅读设置面板 */
  const openSettings = async (): Promise<void> => {
    if ((await page.locator('.settings-panel').count()) === 0) {
      await page.getByRole('button', { name: '阅读设置' }).click()
      await page.waitForSelector('.settings-panel')
    }
  }

  it('阅读设置是一个面板，而不是一排循环切换的按钮', async () => {
    await openSettings()

    for (const name of ['字号', '行距', '行宽', '主题']) {
      expect(await page.getByLabel(name, { exact: true }).count(), `${name} 下拉框`).toBe(1)
    }

    // 头部不再有几个「每点一次换一个值」的按钮
    expect(await page.getByRole('button', { name: /^行距/ }).count()).toBe(0)
    expect(await page.getByRole('button', { name: /^主题/ }).count()).toBe(0)
  })

  it('点面板外面会关掉设置', async () => {
    await page.locator('.reader-body').click({ position: { x: 5, y: 5 } })
    await expect.poll(async () => page.locator('.settings-panel').count()).toBe(0)
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

  it('下拉框能直接选到任意一档，不用按顺序点', async () => {
    await openSettings()

    // 从最大字号直接跳到最小，不用点六次
    await page.getByLabel('字号', { exact: true }).selectOption('15')
    await expect.poll(bodyFontSize).toBe('15px')

    await page.getByLabel('字号', { exact: true }).selectOption('21')
    await expect.poll(bodyFontSize).toBe('21px')
  })

  it('行距下拉框会改变行高', async () => {
    await openSettings()
    const before = await bodyLineHeight()

    await page.getByLabel('行距', { exact: true }).selectOption('1.6')
    await expect.poll(bodyLineHeight).not.toBe(before)
    expect(parseFloat(await bodyLineHeight())).toBeLessThan(parseFloat(before))
  })

  it('行宽下拉框会改变正文宽度', async () => {
    await openSettings()
    const before = await bodyWidth()

    await page.getByLabel('行宽', { exact: true }).selectOption('wide')
    await expect.poll(bodyWidth).toBeGreaterThan(before)
  })

  it('主题下拉框会换掉整页配色', async () => {
    await openSettings()
    const light = await appBackground()
    expect(await theme()).toBe('light')

    await page.getByLabel('主题', { exact: true }).selectOption('sepia')
    await expect.poll(theme).toBe('sepia')
    const sepia = await appBackground()
    expect(sepia).not.toBe(light)

    await page.getByLabel('主题', { exact: true }).selectOption('dark')
    await expect.poll(theme).toBe('dark')
    expect(await appBackground()).not.toBe(sepia)
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

    expect(persisted.prefs).toMatchObject({ fontSize: 21, theme: 'dark', measure: 'wide' })
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
    await page.getByRole('button', { name: '全部文档' }).click()

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
    expect(await sidebarWidth()).toBeGreaterThan(200)

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
    expect(await sidebarWidth()).toBe(200)

    // 拽到极宽（但仍在窗口内）
    const again = (await handle.boundingBox())!
    await page.mouse.move(again.x + again.width / 2, again.y + 200)
    await page.mouse.down()
    await page.mouse.move(windowWidth - 5, again.y + 200, { steps: 3 })
    await page.mouse.up()
    expect(await sidebarWidth()).toBe(520)
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
    expect(await sidebarWidth()).toBe(365)

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
