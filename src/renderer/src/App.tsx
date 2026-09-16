import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { resolveAnchor } from '@core/anchor'
import { detectChapters } from '@core/chapters'
import {
  annotationsToMarkdown,
  libraryFileName,
  libraryToMarkdown,
  suggestedFileName,
  vocabToAnkiCsv
} from '@core/export'
import { DEFAULT_SIDEBAR_WIDTH, clampSidebarWidth } from '@core/prefs'
import { indexOfAnnotation } from '@core/store'
import { splitParagraphs } from '@core/text'
import { groupVocab } from '@core/vocab'
import type { Annotation, Doc } from '@core/types'
import Reader from '@renderer/components/Reader'
import type { JumpTarget } from '@renderer/components/Reader'
import Sidebar from '@renderer/components/Sidebar'
import SidebarToggle from '@renderer/components/SidebarToggle'
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
  const addManualWord = useAppStore((state) => state.addManualWord)
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
  /** 手动记词的输入条是否展开 */
  const [addingWord, setAddingWord] = useState(false)
  /** 单词本/笔记列表看的是当前文档还是全部 */
  const [scope, setScope] = useState<'doc' | 'all'>('doc')

  useEffect(() => {
    if (!toast) return
    // 带撤销按钮的提示多留一会儿，否则来不及点
    const timer = setTimeout(() => setToast(null), toast.action ? 6000 : 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const notify = useCallback((message: string) => setToast({ message }), [])

  /** 展开手动记词的输入条。侧栏收着的时候先展开，否则输入框根本不在屏幕上 */
  const startAddWord = useCallback((): void => {
    if (useAppStore.getState().store.prefs.sidebarCollapsed) updatePrefs({ sidebarCollapsed: false })
    setAddingWord(true)
  }, [updatePrefs])

  const handleAddWord = useCallback(
    (term: string): 'added' | 'duplicate' | 'empty' => {
      const result = addManualWord(term)
      const label = term.trim()
      if (result === 'added') notify(`已记下 ${label}`)
      else if (result === 'duplicate') notify(`${label} 已经在词表里了`)
      return result
    },
    [addManualWord, notify]
  )

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
  /**
   * 没有打开书时强制看「全部」——
   * 一个只用手动记词、压根不导入书的用户，否则会看到一个空列表，
   * 而「本文件」对他没有任何意义。
   *
   * 注意这里是**显示层**的派生，不写回 scope：scope 是用户的偏好，
   * 没书时先给他看全部，等他打开书再按偏好显示那本书的词。
   */
  const activeScope: 'doc' | 'all' = currentDocId ? scope : 'all'
  const visibleAnnotations = activeScope === 'all' ? store.annotations : docAnnotations
  const docTitles = Object.fromEntries(store.docs.map((item) => [item.id, item.title]))

  /**
   * 段落只切一次，章节与正文渲染共用这一份。
   * 如果两处各切一次，章节的 segStart 和渲染的 data-seg 序号就可能对不上 ——
   * 而这种不一致不会报错，只会让「跳到第 12 章」跳错地方。
   */
  const segments = useMemo(() => (doc ? splitParagraphs(doc.content) : []), [doc])
  const chapters = useMemo(() => detectChapters(segments, doc?.content.length ?? 0), [segments, doc])

  /** 当前读到第几章。由 Reader 上报（它才知道视口顶部在哪），侧栏目录靠它高亮 */
  const [chapterIndex, setChapterIndex] = useState(-1)

  /** 点目录：复用现成的 jump 通道，只是换成「顶端对齐 + 立即」 */
  const handleJumpChapter = useCallback(
    (index: number): void => {
      const chapter = chapters[index]
      if (!chapter) return
      setActiveAnnotationId(null)
      setJump({ start: chapter.start, end: chapter.start, nonce: Date.now(), kind: 'chapter' })
    },
    [chapters]
  )

  const handleProgress = useCallback(
    (offset: number) => {
      if (currentDocId) saveProgress(currentDocId, offset)
    },
    [currentDocId, saveProgress]
  )

  /** 点标注：如果它属于另一本书，先切过去 */
  const handleJump = (annotation: Annotation): void => {
    // 手动添加的词没有位置也没有来源书，点它不跳转（它本来就在词表里）
    if (!annotation.docId || !annotation.anchor) return

    const target = store.docs.find((item) => item.id === annotation.docId)
    if (!target) return

    const resolved = resolveAnchor(target.content, annotation.anchor)
    if (!resolved) return

    if (annotation.docId !== currentDocId) selectDoc(annotation.docId)
    setActiveAnnotationId(annotation.id)
    setJump({ start: resolved.start, end: resolved.end, nonce: Date.now(), kind: 'annotation' })
  }

  const handleDocChange = (docId: string): void => {
    setJump(null)
    setActiveAnnotationId(null)
    setChapterIndex(-1)
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
    if (activeScope === 'doc' && !doc) return

    const content =
      kind === 'vocab'
        ? vocabToAnkiCsv(groupVocab(visibleAnnotations), docTitles)
        : activeScope === 'doc'
          ? annotationsToMarkdown(visibleAnnotations, doc!)
          : libraryToMarkdown(store.docs, visibleAnnotations)

    const fileName =
      activeScope === 'doc'
        ? suggestedFileName(doc!.title, kind, kind === 'vocab' ? 'csv' : 'md')
        : libraryFileName(kind, kind === 'vocab' ? 'csv' : 'md')

    try {
      const saved = await window.api.saveTextFile(fileName, content)
      setToast({ message: saved ? `已导出到 ${saved}` : '已取消导出' })
    } catch (error) {
      setToast({ message: `导出失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }

  /** 拖宽时先只改本地状态，松手才写存档 —— 否则每次 pointermove 都会触发一次落盘 */
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  /**
   * 拖拽把手。
   *
   * 用窗口级监听而不是 setPointerCapture：捕获一旦在前一次拖拽里没释放干净，
   * 后续 pointermove / pointerup 会直接收不到（实测踩过）。
   *
   * 窗口级监听也有它自己的风险：松手发生在窗口之外时 pointerup 可能递不到，
   * 监听就会残留、之后每次鼠标移动都继续改宽度。所以下一次拖拽开始前先把
   * 上一个没收尾的收掉。
   */
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()

    dragCleanupRef.current?.()

    const start = { x: event.clientX, width: sidebarWidth }
    let latest: number | null = null
    setDragging(true)

    const onMove = (moveEvent: PointerEvent): void => {
      // 用「起点 + 位移」而不是绝对坐标，跟窗口位置、缩放无关
      latest = clampSidebarWidth(start.width + (moveEvent.clientX - start.x))
      setDragWidth(latest)
    }

    const finish = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      dragCleanupRef.current = null
      setDragging(false)
      setDragWidth(null)
      // 没动过就不提交，否则单击一下也会写一次存档
      if (latest !== null) updatePrefs({ sidebarWidth: latest })
    }

    dragCleanupRef.current = finish
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const sidebarWidth = dragWidth ?? prefs.sidebarWidth

  // Ctrl/⌘+B 折叠侧栏。在输入框里不抢这个键
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'b') return
      const target = event.target as HTMLElement | null
      if (target && /^(input|textarea)$/i.test(target.tagName)) return
      event.preventDefault()
      updatePrefs({ sidebarCollapsed: !useAppStore.getState().store.prefs.sidebarCollapsed })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [updatePrefs])

  if (!ready) {
    return <div className="boot">加载中…</div>
  }

  const toggleSidebar = (): void => updatePrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })

  return (
    <div className="app" data-sidebar={prefs.sidebarCollapsed ? 'collapsed' : 'expanded'}>
      {!prefs.sidebarCollapsed && (
        <>
          <div className="sidebar-wrap" style={{ width: sidebarWidth }}>
            <Sidebar
              docs={store.docs}
              currentDocId={currentDocId}
              chapters={chapters}
              chapterIndex={chapterIndex}
              annotations={visibleAnnotations}
              docTitles={docTitles}
              showSource={activeScope === 'all'}
              scope={activeScope}
              onScopeChange={setScope}
              addingWord={addingWord}
              onToggleAddWord={() => setAddingWord((open) => !open)}
              onAddWord={handleAddWord}
              activeAnnotationId={activeAnnotationId}
              onOpen={() => void openDocument()}
              onSelectDoc={handleDocChange}
              onRenameDoc={renameDocById}
              onDeleteDoc={(doc) => void handleDeleteDoc(doc)}
              onJump={handleJump}
              onJumpChapter={handleJumpChapter}
              onRemove={handleRemoveAnnotation}
              onSetDefinition={setManualDefinition}
              onEditNote={updateNote}
              onExport={(kind) => void handleExport(kind)}
            />
          </div>

          {/* 命中区域 10px，靠负边距叠在边界上，不占布局宽度 */}
          <div
            className={dragging ? 'sidebar-resizer dragging' : 'sidebar-resizer'}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            title="拖动调整宽度，双击复位"
            onPointerDown={startDrag}
            onDoubleClick={() => updatePrefs({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH })}
          />
        </>
      )}

      <div className="main">
        {doc ? (
          <Reader
            key={doc.id}
            doc={doc}
            segments={segments}
            chapters={chapters}
            annotations={docAnnotations}
            jump={jump}
            initialOffset={store.progress[doc.id]?.start ?? 0}
            onAddVocab={(range: OffsetRange, term: string) => addVocab(range, term)}
            onAddNote={(range: OffsetRange, content: string) => addNote(range, content)}
            onProgress={handleProgress}
            onChapterChange={setChapterIndex}
            onNotify={notify}
            prefs={prefs}
            onPrefsChange={updatePrefs}
            sidebarCollapsed={prefs.sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        ) : (
          <main className="welcome">
            <div className="welcome-toggle">
              <SidebarToggle collapsed={prefs.sidebarCollapsed} onToggle={toggleSidebar} />
            </div>
            <h1>InkPick</h1>
            <p>一边读，一边把词和想法钉在原文上。</p>
            <div className="welcome-actions">
              <button type="button" onClick={() => void openDocument()}>
                打开一个 TXT
              </button>
              <button type="button" className="ghost" onClick={loadSample}>
                先看看示例
              </button>
              <button type="button" className="ghost" onClick={startAddWord}>
                先记一个单词
              </button>
            </div>
            <ol className="welcome-steps">
              <li>打开文本，滚动阅读</li>
              <li>选中一段文字 → 收藏单词 或 写笔记</li>
              <li>左侧列表随时点回原文那句</li>
              <li>不想导入书也行：点左下角「＋ 单词」，手动记下来</li>
            </ol>
          </main>
        )}
      </div>

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
