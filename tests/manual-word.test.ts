/**
 * 手动添加的词（不来自任何书）。
 *
 * 这几条测试守的是**最容易静默出错**的地方：存档的序列化 / 反序列化。
 * 手动词没有 docId 也没有 anchor，一旦校验写严了，它会在下次启动时被默默丢掉
 * —— 用户只会看到「我记的词不见了」。
 */
import { describe, expect, it } from 'vitest'
import {
  addAnnotation,
  createAnnotation,
  createEmptyStore,
  deserializeStore,
  findExistingVocab,
  isManual,
  removeDoc,
  serializeStore,
  updateAnnotation,
  vocabKeyOf
} from '@core/store'
import type { Annotation, Doc, Store } from '@core/types'
import { groupVocab } from '@core/vocab'
import { annotationsToMarkdown, libraryToMarkdown, vocabToAnkiCsv } from '@core/export'

function manual(term: string, extra: Partial<Annotation> = {}): Annotation {
  return {
    ...createAnnotation({ type: 'vocab', term, contextText: '', lookupStatus: 'pending' }),
    ...extra
  }
}

function fromBook(docId: string, text: string, start: number, extra: Partial<Annotation> = {}): Annotation {
  return {
    ...createAnnotation({
      docId,
      type: 'vocab',
      anchor: { start, end: start + text.length, text, prefix: '', suffix: '' },
      contextText: `句子里的 ${text}`,
      term: text
    }),
    ...extra
  }
}

const doc: Doc = { id: 'doc-1', title: '一本书', content: 'Reading slowly is a habit.', createdAt: 1 }

describe('isManual', () => {
  it('缺 docId 或 anchor 就是手动添加的', () => {
    expect(isManual(manual('habit'))).toBe(true)
    expect(isManual(fromBook('doc-1', 'habit', 20))).toBe(false)
  })

  it('只有一半（有 docId 没 anchor）也算手动 —— 界面据此不画高亮', () => {
    const half = { ...manual('habit'), docId: 'doc-1' } as Annotation
    expect(isManual(half)).toBe(true)
  })
})

describe('手动记的词能存下来', () => {
  it('往返序列化后还在（这是最容易丢的地方）', () => {
    const store = addAnnotation(createEmptyStore(), manual('habit'))
    const back = deserializeStore(serializeStore(store))

    expect(back.annotations).toHaveLength(1)
    expect(back.annotations[0].term).toBe('habit')
    expect(back.annotations[0].docId).toBeUndefined()
    expect(back.annotations[0].anchor).toBeUndefined()
  })

  it('查词回填后依然能存下来', () => {
    const store = addAnnotation(createEmptyStore(), manual('habit'))
    const filled = updateAnnotation(store, store.annotations[0].id, {
      lookupStatus: 'found',
      lemma: 'habit',
      phonetic: 'ˈhæbɪt',
      senses: [{ pos: 'n.', translation: '习惯' }]
    })
    const back = deserializeStore(serializeStore(filled))

    expect(back.annotations[0].lemma).toBe('habit')
    expect(back.annotations[0].senses?.[0].translation).toBe('习惯')
  })

  it('半残数据（有 docId 没 anchor）会被丢掉，而不是带进内存里到处判空', () => {
    const broken = { id: 'x', type: 'vocab', docId: 'doc-1', contextText: '', term: 'habit' }
    const raw = JSON.stringify({ version: 1, docs: [], annotations: [broken], progress: {} })
    expect(deserializeStore(raw).annotations).toEqual([])
  })

  it('书里的标注照旧存得下来（没把老数据关在门外）', () => {
    const store = addAnnotation(createEmptyStore(), fromBook('doc-1', 'habit', 20))
    const back = deserializeStore(serializeStore(store))

    expect(back.annotations).toHaveLength(1)
    expect(back.annotations[0].anchor?.start).toBe(20)
    expect(back.annotations[0].docId).toBe('doc-1')
  })

  it('手动词和书里的词能共存', () => {
    const store = addAnnotation(addAnnotation(createEmptyStore(), manual('habit')), fromBook('doc-1', 'habit', 20))
    const back = deserializeStore(serializeStore(store))

    expect(back.annotations).toHaveLength(2)
    expect(back.annotations.filter(isManual)).toHaveLength(1)
  })
})

