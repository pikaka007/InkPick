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
  removeAnnotation,
  serializeStore,
  setProgress
} from '@core/store'
import type { Anchor, Annotation, Doc, Store } from '@core/types'

const SAVE_DEBOUNCE_MS = 300

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pending: Store | null = null

function scheduleSave(store: Store): void {
  pending = store
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS)
}

/** 立即落盘。关窗前必须调用，否则最后一次防抖会被丢掉 */
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
  addVocab: (range: { start: number; end: number }, term: string) => void
  addNote: (range: { start: number; end: number }, content: string) => void
  removeAnnotationById: (id: string) => void
  saveProgress: (docId: string, offset: number) => void
}

export const useAppStore = create<AppState>((set, get) => {
  /** 统一的「改 store 并持久化」入口 */
  const commit = (produce: (store: Store) => Store, extra: Partial<AppState> = {}): void => {
    const next = produce(get().store)
    scheduleSave(next)
    set({ store: next, ...extra })
  }

  const createAnnotationFor = (
    type: 'vocab' | 'note',
    range: { start: number; end: number },
    payload: { term?: string; content?: string }
  ): void => {
    const { store, currentDocId } = get()
    if (!currentDocId) return
    const doc = getDoc(store, currentDocId)
    if (!doc) return

    const anchor = createAnchor(doc.content, range.start, range.end)
    if (!anchor.text.trim()) return

    const annotation = createAnnotation({
      docId: currentDocId,
      type,
      anchor,
      contextText: sentenceAround(doc.content, range.start, range.end),
      ...payload
    })
    commit((current) => addAnnotation(current, annotation))
  }

  return {
    ready: false,
    store: createEmptyStore(),
    currentDocId: null,

    init: async () => {
      const raw = await window.api.readStore()
      const store = deserializeStore(raw)
      const lastDocId =
        store.lastDocId && store.docs.some((d) => d.id === store.lastDocId) ? store.lastDocId : (store.docs[0]?.id ?? null)
      set({ store, currentDocId: lastDocId, ready: true })
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

    addVocab: (range, term) => createAnnotationFor('vocab', range, { term }),

    addNote: (range, content) => createAnnotationFor('note', range, { content }),

    removeAnnotationById: (id) => commit((store) => removeAnnotation(store, id)),

    saveProgress: (docId, offset) => {
      const doc = getDoc(get().store, docId)
      if (!doc) return
      commit((store) => setProgress(store, docId, createAnchor(doc.content, offset, offset)))
    }
  }
})

export function currentDoc(state: AppState): Doc | null {
  return state.currentDocId ? (getDoc(state.store, state.currentDocId) ?? null) : null
}

export function currentAnnotations(state: AppState): Annotation[] {
  return state.currentDocId ? annotationsForDoc(state.store, state.currentDocId) : []
}

export type { Anchor }
