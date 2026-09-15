/**
 * Store —— 纯状态操作。不碰文件系统、不碰 DOM，方便单测。
 * 持久化由 shell 负责（当前实现：main 进程写单个 JSON 文件，见 src/main/storeFile.ts）。
 */
import type { Anchor, Annotation, AnnotationType, Doc, Store } from './types'
import { clamp } from './text'
import { DEFAULT_PREFS, normalizePrefs } from './prefs'
import type { ReaderPrefs } from './prefs'

export const STORE_VERSION = 1

export function createEmptyStore(): Store {
  return { version: STORE_VERSION, docs: [], annotations: [], progress: {}, prefs: { ...DEFAULT_PREFS } }
}

export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function addDoc(store: Store, doc: Doc): Store {
  return { ...store, docs: [...store.docs, doc] }
}

/**
 * 删除文档，**级联清掉它的标注与阅读进度**。
 * 不做级联的话会留下一堆指向已删文档的孤儿标注，在「全部文档」视图里变成幽灵条目。
 */
export function removeDoc(store: Store, docId: string): Store {
  const docs = store.docs.filter((doc) => doc.id !== docId)
  if (docs.length === store.docs.length) return store

  return {
    ...store,
    docs,
    annotations: store.annotations.filter((annotation) => annotation.docId !== docId),
    progress: Object.fromEntries(Object.entries(store.progress).filter(([id]) => id !== docId)),
    // 删的正好是当前文档时，退到还剩下的第一本
    lastDocId: store.lastDocId === docId ? docs[0]?.id : store.lastDocId
  }
}

/** 重命名。不接受空标题 —— 空标题会让文档在侧栏里变成一条看不见的东西 */
export function renameDoc(store: Store, docId: string, title: string): Store {
  const trimmed = title.trim()
  if (!trimmed) return store
  return {
    ...store,
    docs: store.docs.map((doc) => (doc.id === docId ? { ...doc, title: trimmed } : doc))
  }
}

export function getDoc(store: Store, docId: string): Doc | undefined {
  return store.docs.find((d) => d.id === docId)
}

export interface NewAnnotationInput {
  docId: string
  type: AnnotationType
  anchor: Anchor
  contextText: string
  term?: string
  content?: string
  now?: number
}

export function createAnnotation(input: NewAnnotationInput): Annotation {
  const now = input.now ?? Date.now()
  return {
    id: createId(),
    docId: input.docId,
    type: input.type,
    anchor: input.anchor,
    contextText: input.contextText,
    term: input.term,
    content: input.content,
    createdAt: now,
    updatedAt: now
  }
}

export function addAnnotation(store: Store, annotation: Annotation): Store {
  return { ...store, annotations: [...store.annotations, annotation] }
}

export function updateAnnotation(
  store: Store,
  id: string,
  patch: Partial<Omit<Annotation, 'id' | 'docId' | 'createdAt'>>,
  now = Date.now()
): Store {
  return {
    ...store,
    annotations: store.annotations.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: now } : a))
  }
}

export function removeAnnotation(store: Store, id: string): Store {
  return { ...store, annotations: store.annotations.filter((a) => a.id !== id) }
}

/**
 * 把标注插回原来的位置 —— 给「删除后撤销」用。
 * 保留原 id，所以任何引用仍然有效；已经存在时直接返回（幂等）。
 */
export function insertAnnotationAt(store: Store, annotation: Annotation, index: number): Store {
  if (store.annotations.some((item) => item.id === annotation.id)) return store
  const annotations = [...store.annotations]
  annotations.splice(clamp(index, 0, annotations.length), 0, annotation)
  return { ...store, annotations }
}

/** 删除前先找出它在列表里的位置，撤销时才能放回原处 */
export function indexOfAnnotation(store: Store, id: string): number {
  return store.annotations.findIndex((item) => item.id === id)
}

export function annotationsForDoc(store: Store, docId: string): Annotation[] {
  return store.annotations.filter((a) => a.docId === docId)
}

export function setProgress(store: Store, docId: string, anchor: Anchor): Store {
  return { ...store, progress: { ...store.progress, [docId]: anchor } }
}

export function setPrefs(store: Store, patch: Partial<ReaderPrefs>): Store {
  return { ...store, prefs: normalizePrefs({ ...store.prefs, ...patch }) }
}

export function serializeStore(store: Store): string {
  return JSON.stringify(store)
}

/**
 * 反序列化必须容错：文件损坏、版本不符时退回空 store，绝不让应用起不来。
 * 用户的标注比阅读进度重要得多，宁可丢进度也不能崩。
 */
export function deserializeStore(raw: string | null | undefined): Store {
  if (!raw) return createEmptyStore()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return createEmptyStore()
  }

  if (!parsed || typeof parsed !== 'object') return createEmptyStore()
  const candidate = parsed as Partial<Store>

  return {
    version: typeof candidate.version === 'number' ? candidate.version : STORE_VERSION,
    docs: Array.isArray(candidate.docs) ? candidate.docs.filter(isDoc) : [],
    annotations: Array.isArray(candidate.annotations) ? candidate.annotations.filter(isAnnotation) : [],
    progress: candidate.progress && typeof candidate.progress === 'object' ? candidate.progress : {},
    lastDocId: typeof candidate.lastDocId === 'string' ? candidate.lastDocId : undefined,
    // 旧版本文件没有 prefs，normalizePrefs 会补全并夹到合法档位
    prefs: normalizePrefs(candidate.prefs)
  }
}

function isDoc(value: unknown): value is Doc {
  const d = value as Partial<Doc> | null
  return !!d && typeof d.id === 'string' && typeof d.content === 'string' && typeof d.title === 'string'
}

function isAnnotation(value: unknown): value is Annotation {
  const a = value as Partial<Annotation> | null
  return (
    !!a &&
    typeof a.id === 'string' &&
    typeof a.docId === 'string' &&
    (a.type === 'vocab' || a.type === 'note') &&
    !!a.anchor &&
    typeof a.anchor.start === 'number' &&
    typeof a.anchor.end === 'number' &&
    typeof a.anchor.text === 'string'
  )
}
