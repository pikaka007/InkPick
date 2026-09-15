import { create } from 'zustand'
import { createAnchor } from '@core/anchor'
import { normalizeContent, sentenceAround } from '@core/text'
import { SAMPLE_CONTENT, SAMPLE_TITLE } from '@core/sample'
import {
  addAnnotation,
  addDoc,
  annotationsForDoc,
  createAnnotation,
  createEmptyStore,
  createId,
  deserializeStore,
  getDoc,
  insertAnnotationAt,
  removeAnnotation,
  removeDoc,
  renameDoc,
  serializeStore,
  setPrefs,
  setProgress,
  updateAnnotation
} from '@core/store'
import type { Anchor, Annotation, Doc, Store } from '@core/types'
import type { ReaderPrefs } from '@core/prefs'
import type { OffsetRange } from './selection'

export type { OffsetRange }

const SAVE_DEBOUNCE_MS = 300

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pending: Store | null = null

function scheduleSave(store: Store): void {
  pending = store
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS)
}

/** 立即落盘。关窗时必须调用，否则最后一次防抖会被丢掉 */
export async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const store = pending
  pending = null
  if (store) await window.api.writeStore(serializeStore(store))
}

interface AppState {
  ready: boolean
  store: Store
  currentDocId: string | null
  init: () => Promise<void>
  openDocument: () => Promise<void>
  loadSample: () => void
  selectDoc: (docId: string) => void
  addVocab: (range: OffsetRange, term: string) => void
  addNote: (range: OffsetRange, content: string) => void
  removeAnnotationById: (id: string) => void
  /** 删除文档，级联清掉它的标注与进度 */
  removeDocById: (docId: string) => void
  renameDocById: (docId: string, title: string) => void
  /** 撤销删除：把标注插回原来的位置 */
  restoreAnnotation: (annotation: Annotation, index: number) => void
  updateNote: (id: string, content: string) => void
  setManualDefinition: (annotationIds: string[], definition: string) => void
  /** 查词并回填。查不到也正常，不回滚标注 */
  lookupAndPatch: (term: string, annotationIds: string[]) => Promise<void>
  saveProgress: (docId: string, offset: number) => void
  /** 阅读偏好：字号 / 行高 / 行宽 / 主题 */
  updatePrefs: (patch: Partial<ReaderPrefs>) => void
}

