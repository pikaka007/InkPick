import { describe, expect, it } from 'vitest'
import { createAnchor } from '@core/anchor'
import { parseCsvRecords } from '@core/csv'
import {
  annotationsToMarkdown,
  csvField,
  csvRow,
  libraryFileName,
  libraryToMarkdown,
  safeFileName,
  suggestedFileName,
  vocabToAnkiCsv
} from '@core/export'
import { groupVocab } from '@core/vocab'
import type { Annotation } from '@core/types'

const CONTEXT = 'Reading slowly is a habit. They look up a word and write it down.'

/** 偏移量一律从原文里算出来，不写死数字 */
function vocab(overrides: Partial<Annotation> & { term: string; start?: number }): Annotation {
  const { start: explicitStart, ...rest } = overrides
  const start = explicitStart ?? CONTEXT.indexOf(overrides.term)
  if (start < 0) throw new Error(`fixture 的原文里找不到「${overrides.term}」`)

  return {
    id: `a-${start}-${overrides.term}`,
    docId: 'doc-1',
    type: 'vocab',
    anchor: createAnchor(CONTEXT, start, start + overrides.term.length),
    contextText: CONTEXT.slice(start, start + overrides.term.length),
    lookupStatus: 'found',
    createdAt: 1000 + start,
    updatedAt: 1000 + start,
    ...rest
  }
}

function note(overrides: Partial<Annotation> & { start: number }): Annotation {
  return {
    id: `n-${overrides.start}`,
    docId: 'doc-1',
    type: 'note',
    anchor: createAnchor(CONTEXT, overrides.start, overrides.start + 4),
    contextText: 'Reading slowly is a habit.',
    createdAt: 2000,
    updatedAt: 2000,
    content: '这句是关键',
    ...overrides
  }
}

