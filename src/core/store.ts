/**
 * Store —— 纯状态操作。不碰文件系统、不碰 DOM，方便单测。
 * 持久化由 shell 负责（当前实现：main 进程写单个 JSON 文件，见 src/main/storeFile.ts）。
 */
import type { Anchor, Annotation, AnnotationType, Doc, LookupStatus, Store } from './types'
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
  /** 手动添加的词没有来源书 */
  docId?: string
  type: AnnotationType
  /** 手动添加的词没有位置 */
  anchor?: Anchor
  contextText?: string
  term?: string
  content?: string
  /** 刚收藏、还没查词时传 'pending' */
  lookupStatus?: LookupStatus
  now?: number
}

export function createAnnotation(input: NewAnnotationInput): Annotation {
  const now = input.now ?? Date.now()
  return {
    id: createId(),
    docId: input.docId,
    type: input.type,
    anchor: input.anchor,
    contextText: input.contextText ?? '',
    term: input.term,
    content: input.content,
    lookupStatus: input.lookupStatus,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 是不是「手动添加的词」—— 判断依据是缺 docId 或 anchor。
 *
 * 刻意**不额外存一个 source 字段**：那样它会和 docId/anchor 存在两份事实，
 * 早晚出现 source 说是手动、却又有 anchor 的脏数据。派生比存储可靠。
 */
export function isManual(annotation: Annotation): boolean {
  return !annotation.docId || !annotation.anchor
}

/**
 * 找找词表里是不是已经有这个词了。
 *
 * 两个都比一遍：**分组键**（lemma 优先）和**用户当时输入的原词**。
 * 只比分组键会漏：先收了 runs（lemma=run），再手动加 runs 时
 * 用 'runs' 去比 'run' 就比不到，于是重复的又被放进去。
 */
export function findExistingVocab(store: Store, term: string): Annotation | undefined {
  const key = term.trim().toLowerCase()
  if (!key) return undefined
  return store.annotations.find(
    (annotation) =>
      annotation.type === 'vocab' &&
      (vocabKeyOf(annotation) === key || (annotation.term ?? '').trim().toLowerCase() === key)
  )
}

/** 分组的依据：lemma 优先，其次用户输入的原词，最后回退到原文 */
export function vocabKeyOf(annotation: Annotation): string {
  return (annotation.lemma || annotation.term || annotation.anchor?.text || '').trim().toLowerCase()
}

/** 列表里展示哪段文字：优先创建时抓住的那句话，其次选中的原文 */
export function annotationText(annotation: Pick<Annotation, 'contextText' | 'anchor'>): string {
  return annotation.contextText || annotation.anchor?.text || ''
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
  if (!a || typeof a.id !== 'string') return false
  if (a.type !== 'vocab' && a.type !== 'note') return false

  const hasDoc = typeof a.docId === 'string' && a.docId.length > 0
  const hasAnchor =
    !!a.anchor &&
    typeof a.anchor.start === 'number' &&
    typeof a.anchor.end === 'number' &&
    typeof a.anchor.text === 'string'

  // 两者必须同进同退：
  //   都有 → 来自阅读的正常标注
  //   都没有 → 用户手动添加的词
  //   只有一半 → 脏数据，丢掉（而不是带进内存里让它到处判空）
  return hasDoc === hasAnchor
}
