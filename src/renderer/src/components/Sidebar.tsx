import { useState } from 'react'
import type { JSX } from 'react'
import { groupDefinition, groupVocab, needsManualDefinition } from '@core/vocab'
import type { VocabGroup } from '@core/vocab'
import type { Annotation, Doc } from '@core/types'

type Filter = 'all' | 'vocab' | 'note'

interface SidebarProps {
  docs: Doc[]
  currentDocId: string | null
  /** 按当前范围（本文件 / 全部）过滤过的标注 */
  annotations: Annotation[]
  /** docId → 标题，跨文档时用来显示出处 */
  docTitles: Record<string, string>
  /** 是否在每条收藏上标出所属文档 */
  showSource: boolean
  scope: 'doc' | 'all'
  onScopeChange: (scope: 'doc' | 'all') => void
  activeAnnotationId: string | null
  onOpen: () => void
  onSelectDoc: (docId: string) => void
  onRenameDoc: (docId: string, title: string) => void
  onDeleteDoc: (doc: Doc) => void
  onJump: (annotation: Annotation) => void
  onRemove: (id: string) => void
  onSetDefinition: (annotationIds: string[], definition: string) => void
  onEditNote: (id: string, content: string) => void
  onExport: (kind: 'vocab' | 'notes') => void
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'vocab', label: '词条' },
  { key: 'note', label: '笔记' }
]

export default function Sidebar({
  docs,
  currentDocId,
  annotations,
  docTitles,
  showSource,
  scope,
  onScopeChange,
  activeAnnotationId,
  onOpen,
  onSelectDoc,
  onRenameDoc,
  onDeleteDoc,
  onJump,
  onRemove,
  onSetDefinition,
  onEditNote,
  onExport
}: SidebarProps): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
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
        <h2>文档</h2>
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
      </section>

      <section className="sidebar-section grow">
        <h2>
          标注
          <span className="counts">
            {vocabGroups.length} 词 · {notes.length} 笔记
          </span>
        </h2>

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
            disabled={docs.length === 0}
            onClick={() => onScopeChange('all')}
          >
            全部文档
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

        {isEmpty && <p className="empty">选中正文里的文字，就能收藏单词或写笔记。</p>}

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
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={item.id === activeAnnotationId ? 'occurrence active' : 'occurrence'}
                        onClick={() => onJump(item)}
                      >
                        {item.term && item.term.toLowerCase() !== group.lemma.toLowerCase() && (
                          <span className="occurrence-form">{item.term}</span>
                        )}
                        <span className="occurrence-context">{item.contextText || item.anchor.text}</span>
                        {showSource && docTitles[item.docId] && (
                          <span className="occurrence-source">{docTitles[item.docId]}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="annotation-remove"
                        title="删除"
                        onClick={() => onRemove(item.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
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
                        <strong>{note.content}</strong>
                        <em>{note.contextText || note.anchor.text}</em>
                        {showSource && docTitles[note.docId] && (
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
