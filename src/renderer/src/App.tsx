import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { resolveAnchor } from '@core/anchor'
import { annotationsToMarkdown, suggestedFileName, vocabToAnkiCsv } from '@core/export'
import { groupVocab } from '@core/vocab'
import type { Annotation } from '@core/types'
import Reader from '@renderer/components/Reader'
import type { JumpTarget } from '@renderer/components/Reader'
import Sidebar from '@renderer/components/Sidebar'
import { flushSave, useAppStore } from '@renderer/state'
import type { OffsetRange } from '@renderer/state'

export default function App(): JSX.Element {
  const ready = useAppStore((state) => state.ready)
  const store = useAppStore((state) => state.store)
  const currentDocId = useAppStore((state) => state.currentDocId)
  const init = useAppStore((state) => state.init)
  const openDocument = useAppStore((state) => state.openDocument)
  const loadSample = useAppStore((state) => state.loadSample)
  const selectDoc = useAppStore((state) => state.selectDoc)
  const addVocab = useAppStore((state) => state.addVocab)
  const addNote = useAppStore((state) => state.addNote)
  const removeAnnotationById = useAppStore((state) => state.removeAnnotationById)
  const setManualDefinition = useAppStore((state) => state.setManualDefinition)
  const saveProgress = useAppStore((state) => state.saveProgress)

  const [jump, setJump] = useState<JumpTarget | null>(null)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    void init()
  }, [init])

  // 关窗时落盘（主进程会等我们回话再关）
  useEffect(() => {
    window.api.onBeforeClose(() => {
      flushSave()
        .catch(() => undefined)
        .finally(() => window.api.flushDone())
    })
  }, [])

  const doc = currentDocId ? (store.docs.find((item) => item.id === currentDocId) ?? null) : null
  const annotations = currentDocId ? store.annotations.filter((item) => item.docId === currentDocId) : []

  const handleProgress = useCallback(
    (offset: number) => {
      if (currentDocId) saveProgress(currentDocId, offset)
    },
    [currentDocId, saveProgress]
  )

  const handleJump = (annotation: Annotation): void => {
    if (!doc) return
    const resolved = resolveAnchor(doc.content, annotation.anchor)
    if (!resolved) return
    setActiveAnnotationId(annotation.id)
    setJump({ start: resolved.start, end: resolved.end, nonce: Date.now() })
  }

  const handleDocChange = (docId: string): void => {
    setJump(null)
    setActiveAnnotationId(null)
    selectDoc(docId)
  }

  /**
   * 导出范围跟侧栏一致：只导出当前文档的标注。
   * 跨文档合并导出（把所有书的生词并成一本）是后续项，见 docs/MVP.md。
   */
  const handleExport = async (kind: 'vocab' | 'notes'): Promise<void> => {
    if (!doc) return
    if (annotations.length === 0) {
      setToast('这个文档还没有标注')
      return
    }

    const content =
      kind === 'vocab'
        ? vocabToAnkiCsv(groupVocab(annotations), doc.title)
        : annotationsToMarkdown(annotations, doc)

    const fileName = suggestedFileName(doc.title, kind, kind === 'vocab' ? 'csv' : 'md')
    try {
      const saved = await window.api.saveTextFile(fileName, content)
      setToast(saved ? `已导出到 ${saved}` : '已取消导出')
    } catch (error) {
      setToast(`导出失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!ready) {
    return <div className="boot">加载中…</div>
  }

  return (
    <div className="app">
      <Sidebar
        docs={store.docs}
        currentDocId={currentDocId}
        annotations={annotations}
        activeAnnotationId={activeAnnotationId}
        onOpen={() => void openDocument()}
        onLoadSample={loadSample}
        onSelectDoc={handleDocChange}
        onJump={handleJump}
        onRemove={removeAnnotationById}
        onSetDefinition={setManualDefinition}
        onExport={(kind) => void handleExport(kind)}
      />

      {doc ? (
        <Reader
          key={doc.id}
          doc={doc}
          annotations={annotations}
          jump={jump}
          initialOffset={store.progress[doc.id]?.start ?? 0}
          onAddVocab={(range: OffsetRange, term: string) => addVocab(range, term)}
          onAddNote={(range: OffsetRange, content: string) => addNote(range, content)}
          onProgress={handleProgress}
          onNotify={setToast}
        />
      ) : (
        <main className="welcome">
          <h1>InkPick</h1>
          <p>一边读，一边把词和想法钉在原文上。</p>
          <div className="welcome-actions">
            <button type="button" onClick={() => void openDocument()}>
              打开一个 TXT
            </button>
            <button type="button" className="ghost" onClick={loadSample}>
              先看看示例
            </button>
          </div>
          <ol className="welcome-steps">
            <li>打开文本，滚动阅读</li>
            <li>选中一段文字 → 收藏单词 或 写笔记</li>
            <li>左侧列表随时点回原文那句</li>
          </ol>
        </main>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
