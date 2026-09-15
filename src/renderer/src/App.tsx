import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { resolveAnchor } from '@core/anchor'
import {
  annotationsToMarkdown,
  libraryFileName,
  libraryToMarkdown,
  suggestedFileName,
  vocabToAnkiCsv
} from '@core/export'
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
  /** 单词本/笔记列表看的是当前文档还是全部文档 */
  const [scope, setScope] = useState<'doc' | 'all'>('doc')

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
  const docAnnotations = currentDocId ? store.annotations.filter((item) => item.docId === currentDocId) : []
  const visibleAnnotations = scope === 'all' ? store.annotations : docAnnotations
  const docTitles = Object.fromEntries(store.docs.map((item) => [item.id, item.title]))

  const handleProgress = useCallback(
    (offset: number) => {
      if (currentDocId) saveProgress(currentDocId, offset)
    },
    [currentDocId, saveProgress]
  )

  /** 点标注：如果它属于另一本书，先切过去 */
  const handleJump = (annotation: Annotation): void => {
    const target = store.docs.find((item) => item.id === annotation.docId)
    if (!target) return

    const resolved = resolveAnchor(target.content, annotation.anchor)
    if (!resolved) return

    if (annotation.docId !== currentDocId) selectDoc(annotation.docId)
    setActiveAnnotationId(annotation.id)
    setJump({ start: resolved.start, end: resolved.end, nonce: Date.now() })
  }

  const handleDocChange = (docId: string): void => {
    setJump(null)
    setActiveAnnotationId(null)
    selectDoc(docId)
  }

  /**
   * 导出范围跟侧栏一致：本文件就只有当前文档，全部就是所有文档。
   */
  const handleExport = async (kind: 'vocab' | 'notes'): Promise<void> => {
    if (visibleAnnotations.length === 0) {
      setToast('还没有可导出的标注')
      return
    }
    if (scope === 'doc' && !doc) return

    const content =
      kind === 'vocab'
        ? vocabToAnkiCsv(groupVocab(visibleAnnotations), docTitles)
        : scope === 'doc'
          ? annotationsToMarkdown(visibleAnnotations, doc!)
          : libraryToMarkdown(store.docs, visibleAnnotations)

    const fileName =
      scope === 'doc'
        ? suggestedFileName(doc!.title, kind, kind === 'vocab' ? 'csv' : 'md')
        : libraryFileName(kind, kind === 'vocab' ? 'csv' : 'md')

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
        annotations={visibleAnnotations}
        docTitles={docTitles}
        showSource={scope === 'all'}
        scope={scope}
        onScopeChange={setScope}
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
          annotations={docAnnotations}
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