export const useAppStore = create<AppState>((set, get) => {
  /** 统一的「改 store 并持久化」入口 */
  const commit = (produce: (store: Store) => Store, extra: Partial<AppState> = {}): void => {
    const next = produce(get().store)
    scheduleSave(next)
    set({ store: next, ...extra })
  }

  const patchAnnotations = (ids: string[], patch: Partial<Annotation>): void => {
    if (ids.length === 0) return
    commit((current) => ids.reduce((store, id) => updateAnnotation(store, id, patch), current))
  }

  const createAnnotationFor = (
    type: 'vocab' | 'note',
    range: OffsetRange,
    payload: { term?: string; content?: string }
  ): Annotation | null => {
    const { store, currentDocId } = get()
    if (!currentDocId) return null
    const doc = getDoc(store, currentDocId)
    if (!doc) return null

    const anchor = createAnchor(doc.content, range.start, range.end)
    if (!anchor.text.trim()) return null

    const annotation = createAnnotation({
      docId: currentDocId,
      type,
      anchor,
      contextText: sentenceAround(doc.content, range.start, range.end),
      ...payload,
      // 先钉住、再查词：词典无论如何都不能让「收藏」这个动作失败
      ...(type === 'vocab' ? { lookupStatus: 'pending' as const } : {})
    })
    commit((current) => addAnnotation(current, annotation))
    return annotation
  }

  return {
    ready: false,
    store: createEmptyStore(),
    currentDocId: null,

    init: async () => {
      const raw = await window.api.readStore()
      const store = deserializeStore(raw)
      const lastDocId =
        store.lastDocId && store.docs.some((d) => d.id === store.lastDocId)
          ? store.lastDocId
          : (store.docs[0]?.id ?? null)

      set({ store, currentDocId: lastDocId, ready: true })

      // 之前收的词可能还没查过（或上次查词失败），补一次
      await backfillPending()
    },

    openDocument: async () => {
      const imported = await window.api.importDocument()
      if (!imported) return

      const doc: Doc = {
        id: createId(),
        title: imported.title,
        content: normalizeContent(imported.content),
        createdAt: Date.now()
      }

      commit((store) => setProgress(addDoc(store, doc), doc.id, createAnchor(doc.content, 0, 0)), {
        currentDocId: doc.id
      })
    },

    loadSample: () => {
      const existing = get().store.docs.find((d) => d.title === SAMPLE_TITLE)
      if (existing) {
        commit((store) => ({ ...store, lastDocId: existing.id }), { currentDocId: existing.id })
        return
      }

      const doc: Doc = {
        id: createId(),
        title: SAMPLE_TITLE,
        content: normalizeContent(SAMPLE_CONTENT),
        createdAt: Date.now()
      }
      commit((store) => setProgress(addDoc(store, doc), doc.id, createAnchor(doc.content, 0, 0)), {
        currentDocId: doc.id
      })
    },

    selectDoc: (docId) => {
      commit((store) => ({ ...store, lastDocId: docId }), { currentDocId: docId })
    },

    addVocab: (range, term) => {
      const annotation = createAnnotationFor('vocab', range, { term })
      if (annotation) void get().lookupAndPatch(term, [annotation.id])
    },

    addNote: (range, content) => {
      createAnnotationFor('note', range, { content })
    },

    removeAnnotationById: (id) => commit((store) => removeAnnotation(store, id)),

    removeDocById: (docId) => {
      const next = removeDoc(get().store, docId)
      commit(() => next, {
        // 删的正好是正在看的这本时，跟着切到还剩下的那本
        currentDocId: get().currentDocId === docId ? (next.lastDocId ?? null) : get().currentDocId
      })
    },

    renameDocById: (docId, title) => commit((store) => renameDoc(store, docId, title)),

    restoreAnnotation: (annotation, index) =>
      commit((store) => insertAnnotationAt(store, annotation, index)),

    updateNote: (id, content) => {
      const trimmed = content.trim()
      if (!trimmed) return
      patchAnnotations([id], { content: trimmed })
    },

    setManualDefinition: (annotationIds, definition) => {
      patchAnnotations(annotationIds, { manualDefinition: definition.trim() })
    },

    lookupAndPatch: async (term, annotationIds) => {
      try {
        const result = await window.api.lookupWord(term)
        if (result.entry === null) {
          patchAnnotations(annotationIds, { lookupStatus: 'missing' })
          return
        }
        patchAnnotations(annotationIds, {
          lookupStatus: 'found',
          lemma: result.lemma,
          phonetic: result.entry.phonetic,
          senses: result.entry.senses
        })
      } catch {
        // 查词失败就停在 pending，下次启动再补，绝不因此丢掉标注
      }
    },

    saveProgress: (docId, offset) => {
      const doc = getDoc(get().store, docId)
      if (!doc) return
      commit((store) => setProgress(store, docId, createAnchor(doc.content, offset, offset)))
    },

    updatePrefs: (patch) => commit((store) => setPrefs(store, patch))
  }
})

/** 把还停在 pending 的词条补查一遍（同一个词只查一次） */
async function backfillPending(): Promise<void> {
  const pendingVocab = useAppStore
    .getState()
    .store.annotations.filter((item) => item.type === 'vocab' && item.lookupStatus === 'pending')
  if (pendingVocab.length === 0) return

  const byTerm = new Map<string, string[]>()
  for (const annotation of pendingVocab) {
    const term = (annotation.term ?? annotation.anchor.text).trim()
    if (!term) continue
    const ids = byTerm.get(term) ?? []
    ids.push(annotation.id)
    byTerm.set(term, ids)
  }

  for (const [term, ids] of byTerm) {
    await useAppStore.getState().lookupAndPatch(term, ids)
  }
}

export function currentDoc(state: AppState): Doc | null {
  return state.currentDocId ? (getDoc(state.store, state.currentDocId) ?? null) : null
}

export function currentAnnotations(state: AppState): Annotation[] {
  return state.currentDocId ? annotationsForDoc(state.store, state.currentDocId) : []
}

export type { Anchor }