describe('去重', () => {
  it('同一个词加两次会被认出来', () => {
    const store = addAnnotation(createEmptyStore(), manual('habit'))
    expect(findExistingVocab(store, 'habit')).toBeDefined()
    expect(findExistingVocab(store, '  Habit ')).toBeDefined() // 大小写与空白不敏感
    expect(findExistingVocab(store, 'habitual')).toBeUndefined()
  })

  it('书里收过的词，手动再加也算重复', () => {
    const store = addAnnotation(createEmptyStore(), fromBook('doc-1', 'habit', 20))
    expect(findExistingVocab(store, 'habit')).toBeDefined()
  })

  it('按 lemma 与当时输入的原词都比一遍 —— runs 收过之后再加 runs 也算重复', () => {
    const store = addAnnotation(createEmptyStore(), { ...fromBook('doc-1', 'runs', 20), lemma: 'run' })
    expect(findExistingVocab(store, 'run')).toBeDefined() // 分组键命中
    expect(findExistingVocab(store, 'runs')).toBeDefined() // 原词命中
    expect(findExistingVocab(store, 'running')).toBeUndefined() // 确实没见过的形态不拦
  })

  it('空输入不算重复，也查不到东西', () => {
    const store = addAnnotation(createEmptyStore(), manual('habit'))
    expect(findExistingVocab(store, '   ')).toBeUndefined()
  })

  it('笔记不参与去重', () => {
    const note = createAnnotation({ docId: 'doc-1', type: 'note', contextText: 'x', content: 'habit' })
    const store = addAnnotation(createEmptyStore(), note)
    expect(findExistingVocab(store, 'habit')).toBeUndefined()
  })
})

describe('vocabKeyOf', () => {
  it('lemma 优先，其次原词，最后才回退到原文', () => {
    expect(vocabKeyOf(manual('Habit', { lemma: 'habit' }))).toBe('habit')
    expect(vocabKeyOf(manual('Habit'))).toBe('habit')
    expect(vocabKeyOf(fromBook('doc-1', 'Habit', 0))).toBe('habit')
    // 手动词没有 anchor 也不能炸
    expect(vocabKeyOf(manual('   '))).toBe('')
  })
})

describe('分组：手动词与书里的词合成一条', () => {
  it('同一个词先手动记、后在书里划到，合并成一组', () => {
    const store = addAnnotation(addAnnotation(createEmptyStore(), manual('habit')), {
      ...fromBook('doc-1', 'habit', 20),
      lemma: 'habit'
    })
    const groups = groupVocab(store.annotations)

    expect(groups).toHaveLength(1)
    expect(groups[0].lemma).toBe('habit')
    expect(groups[0].items).toHaveLength(2)
    // 手动词是「种子」，排在原文那条前面
    expect(groups[0].items.map((item) => item.anchor?.start)).toEqual([undefined, 20])
  })

  it('只有手动词时也自成一组', () => {
    const groups = groupVocab([manual('solitude', { lemma: 'solitude' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].items[0].anchor).toBeUndefined()
  })

  it('手动词的释义能正常取到（组内取信息最全的那条）', () => {
    const store = addAnnotation(addAnnotation(createEmptyStore(), manual('habit')), {
      ...fromBook('doc-1', 'habit', 20),
      lemma: 'habit',
      lookupStatus: 'found',
      senses: [{ pos: 'n.', translation: '习惯' }]
    })
    expect(groupVocab(store.annotations)[0].senses[0].translation).toBe('习惯')
  })
})

describe('导出：手动词不会把导出弄崩', () => {
  const manualWord = manual('solitude', {
    lemma: 'solitude',
    lookupStatus: 'found',
    senses: [{ pos: 'n.', translation: '独处' }]
  })
  const bookWord = fromBook('doc-1', 'habit', 20, { lemma: 'habit' })

  it('CSV 里带上手动词，例句列留空而不是报错', () => {
    const csv = vocabToAnkiCsv(groupVocab([manualWord, bookWord]), { 'doc-1': '一本书' })
    expect(csv).toContain('solitude')
    expect(csv).toContain('独处')
    expect(csv).toContain('habit')
  })

  it('跨书 Markdown 里手动词不标出处', () => {
    const md = libraryToMarkdown([doc], [manualWord, bookWord])
    expect(md).toContain('solitude')
    // 手动词没有来源书，不能出现空的括号
    expect(md).not.toContain('（）')
    expect(md).toContain('（一本书）')
  })

  it('单文档导出不会带进手动词（它们不属于这本书）', () => {
    const md = annotationsToMarkdown([bookWord], doc)
    expect(md).toContain('habit')
    expect(md).not.toContain('solitude')
  })
})

describe('删文档不会误删手动词', () => {
  it('级联只删这本书的标注', () => {
    const store: Store = {
      ...addAnnotation(addAnnotation(createEmptyStore(), manual('solitude')), fromBook('doc-1', 'habit', 20)),
      docs: [doc]
    }
    const after = removeDoc(store, 'doc-1')

    expect(after.annotations).toHaveLength(1)
    expect(after.annotations[0].term).toBe('solitude')
  })
})
