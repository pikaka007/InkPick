import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { resolveAnchor } from '@core/anchor'
import { splitParagraphs } from '@core/text'
import type { Annotation, Doc } from '@core/types'
import { applyHighlight, clearHighlight, highlightSupported } from '@renderer/highlight'
import { elementAtOffset, rangeForOffsets, rangeToOffsets, segmentStarts } from '@renderer/selection'
import type { OffsetRange } from '@renderer/selection'

export interface JumpTarget extends OffsetRange {
  nonce: number
}

interface SelectionInfo extends OffsetRange {
  text: string
  top: number
  left: number
}

interface ReaderProps {
  doc: Doc
  annotations: Annotation[]
  jump: JumpTarget | null
  initialOffset: number
  onAddVocab: (range: OffsetRange, term: string) => void
  onAddNote: (range: OffsetRange, content: string) => void
  onProgress: (offset: number) => void
  /** 提示消息交给 App 统一展示 */
  onNotify: (message: string) => void
}

function clearDomSelection(): void {
  window.getSelection()?.removeAllRanges()
}

export default function Reader({
  doc,
  annotations,
  jump,
  initialOffset,
  onAddVocab,
  onAddNote,
  onProgress,
  onNotify
}: ReaderProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const restoredDocRef = useRef<string | null>(null)
  const lastReportedRef = useRef<number>(-1)

  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [noteTarget, setNoteTarget] = useState<OffsetRange | null>(null)
  const [noteText, setNoteText] = useState('')

  const segments = useMemo(() => splitParagraphs(doc.content), [doc.content])
  const starts = useMemo(() => segmentStarts(segments), [segments])

  // 打开文档时回到上次读到的位置（只在切换文档时执行一次）
  useEffect(() => {
    if (restoredDocRef.current === doc.id) return
    const root = rootRef.current
    if (!root) return
    restoredDocRef.current = doc.id
    lastReportedRef.current = initialOffset
    elementAtOffset(root, starts, initialOffset)?.scrollIntoView({ block: 'start' })
  }, [doc.id, starts, initialOffset])

  // 把所有标注画成高亮。位置一律走 resolveAnchor 重算，原文漂移也能找回来。
  useEffect(() => {
    const root = rootRef.current
    if (!root || !highlightSupported()) return

    const vocab: Range[] = []
    const notes: Range[] = []
    for (const annotation of annotations) {
      const resolved = resolveAnchor(doc.content, annotation.anchor)
      if (!resolved) continue
      const range = rangeForOffsets(root, starts, resolved)
      if (!range) continue
      if (annotation.type === 'vocab') vocab.push(range)
      else notes.push(range)
    }

    applyHighlight('inkpick-vocab', vocab)
    applyHighlight('inkpick-note', notes)
    return () => {
      clearHighlight('inkpick-vocab')
      clearHighlight('inkpick-note')
    }
  }, [annotations, doc.content, starts])

  // 从列表跳回原文
  useEffect(() => {
    if (!jump) return
    const root = rootRef.current
    if (!root) return

    elementAtOffset(root, starts, jump.start)?.scrollIntoView({ block: 'center', behavior: 'smooth' })

    const range = rangeForOffsets(root, starts, jump)
    if (range) {
      applyHighlight('inkpick-active', [range])
      const timer = setTimeout(() => clearHighlight('inkpick-active'), 1600)
      return () => {
        clearTimeout(timer)
        clearHighlight('inkpick-active')
      }
    }
    return undefined
  }, [jump, starts])

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    const root = rootRef.current
    if (!container || !root) return

    const top = container.scrollTop + 8
    const elements = root.querySelectorAll<HTMLElement>('[data-seg]')
    let offset = starts[0] ?? 0
    for (const element of elements) {
      if (element.offsetTop + element.offsetHeight > top) {
        offset = starts[Number(element.dataset.seg)] ?? offset
        break
      }
    }

    if (offset !== lastReportedRef.current) {
      lastReportedRef.current = offset
      onProgress(offset)
    }
  }, [starts, onProgress])

  const handleSelection = useCallback(() => {
    const root = rootRef.current
    if (!root) return

    const domSelection = window.getSelection()
    if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) {
      setSelection(null)
      return
    }

    const range = domSelection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) {
      setSelection(null)
      return
    }

    const offsets = rangeToOffsets(root, range, starts)
    if (!offsets || offsets.start === offsets.end) {
      setSelection(null)
      return
    }

    const rect = range.getBoundingClientRect()
    setSelection({
      ...offsets,
      text: doc.content.slice(offsets.start, offsets.end),
      top: rect.top,
      left: rect.left + rect.width / 2
    })
  }, [doc.content, starts])

  const handleAddVocab = (): void => {
    if (!selection) return
    const term = selection.text.trim()
    if (!term) return
    onAddVocab({ start: selection.start, end: selection.end }, term)
    setSelection(null)
    clearDomSelection()
    onNotify('已加入单词本')
  }

  const handleAddNote = (): void => {
    if (!selection) return
    setNoteTarget({ start: selection.start, end: selection.end })
    setNoteText('')
    setSelection(null)
  }

  const submitNote = (): void => {
    if (!noteTarget) return
    const content = noteText.trim()
    if (!content) return
    onAddNote(noteTarget, content)
    setNoteTarget(null)
    setNoteText('')
    clearDomSelection()
    onNotify('笔记已保存')
  }

  return (
    <div className="reader">
      <header className="reader-header">
        <h1>{doc.title}</h1>
        <span className="reader-meta">
          {doc.content.length.toLocaleString()} 字符 · {annotations.length} 条标注
          {highlightSupported() ? '' : ' · 当前环境不支持高亮'}
        </span>
      </header>

      <div
        className="reader-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseUp={handleSelection}
        onKeyUp={handleSelection}
      >
        <div className="reader-body" ref={rootRef}>
          {segments.map((segment, index) => (
            <p className="paragraph" key={index} data-seg={index}>
              {segment.text}
            </p>
          ))}
        </div>
      </div>

      {selection && (
        <div
          className="selection-toolbar"
          style={{ top: selection.top - 46, left: selection.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={handleAddVocab}>
            ＋ 单词
          </button>
          <button type="button" onClick={handleAddNote}>
            ＋ 笔记
          </button>
        </div>
      )}

      {noteTarget && (
        <div className="modal-backdrop" onClick={() => setNoteTarget(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>写笔记</h2>
            <blockquote>{doc.content.slice(noteTarget.start, noteTarget.end)}</blockquote>
            <textarea
              autoFocus
              value={noteText}
              placeholder="想到了什么？"
              onChange={(event) => setNoteText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setNoteTarget(null)
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submitNote()
              }}
            />
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setNoteTarget(null)}>
                取消
              </button>
              <button type="button" onClick={submitNote} disabled={!noteText.trim()}>
                保存（Ctrl/⌘ + Enter）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
