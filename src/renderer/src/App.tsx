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
import { indexOfAnnotation } from '@core/store'
import { groupVocab } from '@core/vocab'
import type { Annotation, Doc } from '@core/types'
import Reader from '@renderer/components/Reader'
import type { JumpTarget } from '@renderer/components/Reader'
import Sidebar from '@renderer/components/Sidebar'
import { flushSave, useAppStore } from '@renderer/state'
import type { OffsetRange } from '@renderer/state'

interface ToastState {
  message: string
  /** 只有「可撤销」的提示才带动作按钮 */
  action?: { label: string; run: () => void }
}

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
  const removeDocById = useAppStore((state) => state.removeDocById)
  const renameDocById = useAppStore((state) => state.renameDocById)
  const restoreAnnotation = useAppStore((state) => state.restoreAnnotation)
  const updateNote = useAppStore((state) => state.updateNote)
  const setManualDefinition = useAppStore((state) => state.setManualDefinition)
  const saveProgress = useAppStore((state) => state.saveProgress)
  const updatePrefs = useAppStore((state) => state.updatePrefs)
  const prefs = store.prefs

  // 主题挂在 documentElement 上，整个应用（含侧栏）一起换
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme
  }, [prefs.theme])

  const [jump, setJump] = useState<JumpTarget | null>(null)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  /** 单词本/笔记列表看的是当前文档还是全部文档 */
  const [scope, setScope] = useState<'doc' | 'all'>('doc')

  useEffect(() => {
    if (!toast) return
    // 带撤销按钮的提示多留一会儿，否则来不及点
    const timer = setTimeout(() => setToast(null), toast.action ? 6000 : 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const notify = useCallback((message: string) => setToast({ message }), [])

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
   * 删除单条标注：**不弹确认框**，改成给一次撤销机会。
   * 确认框只能防误点，撤销能拯救所有手滑，而且不会打断流程。
   */
  const handleRemoveAnnotation = (id: string): void => {
    const index = indexOfAnnotation(store, id)
    const annotation = store.annotations[index]
    if (!annotation) return

    removeAnnotationById(id)
    setToast({
      message: annotation.type === 'vocab' ? '已删除 1 条词条' : '已删除 1 条笔记',
      action: {
        label: '撤销',
        run: () => {
          restoreAnnotation(annotation, index)
          setToast({ message: '已恢复' })
        }
      }
    })
  }

  /** 删除文档：不可逆且代价大，弹原生确认框，并写清会连带删掉什么 */
  const handleDeleteDoc = async (doc: Doc): Promise<void> => {
    const count = store.annotations.filter((item) => item.docId === doc.id).length

    const confirmed = await window.api.confirmAction({
      title: '删除文档',
      message: `删除《${doc.title}》？`,
      detail:
        count > 0
          ? `会同时删除这个文档里的 ${count} 条标注和阅读进度。\n此操作不可撤销。`
          : '会同时删除它的阅读进度。此操作不可撤销。',
      confirmLabel: '删除'
    })
    if (!confirmed) return

    removeDocById(doc.id)
    setJump(null)
    setActiveAnnotationId(null)
    setToast({
      message: count > 0 ? `已删除《${doc.title}》和 ${count} 条标注` : `已删除《${doc.title}》`
    })
  }

  /**
   * 导出范围跟侧栏一致：本文件就只有当前文档，全部就是所有文档。
   */
  const handleExport = async (kind: 'vocab' | 'notes'): Promise<void> => {
    if (visibleAnnotations.length === 0) {
      setToast({ message: '还没有可导出的标注' })
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
      setToast({ message: saved ? `已导出到 ${saved}` : '已取消导出' })
    } catch (error) {
      setToast({ message: `导出失败：${error instanceof Error ? error.message : String(error)}` })
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
        onSelectDoc={handleDocChange}
        onRenameDoc={renameDocById}
        onDeleteDoc={(doc) => void handleDeleteDoc(doc)}
        onJump={handleJump}
        onRemove={handleRemoveAnnotation}
        onSetDefinition={setManualDefinition}
        onEditNote={updateNote}
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
          onNotify={notify}
          prefs={prefs}
          onPrefsChange={updatePrefs}
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

      {toast && (
        <div className="toast">
          <span>{toast.message}</span>
          {toast.action && (
            <button type="button" className="toast-action" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
