import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { chapterLength, truncateTitle } from '@core/chapters'
import type { Chapter } from '@core/chapters'
import { annotationText, isManual } from '@core/store'
import { groupDefinition, groupVocab, needsManualDefinition } from '@core/vocab'
import type { VocabGroup } from '@core/vocab'
import type { Annotation, Doc } from '@core/types'

type Filter = 'all' | 'vocab' | 'note'
/** 书库区看的是文档列表还是当前文档的目录 */
type NavView = 'docs' | 'toc'

interface SidebarProps {
  docs: Doc[]
  currentDocId: string | null
  /** 当前文档识别出的章节。为空表示这本书没有章节标记 */
  chapters: Chapter[]
  /** 当前读到第几章（-1 = 在第一章之前） */
  chapterIndex: number
  /** 按当前范围（本文件 / 全部）过滤过的标注 */
  annotations: Annotation[]
  /** docId → 标题，跨文档时用来显示出处 */
  docTitles: Record<string, string>
  /** 是否在每条收藏上标出所属文档 */
  showSource: boolean
  scope: 'doc' | 'all'
  onScopeChange: (scope: 'doc' | 'all') => void
  /** 手动记词的输入条是否展开（由 App 控制，欢迎页也能把它打开） */
  addingWord: boolean
  onToggleAddWord: () => void
  /** 返回结果：App 负责弹提示，侧栏据此决定要不要清空输入 */
  onAddWord: (term: string) => 'added' | 'duplicate' | 'empty'
  activeAnnotationId: string | null
  onOpen: () => void
  onSelectDoc: (docId: string) => void
  onRenameDoc: (docId: string, title: string) => void
  onDeleteDoc: (doc: Doc) => void
  onJump: (annotation: Annotation) => void
  onJumpChapter: (index: number) => void
  onRemove: (id: string) => void
  onSetDefinition: (annotationIds: string[], definition: string) => void
  onEditNote: (id: string, content: string) => void
  onExport: (kind: 'vocab' | 'notes') => void
}

const FILTERS: { key: Filter; label: string }[] = [
  // 叫「不限」而不是「全部」：范围那一行已经有一个「全部」了（本文件 / 全部），
  // 同一个面板里出现两个「全部」会分不清哪个是筛来源、哪个是筛类型
  { key: 'all', label: '不限' },
  { key: 'vocab', label: '词条' },
  { key: 'note', label: '笔记' }
]