describe('csvField', () => {
  it('普通文本不加引号', () => {
    expect(csvField('reading')).toBe('reading')
    expect(csvField('阅读')).toBe('阅读')
  })

  it('含逗号的字段加引号', () => {
    expect(csvField('匆忙, 急忙')).toBe('"匆忙, 急忙"')
  })

  it('含引号的字段把引号翻倍', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('含换行的字段加引号（Anki 的多行字段靠这个）', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('csvRow 逐字段转义', () => {
    expect(csvRow(['a', 'b,c', 'd'])).toBe('a,"b,c",d')
  })
})

describe('vocabToAnkiCsv', () => {
  const TITLES = { 'doc-1': '示例 · On Reading' }
  const groups = groupVocab([
    vocab({
      term: 'Reading',
      lemma: 'reading',
      phonetic: 'ˈriːdɪŋ',
      senses: [
        { pos: 'n.', translation: '阅读' },
        { pos: 'n.', translation: '读物' }
      ]
    }),
    vocab({
      term: 'word',
      senses: [{ pos: 'n.', translation: '词；单词' }],
      contextText: 'They look up a word and write it down.'
    }),
    // words 与 word 是同一组的两次收藏：词形还原后 lemma 都归到 word
    vocab({
      term: 'words',
      lemma: 'word',
      start: CONTEXT.indexOf('word'),
      contextText: 'A word without its context is forgotten.'
    })
  ])

  it('第一行是表头', () => {
    expect(vocabToAnkiCsv(groups, TITLES).split('\n')[0]).toBe('Word,Phonetic,Definition,Context,Source')
  })

  it('一个词一行，同一词的多次收藏不重复成行', () => {
    const records = parseCsvRecords(vocabToAnkiCsv(groups, TITLES))
    expect(records).toHaveLength(2)
    expect(records.map((row) => row.Word)).toEqual(['reading', 'word'])
  })

  it('全部义项都导出，不只界面上的前三条', () => {
    expect(vocabToAnkiCsv(groups, TITLES)).toContain('n. 阅读；n. 读物')
  })

  it('同一词的多次上下文合成一个多行字段', () => {
    const records = parseCsvRecords(vocabToAnkiCsv(groups, TITLES))
    const wordRow = records.find((row) => row.Word === 'word')!

    // word 与 words 两次收藏的上下文都在这一个字段里，各占一行
    expect(wordRow.Context.split('\n')).toHaveLength(2)
    expect(wordRow.Context).toContain('write it down')
    expect(wordRow.Context).toContain('is forgotten')
  })

  it('带上出处书名', () => {
    expect(vocabToAnkiCsv(groups, TITLES)).toContain('示例 · On Reading')
  })

  it('没有词条时只有表头', () => {
    expect(parseCsvRecords(vocabToAnkiCsv([], TITLES))).toHaveLength(0)
  })

  it('词典查不到但手写过释义时，导出的是手写释义', () => {
    const manual = groupVocab([
      vocab({ term: 'inkpick', start: 0, lookupStatus: 'missing', manualDefinition: '这个阅读器' })
    ])
    expect(vocabToAnkiCsv(manual, TITLES)).toContain('这个阅读器')
  })
})

describe('annotationsToMarkdown', () => {
  const doc = { title: '示例 · On Reading' }
  const annotations = [
    vocab({
      term: 'Reading',
      lemma: 'reading',
      phonetic: 'ˈriːdɪŋ',
      senses: [{ pos: 'n.', translation: '阅读' }]
    }),
    vocab({
      term: 'words',
      lemma: 'word',
      start: CONTEXT.indexOf('word'),
      senses: [{ pos: 'n.', translation: '词' }]
    }),
    note({ start: 0 })
  ]
  const options = { now: new Date('2026-09-15T10:00:00Z') }

  it('标题、统计与日期', () => {
    const md = annotationsToMarkdown(annotations, doc, options)
    expect(md.startsWith('# 示例 · On Reading\n')).toBe(true)
    expect(md).toContain('InkPick 导出 · 2026-09-15 · 2 条词条 / 1 条笔记')
  })

  it('单词小节带音标与释义', () => {
    expect(annotationsToMarkdown(annotations, doc, options)).toContain('**reading** /ˈriːdɪŋ/ — n. 阅读')
  })

  it('词形不同于原形时标出来', () => {
    expect(annotationsToMarkdown(annotations, doc, options)).toContain('*(words)* ')
  })

  it('笔记小节引用原句', () => {
    expect(annotationsToMarkdown(annotations, doc, options)).toContain('### 这句是关键')
    expect(annotationsToMarkdown(annotations, doc, options)).toContain('> Reading slowly is a habit.')
  })

  it('没有内容时不输出空小节', () => {
    const md = annotationsToMarkdown([], doc, options)
    expect(md).not.toContain('## 单词')
    expect(md).not.toContain('## 笔记')
  })

  it('只有笔记时不输出单词小节，反之亦然', () => {
    const onlyNote = annotationsToMarkdown([note({ start: 0 })], doc, options)
    expect(onlyNote).not.toContain('## 单词')
    expect(onlyNote).toContain('## 笔记')

    const onlyVocab = annotationsToMarkdown([annotations[0]], doc, options)
    expect(onlyVocab).toContain('## 单词')
    expect(onlyVocab).not.toContain('## 笔记')
  })

  it('结尾只有一个换行', () => {
    expect(annotationsToMarkdown(annotations, doc, options).endsWith('\n')).toBe(true)
    expect(annotationsToMarkdown(annotations, doc, options).endsWith('\n\n')).toBe(false)
  })

  it('未补释义的词有占位提示，不至于导出成空', () => {
    const md = annotationsToMarkdown(
      [vocab({ term: 'zzz', start: 0, lookupStatus: 'missing' })],
      doc,
      options
    )
    expect(md).toContain('（未补释义）')
  })
})

describe('跨文档（全部标注）', () => {
  const docs = [
    { id: 'doc-1', title: '第一本书' },
    { id: 'doc-2', title: '第二本书' }
  ]
  const titles = { 'doc-1': '第一本书', 'doc-2': '第二本书' }

  // 同一个词在两本书里各收一次，加一条另一本书里的词
  const crossDoc = [
    vocab({ term: 'word', start: 0, senses: [{ pos: 'n.', translation: '词' }] }),
    { ...vocab({ term: 'words', lemma: 'word', start: CONTEXT.indexOf('word') }), docId: 'doc-2' },
    { ...vocab({ term: 'habit', start: 0 }), docId: 'doc-2' }
  ]
  const options = { now: new Date('2026-09-15T10:00:00Z') }

  it('同一词跨书合并成一行，Source 列出两本书', () => {
    const records = parseCsvRecords(vocabToAnkiCsv(groupVocab(crossDoc), titles))
    expect(records.map((row) => row.Word)).toEqual(['word', 'habit'])
    expect(records[0].Source).toBe('第一本书 / 第二本书')
    expect(records[1].Source).toBe('第二本书')
  })

  it('只有一本书时 Source 不重复堆叠', () => {
    const single = vocabularyInOneDoc()
    const records = parseCsvRecords(vocabToAnkiCsv(groupVocab(single), titles))
    expect(records[0].Source).toBe('第一本书')
  })

  it('Markdown 里每条上下文标出出处，笔记按文档分节', () => {
    const md = libraryToMarkdown(docs, [...crossDoc, note({ start: 0 })], options)

    expect(md.startsWith('# InkPick 全部标注')).toBe(true)
    expect(md).toContain('2 个文档')
    expect(md).toContain('（第一本书）')
    expect(md).toContain('（第二本书）')
    expect(md).toContain('## 笔记')
    expect(md).toContain('### 第一本书')
  })

  it('没有笔记的文档不出现在笔记小节里', () => {
    const md = libraryToMarkdown(docs, [note({ start: 0 })], options)
    expect(md).toContain('### 第一本书')
    expect(md).not.toContain('### 第二本书')
  })

  it('全空时不输出空小节', () => {
    const md = libraryToMarkdown(docs, [], options)
    expect(md).not.toContain('## 单词')
    expect(md).not.toContain('## 笔记')
  })

  it('没有标题的文档不会输出 undefined', () => {
    const md = libraryToMarkdown(docs, [{ ...vocab({ term: 'word', start: 0 }), docId: 'ghost' }], options)
    expect(md).not.toContain('undefined')
  })

  it('跨文档导出的文件名', () => {
    expect(libraryFileName('vocab', 'csv')).toBe('InkPick-全部词表.csv')
    expect(libraryFileName('notes', 'md')).toBe('InkPick-全部笔记.md')
  })

  /** 同一文档里收两次，用于验证 Source 不重复 */
  function vocabularyInOneDoc(): Annotation[] {
    return [vocab({ term: 'word', start: 0 }), { ...vocab({ term: 'habit', start: 0 }), docId: 'doc-1' }]
  }
})

describe('文件名', () => {
  it('去掉文件系统不接受的字符', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j')
  })

  it('空标题用兜底名', () => {
    expect(safeFileName('   ')).toBe('inkpick')
    expect(safeFileName('...')).toBe('inkpick')
  })

  it('过长标题截断', () => {
    expect(safeFileName('x'.repeat(200)).length).toBe(60)
  })

  it('拼出建议文件名', () => {
    expect(suggestedFileName('示例 · On Reading', 'vocab', 'csv')).toBe('示例 · On Reading-词表.csv')
    expect(suggestedFileName('示例 · On Reading', 'notes', 'md')).toBe('示例 · On Reading-笔记.md')
  })
})
