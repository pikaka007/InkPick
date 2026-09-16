import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { describeNextDue } from '@core/review'
import type { ReviewGrade } from '@core/review'
import { annotationText, isManual } from '@core/store'
import type { ReviewState } from '@core/types'
import { groupDefinition } from '@core/vocab'
import type { VocabGroup } from '@core/vocab'

interface ReviewPanelProps {
  /** 这次要复习的词（分组的 key），顺序就是该复习的顺序 */
  queue: string[]
  /** key → 分组。查不到的会被跳过（词被删了） */
  groups: Map<string, VocabGroup>
  /** 接下来 24 小时内还会到期多少 —— 过完了给一句交代 */
  dueSoon: number
  /** 评一次分。返回新的复习状态，用来给一句「下次什么时候见」的反馈 */
  onGrade: (key: string, grade: ReviewGrade) => ReviewState
  /** 去看这个词在原文里的位置（会收起面板） */
  onJumpToSource: (annotationId: string) => void
  onClose: () => void
}

const GRADES: { grade: ReviewGrade; label: string; hint: string; className: string }[] = [
  { grade: 'forgot', label: '忘了', hint: '间隔归零，过几分钟再来', className: 'grade forgot' },
  { grade: 'fuzzy', label: '模糊', hint: '想起来了，但不熟', className: 'grade fuzzy' },
  { grade: 'remembered', label: '记得', hint: '完全想起来了', className: 'grade remembered' }
]

/**
 * 复习面板：一次一个词。
 *
 * 为什么不做成「在列表里给每条打个分」：那样释义就在眼前，
 * 等于只是「标记一下」，没有回忆动作。**先自己回想、再翻看答案**才是间隔重复起作用的地方，
 * 所以释义默认遮住，得先点「显示释义」，评分按钮在那之前是禁用的。
 */
export default function ReviewPanel({
  queue,
  groups,
  dueSoon,
  onGrade,
  onJumpToSource,
  onClose
}: ReviewPanelProps): JSX.Element {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [lastResult, setLastResult] = useState<{ label: string; interval: string } | null>(null)

  const key = queue[index]
  const group = key ? groups.get(key) : undefined
  const finished = index >= queue.length

  // 当前这个词没了（被删了）就往后跳，不要卡在原地
  useEffect(() => {
    if (group || finished) return
    setIndex((current) => current + 1)
    setRevealed(false)
  }, [group, finished])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      // 空格翻面；评分只认 1/2/3，不用鼠标也能过一轮
      if (event.key === ' ' && group) {
        event.preventDefault()
        setRevealed(true)
      }
      if (revealed && (event.key === '1' || event.key === '2' || event.key === '3')) {
        event.preventDefault()
        submit(['forgot', 'fuzzy', 'remembered'][Number(event.key) - 1] as ReviewGrade)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const submit = useCallback(
    (grade: ReviewGrade): void => {
      if (!key) return
      const state = onGrade(key, grade)
      const label = GRADES.find((item) => item.grade === grade)?.label ?? ''
      setLastResult({ label, interval: describeNextDue(state, Date.now()) })
      setRevealed(false)
      setIndex((current) => current + 1)
    },
    [key, onGrade]
  )

  const done = finished || !group

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="review-panel" onClick={(event) => event.stopPropagation()}>
        <div className="review-head">
          <span className="review-progress">
            {done ? `${queue.length} / ${queue.length}` : `${index + 1} / ${queue.length}`}
          </span>
          <button type="button" className="review-close" title="结束复习（Esc）" aria-label="结束复习" onClick={onClose}>
            ✕
          </button>
        </div>

        {done ? (
          <div className="review-done">
            <p className="review-done-title">今天要复习的都过完了</p>
            <p className="review-done-hint">
              {queue.length > 0 ? `这一轮过了 ${queue.length} 个词。` : '这会儿没有到期的词。'}
              {dueSoon > 0
                ? `接下来 24 小时还会有 ${dueSoon} 个到期。`
                : '隔一段时间再回来，到期会自动出现。'}
            </p>
          </div>
        ) : (
          <>
            <div className="review-card">
              <p className="review-word">{group.lemma}</p>
              {group.phonetic && <p className="review-phonetic">/{group.phonetic}/</p>}

              {revealed ? (
                <>
                  <p className="review-definition">{groupDefinition(group) || '（还没有释义）'}</p>
                  <Contexts group={group} onJumpToSource={onJumpToSource} />
                </>
              ) : (
                <button
                  type="button"
                  className="review-reveal"
                  title="想一想再点（空格）"
                  onClick={() => setRevealed(true)}
                >
                  显示释义
                </button>
              )}
            </div>

            <div className="review-grades">
              {GRADES.map((item) => (
                <button
                  type="button"
                  key={item.grade}
                  className={item.className}
                  title={revealed ? item.hint : '先点「显示释义」'}
                  disabled={!revealed}
                  onClick={() => submit(item.grade)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p className="review-feedback">
              {revealed
                ? '想起来了就打「记得」，完全没印象就打「忘了」。'
                : lastResult
                  ? `${lastResult.label} · ${lastResult.interval}`
                  : '先回想这个词的意思，再显示释义。'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/** 这个词是在哪些句子里遇到的 —— 这是别的背单词软件给不了的东西 */
function Contexts({
  group,
  onJumpToSource
}: {
  group: VocabGroup
  onJumpToSource: (annotationId: string) => void
}): JSX.Element | null {
  const items = group.items.filter((item) => !isManual(item) && annotationText(item)).slice(0, 2)
  if (items.length === 0) return <p className="review-context-manual">手动记的词，没有原句</p>

  return (
    <ul className="review-contexts">
      {items.map((item) => (
        <li key={item.id}>
          {/* 点了去看原文会收起面板；没评完的词下次打开还在（队列按到期状态重建） */}
          <button
            type="button"
            className="review-context"
            title="去看这句话在原文里的位置"
            onClick={() => onJumpToSource(item.id)}
          >
            {annotationText(item)}
          </button>
        </li>
      ))}
    </ul>
  )
}