export default function Sidebar({
  docs,
  currentDocId,
  chapters,
  chapterIndex,
  annotations,
  docTitles,
  showSource,
  scope,
  onScopeChange,
  addingWord,
  onToggleAddWord,
  onAddWord,
  activeAnnotationId,
  onOpen,
  onSelectDoc,
  onRenameDoc,
  onDeleteDoc,
  onJump,
  onJumpChapter,
  onRemove,
  onSetDefinition,
  onEditNote,
  onExport
}: SidebarProps): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [navView, setNavView] = useState<NavView>('docs')
  const activeChapterRef = useRef<HTMLButtonElement>(null)
  /** 手动记词的草稿。回车存下后清空并把焦点留在输入框，方便连着记 */
  const [wordDraft, setWordDraft] = useState('')
  const wordInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addingWord) wordInputRef.current?.focus()
  }, [addingWord])

  const submitWord = (): void => {
    if (onAddWord(wordDraft) !== 'empty') setWordDraft('')
    // 连续记录：焦点留在输入框，全程不用碰鼠标
    wordInputRef.current?.focus()
  }
  /** 正在补释义的分组 key */
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** 正在重命名的文档 id */
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null)
  /** 正在编辑的笔记 id 与草稿 */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const vocabGroups = groupVocab(annotations)
  const notes = annotations.filter((item) => item.type === 'note')

  // 切到没有章节的书时自动退回文档列表，不然目录区会是一片空白
  const showToc = navView === 'toc' && chapters.length > 0

  // 目录跟着阅读位置滚，不用自己找读到哪儿了
  useEffect(() => {
    if (!showToc) return
    activeChapterRef.current?.scrollIntoView({ block: 'nearest' })
  }, [showToc, chapterIndex])

  const showVocab = filter !== 'note'
  const showNotes = filter !== 'vocab'
  const isEmpty = (!showVocab || vocabGroups.length === 0) && (!showNotes || notes.length === 0)

  const startEditing = (group: VocabGroup): void => {
    setEditingKey(group.key)
    setDraft(group.manualDefinition)
  }

  const submitDefinition = (group: VocabGroup): void => {
    onSetDefinition(
      group.items.map((item) => item.id),
      draft
    )
    setEditingKey(null)
    setDraft('')
  }

  /**
   * 提交重命名。拿 renamingDocId 本身当幂等锁：
   * 回车提交后 input 卸载会再触发一次 blur，不能提交两次
   */
  const commitRename = (docId: string, title: string): void => {
    if (renamingDocId !== docId) return
    setRenamingDocId(null)
    onRenameDoc(docId, title)
  }

  const startEditingNote = (note: Annotation): void => {
    setEditingNoteId(note.id)
    setNoteDraft(note.content ?? '')
  }

  const submitNote = (id: string): void => {
    if (editingNoteId !== id) return
    setEditingNoteId(null)
    onEditNote(id, noteDraft)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="logo">InkPick</span>
        <div className="sidebar-actions">
          <button type="button" onClick={onOpen}>
            打开 TXT
          </button>
        </div>
      </div>

      <section className="sidebar-section">
        <h2>
          {showToc ? '目录' : '文档'}
          <span className="counts">
            {showToc
              ? `${chapters.length} 章`
              : docs.length > 0
                ? `${docs.length} 本`
                : ''}
          </span>
        </h2>

        <div className="filter-tabs">
          <button
            type="button"
            className={showToc ? 'tab' : 'tab active'}
            onClick={() => setNavView('docs')}
          >
            文档
          </button>
          <button
            type="button"
            className={showToc ? 'tab active' : 'tab'}
            disabled={chapters.length === 0}
            title={chapters.length === 0 ? '这本书里没有识别到章节标题' : '跳到某一章'}
            onClick={() => setNavView('toc')}
          >
            目录
          </button>
        </div>

        {showToc ? (
          <ul className="chapter-list">
            {chapters.map((chapter) => (
              <li key={chapter.start}>
                <button
                  type="button"
                  ref={chapter.index === chapterIndex ? activeChapterRef : undefined}
                  className={chapter.index === chapterIndex ? 'chapter-item active' : 'chapter-item'}
                  title={chapter.title}
                  onClick={() => onJumpChapter(chapter.index)}
                >
                  <span className="chapter-item-title">{truncateTitle(chapter.title, 40)}</span>
                  <span className="chapter-item-meta">
                    {chapterLength(chapter).toLocaleString()} 字符
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {docs.length === 0 && <p className="empty">还没有文档，点「打开 TXT」选一个文本文件。</p>}
            <ul className="doc-list">
              {docs.map((doc) => (
                <li key={doc.id}>
                  {renamingDocId === doc.id ? (
                    <input
                      className="doc-rename"
                      autoFocus
                      defaultValue={doc.title}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(doc.id, event.currentTarget.value)
                        if (event.key === 'Escape') setRenamingDocId(null)
                      }}
                      onBlur={(event) => commitRename(doc.id, event.currentTarget.value)}
                    />
                  ) : (
                    <div className="doc-row">
                      <button
                        type="button"
                        className={doc.id === currentDocId ? 'doc-item active' : 'doc-item'}
                        onClick={() => onSelectDoc(doc.id)}
                      >
                        <span className="doc-title">{doc.title}</span>
                        <span className="doc-meta">{doc.content.length.toLocaleString()} 字符</span>
                      </button>
                      <div className="doc-actions">
                        <button
                          type="button"
                          title="重命名"
                          aria-label={`重命名 ${doc.title}`}
                          onClick={() => setRenamingDocId(doc.id)}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          title="删除文档"
                          aria-label={`删除 ${doc.title}`}
                          onClick={() => onDeleteDoc(doc)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="sidebar-section grow">
        <h2>
          标注
          <span className="h2-right">
            <span className="counts">
              {vocabGroups.length} 词 · {notes.length} 笔记
            </span>
            <button
              type="button"
              className={addingWord ? 'add-word-toggle active' : 'add-word-toggle'}
              title="手动记一个词 —— 不在书里也行，比如看视频或读论文时遇到的词"
              aria-label="手动添加单词"
              aria-expanded={addingWord}
              onClick={onToggleAddWord}
            >
              {addingWord ? '收起' : '＋ 单词'}
            </button>
          </span>
        </h2>

        {addingWord && (
          <div className="add-word-row">
            <input
              ref={wordInputRef}
              className="add-word-input"
              placeholder="输入单词，回车保存（可连着记多个）"
              aria-label="要记的单词"
              value={wordDraft}
              onChange={(event) => setWordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setWordDraft('')
                  onToggleAddWord()
                }
                if (event.key === 'Enter') submitWord()
              }}
            />
            <button type="button" onClick={submitWord} disabled={!wordDraft.trim()}>
              保存
            </button>
          </div>
        )}

        <div className="filter-tabs">
          <button
            type="button"
            className={scope === 'doc' ? 'tab active' : 'tab'}
            disabled={!currentDocId}
            onClick={() => onScopeChange('doc')}
          >
            本文件
          </button>
          <button
            type="button"
            className={scope === 'all' ? 'tab active' : 'tab'}
            title="所有书里的词，加上你手动记的词"
            onClick={() => onScopeChange('all')}
          >
            全部
          </button>

          <span className="tabs-spacer" />

          <button
            type="button"
            className="tab export"
            title="导出为 Anki 用的 CSV（一个词一行）"
            disabled={annotations.length === 0}
            onClick={() => onExport('vocab')}
          >
            导出 CSV
          </button>
          <button
            type="button"
            className="tab export"
            title="导出为 Markdown（词表 + 笔记）"
            disabled={annotations.length === 0}
            onClick={() => onExport('notes')}
          >
            导出 MD
          </button>
        </div>

        <div className="filter-tabs">
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={filter === item.key ? 'tab active' : 'tab'}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {isEmpty && (
          <p className="empty">
            选中正文里的文字就能收藏单词或笔记；也可以点右上角「＋ 单词」手动记一个，不导入书也能用。
          </p>
        )}

        <ul className="annotation-list">
          {showVocab &&
            vocabGroups.map((group) => (
              <li
                key={group.key}
                className={
                  group.items.some((item) => item.id === activeAnnotationId) ? 'vocab-group active' : 'vocab-group'
                }
              >
                <div className="vocab-head">
                  <strong>{group.lemma}</strong>
                  {group.phonetic && <span className="phonetic">/{group.phonetic}/</span>}
                  {group.items.length > 1 && <span className="times">×{group.items.length}</span>}
                  <button
                    type="button"
                    className="define-button"
                    title={group.senses.length > 0 ? '改写释义' : '补一句释义'}
                    onClick={() => (editingKey === group.key ? setEditingKey(null) : startEditing(group))}
                  >
                    {group.senses.length > 0 ? '✎' : '＋'}
                  </button>
                </div>

                {editingKey === group.key ? (
                  <div className="define-editor">
                    <input
                      autoFocus
                      value={draft}
                      placeholder="一句话释义"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingKey(null)
                        if (event.key === 'Enter') submitDefinition(group)
                      }}
                    />
                    <button type="button" onClick={() => submitDefinition(group)}>
                      保存
                    </button>
                  </div>
                ) : (
                  <p className="vocab-definition">
                    {groupDefinition(group) || <span className="missing">词典未收录</span>}
                  </p>
                )}

                {needsManualDefinition(group) && editingKey !== group.key && (
                  <p className="missing-hint">词典里没有这个词，可以补一句自己的理解。</p>
                )}

                <ul className="occurrence-list">
                  {group.items.map((item) => {
                    const content = (
                      <>
                        {item.term && item.term.toLowerCase() !== group.lemma.toLowerCase() && (
                          <span className="occurrence-form">{item.term}</span>
                        )}
                        {isManual(item) && <span className="badge manual">手动</span>}
                        {annotationText(item) && (
                          <span className="occurrence-context">{annotationText(item)}</span>
                        )}
                        {showSource && item.docId && docTitles[item.docId] && (
                          <span className="occurrence-source">{docTitles[item.docId]}</span>
                        )}
                      </>
                    )

                    return (
                      <li key={item.id}>
                        {/*
                          手动记的词没有原文位置，点了没地方可跳。
                          所以这里渲染成 div 而不是 button —— 一个点了没反应的按钮
                          比一个不能点的行更让人困惑。
                        */}
                        {isManual(item) ? (
                          <div className="occurrence occurrence-static">{content}</div>
                        ) : (
                          <button
                            type="button"
                            className={item.id === activeAnnotationId ? 'occurrence active' : 'occurrence'}
                            onClick={() => onJump(item)}
                          >
                            {content}
                          </button>
                        )}
                        <button
                          type="button"
                          className="annotation-remove"
                          title="删除"
                          onClick={() => onRemove(item.id)}
                        >
                          ×
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}

          {showNotes &&
            notes.map((note) => (
              <li key={note.id} className={note.id === activeAnnotationId ? 'annotation active' : 'annotation'}>
                {editingNoteId === note.id ? (
                  <div className="note-editor">
                    <textarea
                      autoFocus
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingNoteId(null)
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submitNote(note.id)
                      }}
                    />
                    <div className="note-editor-actions">
                      <button type="button" className="ghost" onClick={() => setEditingNoteId(null)}>
                        取消
                      </button>
                      <button type="button" onClick={() => submitNote(note.id)} disabled={!noteDraft.trim()}>
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" className="annotation-main" onClick={() => onJump(note)}>
                      <span className="badge note">记</span>
                      <span className="annotation-text">
                        {/* 先原文（笔记钉在哪句话上），再自己写的内容。
                            列表里靠原文句子认出「这条记在哪儿」比靠自己写的那句更快 */}
                        <em>{annotationText(note)}</em>
                        <strong>{note.content}</strong>
                        {showSource && note.docId && docTitles[note.docId] && (
                          <span className="occurrence-source">{docTitles[note.docId]}</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="annotation-edit"
                      title="编辑笔记"
                      aria-label="编辑笔记"
                      onClick={() => startEditingNote(note)}
                    >
                      ✎
                    </button>
                    <button type="button" className="annotation-remove" title="删除" onClick={() => onRemove(note.id)}>
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
        </ul>
      </section>
    </aside>
  )
}
