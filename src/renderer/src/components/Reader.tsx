import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { resolveAnchor } from '@core/anchor'
import {
  chapterBoundarySegments,
  chapterIndexAtSegment,
  truncateTitle
} from '@core/chapters'
import type { Chapter } from '@core/chapters'
import { MEASURE_WIDTHS, progressRatio, scrollTopForRatio, stepFontSize } from '@core/prefs'
import type { ReaderPrefs } from '@core/prefs'
import { findMatches, formatMatchPosition, stepMatchIndex } from '@core/search'
import type { TextSegment } from '@core/text'
import type { Annotation, Doc } from '@core/types'
import { applyHighlight, clearHighlight, highlightSupported } from '@renderer/highlight'
import { elementAtOffset, rangeForOffsets, rangeToOffsets, segmentStarts } from '@renderer/selection'
import type { OffsetRange } from '@renderer/selection'
import ProgressBar from './ProgressBar'
import ReaderSettings from './ReaderSettings'
import SidebarToggle from './SidebarToggle'

export interface JumpTarget extends OffsetRange {
  nonce: number
  /**
   * 跳转类型。两类跳转的滚动手感和是否值得闪一下高亮都不一样：
   * 标注跳转「居中 + 平滑」并闪高亮；章节跳转「顶端对齐 + 立即」且不高亮
   * （跨几百章做平滑滚动会很难受）。
   */
  kind?: 'annotation' | 'chapter'
}

interface SelectionInfo extends OffsetRange {
  text: string
  top: number
  left: number
}

interface ReaderProps {
  doc: Doc
  /** 正文段落。由 App 统一切分后传下来，保证章节的 segStart 与渲染的 data-seg 序号同源 */
  segments: TextSegment[]
  /** 识别出的章节。为空表示这本书没有章节标记，目录与上下章整体隐藏 */
  chapters: Chapter[]
  annotations: Annotation[]
  jump: JumpTarget | null
  initialOffset: number
  onAddVocab: (range: OffsetRange, term: string) => 'added' | 'duplicate' | 'empty'
  onAddNote: (range: OffsetRange, content: string) => void
  onProgress: (offset: number) => void
  /** 当前读到第几章（-1 表示在第一章之前）。侧栏目录靠它高亮 */
  onChapterChange: (index: number) => void
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
  segments,
  chapters,
  annotations,
  jump,
  initialOffset,
  onAddVocab,
  onAddNote,
  onProgress,
  onChapterChange,
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

  const starts = useMemo(() => segmentStarts(segments), [segments])
  /** 需要画「本章完」分隔线的段序号 */
  const chapterStarts = useMemo(() => chapterBoundarySegments(chapters), [chapters])

  /** 当前读到第几章（-1 = 在第一章之前）与是否正停在本章开头 */
  const [chapterNav, setChapterNav] = useState<{ index: number; atStart: boolean }>({
    index: -1,
    atStart: true
  })
  const chapterNavRef = useRef({ index: -1, atStart: true })

  /**
   * 视口顶部那个段落的序号。阅读进度、章节显示、跳转共用同一套算法。
   * 下面几个辅助函数必须放在各个 effect 之前定义 —— 它们要进依赖数组，
   * 而 const 在定义前是不可访问的（会直接报 TDZ 错）。
   */
  const topSegmentOf = useCallback((): number => {
    const container = scrollRef.current
    const root = rootRef.current
    if (!container || !root) return 0

    const top = container.scrollTop + 8
    for (const element of root.querySelectorAll<HTMLElement>('[data-seg]')) {
      if (element.offsetTop + element.offsetHeight > top) {
        const index = Number(element.dataset.seg)
        return Number.isInteger(index) ? index : 0
      }
    }
    return 0
  }, [])

  const topOffsetOf = useCallback((): number => starts[topSegmentOf()] ?? starts[0] ?? 0, [starts, topSegmentOf])

  const scrollToOffset = useCallback(
    (offset: number): void => {
      const root = rootRef.current
      if (!root) return
      elementAtOffset(root, starts, offset)?.scrollIntoView({ block: 'start' })
    },
    [starts]
  )

  /**
   * 章节状态只在真的变了的时候才上报。
   * 不做这个守卫的话，每跨过一段就会刷新一次侧栏。
   * atStart 用来决定「上一章」能不能点：停在本章开头时才该去上一章。
   */
  const syncChapter = useCallback(
    (segmentIndex: number): void => {
      const index = chapterIndexAtSegment(chapters, segmentIndex)
      const current = index >= 0 ? chapters[index] : undefined
      const atStart = !current || segmentIndex <= current.segStart
      const previous = chapterNavRef.current

      chapterNavRef.current = { index, atStart }
      if (previous.index !== index || previous.atStart !== atStart) {
        setChapterNav({ index, atStart })
      }
      if (previous.index !== index) onChapterChange(index)
    },
    [chapters, onChapterChange]
  )

  // 打开文档时回到上次读到的位置（只在切换文档时执行一次）
  useEffect(() => {
    if (restoredDocRef.current === doc.id) return
    const root = rootRef.current
    if (!root) return
    restoredDocRef.current = doc.id
    lastReportedRef.current = initialOffset
    elementAtOffset(root, starts, initialOffset)?.scrollIntoView({ block: 'start' })
    // 正文短到不用滚时不会产生 scroll 事件，所以这里主动定位一次章节
    syncChapter(topSegmentOf())
  }, [doc.id, starts, initialOffset, syncChapter, topSegmentOf])

