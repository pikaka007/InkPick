import { useState } from 'react'
import type { JSX } from 'react'
import type { Annotation, Doc } from '@core/types'

type Filter = 'all' | 'vocab' | 'note'

interface SidebarProps {
  docs: Doc[]
  currentDocId: string | null
  annotations: Annotation[]
  activeAnnotationId: string | null
  onOpen: () => void
  onLoadSample: () => void
  onSelectDoc: (docId: string) => void
  onJump: (annotation: Annotation) => void
  onRemove: (id: string) => void
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
  activeAnnotationId,
  onOpen,
  onLoadSample,
  onSelectDoc,
  onJump,
  onRemove
}: SidebarProps): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')

  const visible = annotations.filter((a) => filter === 'all' || a.type === filter)
  const vocabCount = annotations.filter((a) => a.type === 'vocab').length
  const noteCount = annotations.length - vocabCount

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="logo">InkPick</span>
        <div className="sidebar-actions">
          <button type="button" onClick={onOpen}>
            打开 TXT
          </button>
          <button type="button" className="ghost" onClick={onLoadSample}>
            示例
          </button>
        </div>
      </div>

      <section className="sidebar-section">
        <h2>文档</h2>
        {docs.length === 0 && <p className="empty">还没有文档，点「打开 TXT」或「示例」。</p>}
        <ul className="doc-list">
          {docs.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                className={doc.id === currentDocId ? 'doc-item active' : 'doc-item'}
                onClick={() => onSelectDoc(doc.id)}
              >
                <span className="doc-title">{doc.title}</span>
                <span className="doc-meta">{doc.content.length.toLocaleString()} 字符</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="sidebar-section grow">
        <h2>
          标注
          <span className="counts">
            {vocabCount} 词 · {noteCount} 笔记
          </span>
        </h2>

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

        {visible.length === 0 && <p className="empty">选中正文里的文字，就能收藏单词或写笔记。</p>}

        <ul className="annotation-list">
          {visible.map((annotation) => (
            <li
              key={annotation.id}
              className={annotation.id === activeAnnotationId ? 'annotation active' : 'annotation'}
            >
              <button type="button" className="annotation-main" onClick={() => onJump(annotation)}>
                <span className={`badge ${annotation.type}`}>{annotation.type === 'vocab' ? '词' : '记'}</span>
                <span className="annotation-text">
                  <strong>{annotation.type === 'vocab' ? (annotation.term ?? annotation.anchor.text) : annotation.content}</strong>
                  <em>{annotation.contextText || annotation.anchor.text}</em>
                </span>
              </button>
              <button
                type="button"
                className="annotation-remove"
                title="删除"
                onClick={() => onRemove(annotation.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
