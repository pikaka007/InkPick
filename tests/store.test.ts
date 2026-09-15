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
  removeAnnotation,
  serializeStore,
  setProgress,
  updateAnnotation
} from '@core/store'
import { createAnchor } from '@core/anchor'
import type { Doc } from '@core/types'

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
