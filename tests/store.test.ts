import { describe, expect, it } from 'vitest'
import {
  addAnnotation,
  addDoc,
  annotationsForDoc,
  createAnnotation,
  createEmptyStore,
  createId,
  deserializeStore,
  getDoc,
  indexOfAnnotation,
  insertAnnotationAt,
  removeAnnotation,
  removeDoc,
  renameDoc,
  serializeStore,
  setPrefs,
  setProgress,
  updateAnnotation
} from '@core/store'
import { createAnchor } from '@core/anchor'
import { DEFAULT_PREFS } from '@core/prefs'
import type { Doc, Store } from '@core/types'

function makeDoc(content = 'hello world'): Doc {
  return { id: 'doc-1', title: '测试', content, createdAt: 1 }
}

describe('文档操作', () => {
  it('添加并读取文档', () => {
    const store = addDoc(createEmptyStore(), makeDoc())
    expect(store.docs).toHaveLength(1)
    expect(getDoc(store, 'doc-1')?.title).toBe('测试')
    expect(getDoc(store, 'nope')).toBeUndefined()
  })

  it('不改动原 store（纯函数）', () => {
    const before = createEmptyStore()
    addDoc(before, makeDoc())
    expect(before.docs).toHaveLength(0)
  })

  it('重命名改标题', () => {
    const store = renameDoc(addDoc(createEmptyStore(), makeDoc()), 'doc-1', '新名字')
    expect(store.docs[0].title).toBe('新名字')
  })

  it('重命名去掉首尾空白', () => {
    const store = renameDoc(addDoc(createEmptyStore(), makeDoc()), 'doc-1', '  留白  ')
    expect(store.docs[0].title).toBe('留白')
  })

  it('不接受空标题（否则侧栏会出现一条看不见的文档）', () => {
    const before = addDoc(createEmptyStore(), makeDoc())
    expect(renameDoc(before, 'doc-1', '   ').docs[0].title).toBe('测试')
    expect(renameDoc(before, 'doc-1', '')).toBe(before)
  })

  it('重命名不存在的文档是空操作', () => {
    const before = addDoc(createEmptyStore(), makeDoc())
    expect(renameDoc(before, 'nope', 'x').docs[0].title).toBe('测试')
  })
})

describe('删除文档', () => {
  function storeWithTwoDocs(): Store {
    let store = addDoc(addDoc(createEmptyStore(), makeDoc()), {
      id: 'doc-2',
      title: '第二本',
      content: 'hello world',
      createdAt: 2
    })
    store = setProgress(store, 'doc-1', createAnchor('hello world', 3, 3))
    store = setProgress(store, 'doc-2', createAnchor('hello world', 5, 5))
    store = addAnnotation(
      store,
      createAnnotation({
        docId: 'doc-1',
        type: 'vocab',
        anchor: createAnchor('hello world', 0, 5),
        contextText: 'hello world',
        term: 'hello'
      })
    )
    store = addAnnotation(
      store,
      createAnnotation({
        docId: 'doc-2',
        type: 'note',
        anchor: createAnchor('hello world', 6, 11),
        contextText: 'hello world',
        content: '记一笔'
      })
    )
    return { ...store, lastDocId: 'doc-1' }
  }

  it('级联删掉它的标注与阅读进度', () => {
    const store = removeDoc(storeWithTwoDocs(), 'doc-1')

    expect(store.docs.map((doc) => doc.id)).toEqual(['doc-2'])
    expect(store.annotations.map((item) => item.docId)).toEqual(['doc-2'])
    expect(store.progress['doc-1']).toBeUndefined()
    expect(store.progress['doc-2']).toBeDefined()
  })

  it('删的正好是当前文档时，lastDocId 退到剩下那本', () => {
    expect(removeDoc(storeWithTwoDocs(), 'doc-1').lastDocId).toBe('doc-2')
  })

  it('删的不是当前文档时不动 lastDocId', () => {
    expect(removeDoc(storeWithTwoDocs(), 'doc-2').lastDocId).toBe('doc-1')
  })

  it('删掉最后一本后 lastDocId 变 undefined，不指向已删文档', () => {
    const single = addDoc(createEmptyStore(), makeDoc())
    const store = removeDoc({ ...single, lastDocId: 'doc-1' }, 'doc-1')

    expect(store.docs).toEqual([])
    expect(store.lastDocId).toBeUndefined()
  })

  it('删不存在的文档是空操作', () => {
    const before = storeWithTwoDocs()
    expect(removeDoc(before, 'nope')).toBe(before)
  })
})

describe('撤销删除', () => {
  const base = addDoc(createEmptyStore(), makeDoc())
  const first = createAnnotation({
    docId: 'doc-1',
    type: 'vocab',
    anchor: createAnchor('hello world', 0, 5),
    contextText: 'hello world',
    term: 'hello'
  })
  const second = createAnnotation({
    docId: 'doc-1',
    type: 'note',
    anchor: createAnchor('hello world', 6, 11),
    contextText: 'hello world',
    content: '笔记'
  })
  const filled = addAnnotation(addAnnotation(base, first), second)

  it('插回原来的位置，而不是追加到末尾', () => {
    const removed = removeAnnotation(filled, first.id)
    const restored = insertAnnotationAt(removed, first, 0)
    expect(restored.annotations.map((item) => item.id)).toEqual([first.id, second.id])
  })

  it('保留原 id，引用仍然有效', () => {
    const restored = insertAnnotationAt(removeAnnotation(filled, first.id), first, 0)
    expect(restored.annotations[0]).toEqual(first)
  })

  it('越界的位置夹到合法范围', () => {
    expect(insertAnnotationAt(base, first, 99).annotations).toHaveLength(1)
    expect(insertAnnotationAt(base, first, -5).annotations).toHaveLength(1)
  })

  it('幂等：已经存在时不会插成两条', () => {
    expect(insertAnnotationAt(filled, first, 0)).toBe(filled)
  })

  it('indexOfAnnotation 给出删除前的位置', () => {
    expect(indexOfAnnotation(filled, second.id)).toBe(1)
    expect(indexOfAnnotation(filled, 'nope')).toBe(-1)
  })
})

