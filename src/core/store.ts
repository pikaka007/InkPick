/**
 * Store —— 纯状态操作。不碰文件系统、不碰 DOM，方便单测。
 * 持久化由 shell 负责（当前实现：main 进程写单个 JSON 文件，见 src/main/storeFile.ts）。
 */
import type { Anchor, Annotation, AnnotationType, Doc, Store } from './types'

export const STORE_VERSION = 1

export function createEmptyStore(): Store {
  return { version: STORE_VERSION, docs: [], annotations: [], progress: {} }
}

export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function addDoc(store: Store, doc: Doc): Store {
  return { ...store, docs: [...store.docs, doc] }
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
  patch: Partial<Pick<Annotation, 'term' | 'content'>>,
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

export function annotationsForDoc(store: Store, docId: string): Annotation[] {
  return store.annotations.filter((a) => a.docId === docId)
}

export function setProgress(store: Store, docId: string, anchor: Anchor): Store {
  return { ...store, progress: { ...store.progress, [docId]: anchor } }
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
    lastDocId: typeof candidate.lastDocId === 'string' ? candidate.lastDocId : undefined
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
