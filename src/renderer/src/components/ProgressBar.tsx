import { useRef, useState } from 'react'
import type { JSX } from 'react'
import { formatPercent } from '@core/prefs'
import { clamp } from '@core/text'

interface ProgressBarProps {
  /** 0~1 */
  ratio: number
  onSeek: (ratio: number) => void
}

/**
 * 阅读进度条。点或拖都能跳。
 *
 * TXT 没有章节结构，做不了真正的目录；一条可拖的进度条就是它的替代品：
 * 「读到哪了、怎么快速去别处」这两件事它都能回答。
 */
export default function ProgressBar({ ratio, onSeek }: ProgressBarProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const ratioFromClientX = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return clamp((clientX - rect.left) / rect.width, 0, 1)
  }

  return (
    <div className="progress">
      <div
        className={dragging ? 'progress-track dragging' : 'progress-track'}
        ref={trackRef}
        role="slider"
        aria-label="阅读进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
          onSeek(ratioFromClientX(event.clientX))
        }}
        onPointerMove={(event) => {
          if (dragging) onSeek(ratioFromClientX(event.clientX))
        }}
        onPointerUp={(event) => {
          setDragging(false)
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="progress-fill" style={{ width: `${ratio * 100}%` }} />
        <div className="progress-knob" style={{ left: `${ratio * 100}%` }} />
      </div>
      <span className="progress-value">{formatPercent(ratio)}</span>
    </div>
  )
}