describe('标注操作', () => {
  const base = addDoc(createEmptyStore(), makeDoc())

  const makeAnnotation = () =>
    createAnnotation({
      docId: 'doc-1',
      type: 'vocab',
      anchor: createAnchor('hello world', 0, 5),
      contextText: 'hello world',
      term: 'hello',
      now: 1000
    })

  it('创建标注带上时间戳', () => {
    const annotation = makeAnnotation()
    expect(annotation.createdAt).toBe(1000)
    expect(annotation.updatedAt).toBe(1000)
    expect(annotation.id).toBeTruthy()
  })

  it('添加后按文档筛选', () => {
    const store = addAnnotation(base, makeAnnotation())
    expect(annotationsForDoc(store, 'doc-1')).toHaveLength(1)
    expect(annotationsForDoc(store, 'doc-2')).toHaveLength(0)
  })

  it('更新内容会刷新 updatedAt，createdAt 不变', () => {
    const annotation = makeAnnotation()
    const store = updateAnnotation(addAnnotation(base, annotation), annotation.id, { content: '笔记' }, 2000)
    const updated = store.annotations[0]
    expect(updated.content).toBe('笔记')
    expect(updated.createdAt).toBe(1000)
    expect(updated.updatedAt).toBe(2000)
  })

  it('删除只影响目标标注', () => {
    const a = makeAnnotation()
    const b = makeAnnotation()
    const store = removeAnnotation(addAnnotation(addAnnotation(base, a), b), a.id)
    expect(store.annotations.map((item) => item.id)).toEqual([b.id])
  })
})

describe('阅读进度', () => {
  it('按文档分别记录', () => {
    const store = setProgress(createEmptyStore(), 'doc-1', createAnchor('abcdef', 3, 3))
    expect(store.progress['doc-1'].start).toBe(3)
    expect(store.progress['doc-2']).toBeUndefined()
  })
})

describe('阅读偏好', () => {
  it('新库带默认偏好', () => {
    expect(createEmptyStore().prefs).toEqual(DEFAULT_PREFS)
  })

  it('可以只改其中一项', () => {
    const store = setPrefs(createEmptyStore(), { theme: 'dark' })
    expect(store.prefs.theme).toBe('dark')
    expect(store.prefs.fontSize).toBe(DEFAULT_PREFS.fontSize)
  })

  it('写入时就把非法值夹回合法档位', () => {
    const store = setPrefs(createEmptyStore(), { fontSize: 999, theme: 'neon' as never })
    expect(store.prefs.fontSize).toBe(24)
    expect(store.prefs.theme).toBe(DEFAULT_PREFS.theme)
  })

  it('旧版本文件里没有 prefs 时补默认值', () => {
    const legacy = JSON.stringify({ version: 1, docs: [], annotations: [], progress: {} })
    expect(deserializeStore(legacy).prefs).toEqual(DEFAULT_PREFS)
  })

  it('偏好不合法时不会让整个库打不开', () => {
    const broken = JSON.stringify({ version: 1, prefs: '这是字符串不是对象' })
    expect(deserializeStore(broken).prefs).toEqual(DEFAULT_PREFS)
  })
})

describe('序列化', () => {
  it('往返不失真', () => {
    const store = setProgress(addDoc(createEmptyStore(), makeDoc()), 'doc-1', createAnchor('abcdef', 2, 4))
    expect(deserializeStore(serializeStore(store))).toEqual(store)
  })

  it('文件损坏时退回空 store 而不是抛错', () => {
    expect(deserializeStore('{ 这不是 json')).toEqual(createEmptyStore())
    expect(deserializeStore(null)).toEqual(createEmptyStore())
    expect(deserializeStore(undefined)).toEqual(createEmptyStore())
    expect(deserializeStore('"字符串"')).toEqual(createEmptyStore())
    expect(deserializeStore('42')).toEqual(createEmptyStore())
  })

  it('丢弃结构不合法的条目，保住其余数据', () => {
    const raw = JSON.stringify({
      version: 1,
      docs: [{ id: 'ok', title: 't', content: 'c' }, { id: 123 }],
      annotations: [
        {
          id: 'a1',
          docId: 'ok',
          type: 'vocab',
          anchor: { start: 0, end: 1, text: 'c', prefix: '', suffix: '' },
          contextText: 'c',
          createdAt: 1,
          updatedAt: 1
        },
        { id: 'bad', type: 'unknown' }
      ],
      progress: {}
    })
    const store = deserializeStore(raw)
    expect(store.docs).toHaveLength(1)
    expect(store.annotations).toHaveLength(1)
    expect(store.annotations[0].id).toBe('a1')
  })

  it('缺少字段时补默认值', () => {
    const store = deserializeStore('{}')
    expect(store.docs).toEqual([])
    expect(store.annotations).toEqual([])
    expect(store.progress).toEqual({})
  })
})

describe('createId', () => {
  it('生成的 id 不重复', () => {
    const ids = new Set(Array.from({ length: 200 }, createId))
    expect(ids.size).toBe(200)
  })
})
