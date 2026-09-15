import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { resolveAnchor } from '@core/anchor'
import { MEASURE_WIDTHS, progressRatio, scrollTopForRatio, stepFontSize } from '@core/prefs'
import type { ReaderPrefs } from '@core/prefs'
import { findMatches, formatMatchPosition, stepMatchIndex } from '@core/search'
import { splitParagraphs } from '@core/text'
import type { Annotation, Doc } from '@core/types'
import { applyHighlight, clearHighlight, highlightSupported } from '@renderer/highlight'
import { elementAtOffset, rangeForOffsets, rangeToOffsets, segmentStarts } from '@renderer/selection'
import type { OffsetRange } from '@renderer/selection'
import ProgressBar from './ProgressBar'
import ReaderSettings from './ReaderSettings'
import SidebarToggle from './SidebarToggle'

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
  prefs: ReaderPrefs
  onPrefsChange: (patch: Partial<ReaderPrefs>) => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
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
  onNotify,
  prefs,
  onPrefsChange,
  sidebarCollapsed,
  onToggleSidebar
}: ReaderProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const restoredDocRef = useRef<string | null>(null)
  const lastReportedRef = useRef<number>(-1)

  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [noteTarget, setNoteTarget] = useState<OffsetRange | null>(null)
  const [noteText, setNoteText] = useState('')
  const [ratio, setRatio] = useState(0)

  /** 搜索。query 为空时不算在搜。matchIndex = -1 表示“有命中但还没跳过去” */
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)
  /** 开始搜索前读到的正文位置。存偏移量而不是 scrollTop ——
   * 搜索框一出现头部会变高，可滚范围跟着变，按像素记会回不准 */
  const searchOriginRef = useRef(0)

  const search = useMemo(() => findMatches(doc.content, query), [doc.content, query])

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

  // 换了查询词就回到「有命中但还没跳过去」的状态，不要自己跑过去
  useEffect(() => {
    setMatchIndex(-1)
  }, [query])

  // 把所有命中画成高亮，当前那个更明显
  useEffect(() => {
    const root = rootRef.current
    if (!root || !highlightSupported()) return

    const ranges = search.matches
      .map((match) => rangeForOffsets(root, starts, match))
      .filter((range): range is Range => range !== null)
    applyHighlight('inkpick-search', ranges)

    const current = search.matches[matchIndex]
    const currentRange = current ? rangeForOffsets(root, starts, current) : null
    applyHighlight('inkpick-search-current', currentRange ? [currentRange] : [])

    return () => {
      clearHighlight('inkpick-search')
      clearHighlight('inkpick-search-current')
    }
  }, [search, matchIndex, starts])

  // 跳到当前命中。
  // 只在你**主动**跳（回车 / 上下按钮 / 回到原处）时触发：
  // 因为 matchIndex 在输入时是 -1，而查询一变就重置回 -1，
  // 所以“边打字边被拉到第一个命中”这种事不会再发生。
  useEffect(() => {
    const root = rootRef.current
    const current = search.matches[matchIndex]
    if (!root || !current) return
    elementAtOffset(root, starts, current.start)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [search, matchIndex, starts])

  const stepSearch = useCallback(
    (direction: 1 | -1) => {
      setMatchIndex((index) => stepMatchIndex(index, search.matches.length, direction))
    },
    [search.matches.length]
  )

  const openSearch = (): void => {
    // 记下开始搜索前读到哪儿，【回到原处】靠它
    searchOriginRef.current = topOffsetOf()
    setSearchOpen(true)
  }

  const closeSearch = (): void => {
    setSearchOpen(false)
    setQuery('')
  }

  const returnToOrigin = (): void => {
    scrollToOffset(searchOriginRef.current)
    closeSearch()
  }

  // Ctrl/⌘+F 打开搜索
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // openSearch 只用到 ref 与 setState，不需要跟着重订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  /** 当前视口顶部对应的正文位置 —— 阅读进度与「回到原处」共用同一套算法 */
  const topOffsetOf = useCallback((): number => {
    const container = scrollRef.current
    const root = rootRef.current
    if (!container || !root) return starts[0] ?? 0

    const top = container.scrollTop + 8
    for (const element of root.querySelectorAll<HTMLElement>('[data-seg]')) {
      if (element.offsetTop + element.offsetHeight > top) {
        return starts[Number(element.dataset.seg)] ?? 0
      }
    }
    return starts[0] ?? 0
  }, [starts])

  const scrollToOffset = useCallback(
    (offset: number): void => {
      const root = rootRef.current
      if (!root) return
      elementAtOffset(root, starts, offset)?.scrollIntoView({ block: 'start' })
    },
    [starts]
  )

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return

    setRatio(progressRatio(container.scrollTop, container.scrollHeight, container.clientHeight))

    const offset = topOffsetOf()
    if (offset !== lastReportedRef.current) {
      lastReportedRef.current = offset
      onProgress(offset)
    }
  }, [topOffsetOf, onProgress])

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
        {/* 放在内容区最左侧：紧贴侧栏边界，且收起/展开位置不变 */}
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />

        <div className="reader-title">
          <h1>{doc.title}</h1>
          <span className="reader-meta">
            {doc.content.length.toLocaleString()} 字符 · {annotations.length} 条标注
            {search.truncated ? ' · 命中太多，只显示前 2000 处' : ''}
            {highlightSupported() ? '' : ' · 当前环境不支持高亮'}
          </span>
        </div>

        <div className="reader-tools">
          {searchOpen ? (
            <div className="search-box">
              <input
                ref={searchInputRef}
                className="search-input"
                placeholder="在本文中搜索"
                aria-label="在本文中搜索"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    stepSearch(event.shiftKey ? -1 : 1)
                  }
                  if (event.key === 'Escape') closeSearch()
                }}
              />
              <span className="search-count">
                {query.trim() === ''
                  ? ''
                  : search.matches.length === 0
                    ? '无匹配'
                    : `${formatMatchPosition(matchIndex, search.matches.length)}${search.truncated ? '+' : ''}`}
              </span>
              <button
                type="button"
                className="tool"
                title="上一个（Shift+Enter）"
                aria-label="上一个匹配"
                disabled={search.matches.length === 0}
                onClick={() => stepSearch(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="tool"
                title="下一个（Enter）"
                aria-label="下一个匹配"
                disabled={search.matches.length === 0}
                onClick={() => stepSearch(1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="tool"
                title="回到开始搜索时的位置并关闭"
                aria-label="回到原处"
                onClick={returnToOrigin}
              >
                回到原处
              </button>
              <button type="button" className="tool" title="关闭搜索（Esc）" aria-label="关闭搜索" onClick={closeSearch}>
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="tool"
              title="搜索（Ctrl/⌘+F）"
              aria-label="搜索"
              onClick={openSearch}
            >
              搜索
            </button>
          )}

          <button
            type="button"
            className="tool"
            title="缩小字号"
            aria-label="缩小字号"
            onClick={() => onPrefsChange({ fontSize: stepFontSize(prefs.fontSize, -1) })}
          >
            A-
          </button>
          <span className="tool-value">{prefs.fontSize}</span>
          <button
            type="button"
            className="tool"
            title="放大字号"
            aria-label="放大字号"
            onClick={() => onPrefsChange({ fontSize: stepFontSize(prefs.fontSize, 1) })}
          >
            A+
          </button>

          <div className="settings-wrap">
            <ReaderSettings prefs={prefs} onChange={onPrefsChange} />
          </div>
        </div>
      </header>

      <ProgressBar
        ratio={ratio}
        onSeek={(next) => {
          const container = scrollRef.current
          if (!container) return
          container.scrollTop = scrollTopForRatio(next, container.scrollHeight, container.clientHeight)
        }}
      />

      <div
        className="reader-scroll"
        ref={scrollRef}
        /* 可聚焦：这样点一下正文后 PageUp/PageDown、方向键就能翻页。
           隐藏了滚动条之后，键盘翻页是必要的替代手段 */
        tabIndex={0}
        aria-label="正文"
        onScroll={handleScroll}
        onMouseUp={handleSelection}
        onKeyUp={handleSelection}
      >
        <div
          className="reader-body"
          ref={rootRef}
          style={{
            maxWidth: MEASURE_WIDTHS[prefs.measure],
            fontSize: `${prefs.fontSize}px`,
            lineHeight: prefs.lineHeight
          }}
        >
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