  /** 跳到某一章开头。超出范围时什么也不做（首尾两端就是靠这个自然停住） */
  const goToChapter = useCallback(
    (index: number): void => {
      const chapter = chapters[index]
      const root = rootRef.current
      if (!chapter || !root) return
      elementAtOffset(root, starts, chapter.start)?.scrollIntoView({ block: 'start' })
      syncChapter(chapter.segStart)
    },
    [chapters, starts, syncChapter]
  )

  /**
   * 「上一章」按阅读软件的习惯：先回到本章开头，已经在开头了才去上一章。
   * 直接跳到上一章会让人丢掉当前章读到的位置，用起来很不顺手。
   */
  const stepChapter = useCallback(
    (direction: 1 | -1): void => {
      if (chapters.length === 0) return
      const { index, atStart } = chapterNavRef.current
      if (direction === 1) goToChapter(index + 1)
      else goToChapter(index >= 0 && !atStart ? index : index - 1)
    },
    [chapters.length, goToChapter]
  )

  // 把所有标注画成高亮。位置一律走 resolveAnchor 重算，原文漂移也能找回来。
  useEffect(() => {
    const root = rootRef.current
    if (!root || !highlightSupported()) return

    const vocab: Range[] = []
    const notes: Range[] = []
    for (const annotation of annotations) {
      // 手动词没有位置，画不了高亮
      if (!annotation.anchor) continue
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

    const isChapter = jump.kind === 'chapter'
    elementAtOffset(root, starts, jump.start)?.scrollIntoView({
      // 章节跳转可能跨几百章，做平滑滚动会很难受；标注跳转距离近，居中更好看
      block: isChapter ? 'start' : 'center',
      behavior: isChapter ? 'auto' : 'smooth'
    })

    // 章节跳转是一段零长度区间，没什么可闪的
    const range = !isChapter && jump.end > jump.start ? rangeForOffsets(root, starts, jump) : null
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

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return

    setRatio(progressRatio(container.scrollTop, container.scrollHeight, container.clientHeight))

    const segmentIndex = topSegmentOf()
    syncChapter(segmentIndex)

    const offset = starts[segmentIndex] ?? 0
    if (offset !== lastReportedRef.current) {
      lastReportedRef.current = offset
      onProgress(offset)
    }
  }, [topSegmentOf, syncChapter, starts, onProgress])

  // [ 上一章 / ] 下一章。在输入框里不抢这个键
  useEffect(() => {
    if (chapters.length === 0) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key !== '[' && event.key !== ']') return
      const target = event.target as HTMLElement | null
      if (target && (/^(input|textarea)$/i.test(target.tagName) || target.isContentEditable)) return
      event.preventDefault()
      stepChapter(event.key === '[' ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chapters.length, stepChapter])

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

    // 提示只在这里发一处。
    // 以前不管结果如何都报「已加入单词本」，结果就是：
    // 重复收藏被拦下了，用户看到的仍然是「已加入单词本」—— 提示和行为不一致
    const result = onAddVocab({ start: selection.start, end: selection.end }, term)
    setSelection(null)
    clearDomSelection()
    if (result === 'added') onNotify('已加入单词本')
    else if (result === 'duplicate') onNotify('这个词在这个位置已经收过了')
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

        {chapters.length > 0 && (
          <div className="chapter-nav">
            <button
              type="button"
              className="chapter-step"
              title="上一章（[）—— 停在本章开头时会去上一章"
              aria-label="上一章"
              disabled={chapterNav.index <= 0 && chapterNav.atStart}
              onClick={() => stepChapter(-1)}
            >
              ‹
            </button>
            <div className="chapter-info">
              <span className="chapter-name" title={chapterNav.index >= 0 ? chapters[chapterNav.index].title : ''}>
                {chapterNav.index >= 0 ? truncateTitle(chapters[chapterNav.index].title) : '卷首'}
              </span>
              <span className="chapter-pos">
                {chapterNav.index >= 0 ? `${chapterNav.index + 1} / ${chapters.length}` : `共 ${chapters.length} 章`}
              </span>
            </div>
            <button
              type="button"
              className="chapter-step"
              title="下一章（]）"
              aria-label="下一章"
              disabled={chapterNav.index >= chapters.length - 1}
              onClick={() => stepChapter(1)}
            >
              ›
            </button>
          </div>
        )}

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
            <Fragment key={index}>
              {/*
                章尾分隔线。必须是 <p data-seg> 的**兄弟节点**，绝不能嵌在段落里面：
                selection.ts 的 textNodeOf() 取 segEl.firstChild 并要求它是文本节点，
                一旦段落里多了个元素，那个段落的所有高亮与跳转会静默失效。
                user-select: none 是防止选区端点落在它上面被整个丢弃。
              */}
              {index > 0 && chapterStarts.has(index) && (
                <div className="chapter-divider" aria-hidden="true">
                  本章完
                </div>
              )}
              <p className="paragraph" data-seg={index}>
                {segment.text}
              </p>
            </Fragment>
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
