import type { JSX } from 'react'
import {
  LINE_HEIGHTS,
  LINE_HEIGHT_SHORT,
  MEASURE_LABELS,
  MEASURE_SHORT,
  MEASURES,
  THEME_LABELS,
  THEME_SHORT,
  THEMES,
  lineHeightLabel
} from '@core/prefs'
import type { ReaderPrefs } from '@core/prefs'

interface ReaderSettingsProps {
  prefs: ReaderPrefs
  onChange: (patch: Partial<ReaderPrefs>) => void
}

/**
 * 阅读设置：一行里的三组开关（行距 / 行宽 / 主题）。
 *
 * 这里是**每个选项一个按钮**，不是「点一下换一个值」，也不是下拉框 ——
 * 前者要点很多次还记不住下一档是什么，后者要点两下（先展开再选）。
 * 阅读设置就是拿来反复试到手感对的，一次点击到位最要紧。
 *
 * 字号在工具栏上是 A- / A+，因为它需要微调，不需要穷举。
 */
export default function ReaderSettings({ prefs, onChange }: ReaderSettingsProps): JSX.Element {
  return (
    <>
      <div className="seg" role="group" aria-label="行距">
        {LINE_HEIGHTS.map((height) => (
          <button
            key={height}
            type="button"
            className={prefs.lineHeight === height ? 'seg-item active' : 'seg-item'}
            title={`行距 ${lineHeightLabel(height)}（${height}）`}
            aria-label={`行距 ${lineHeightLabel(height)}`}
            aria-pressed={prefs.lineHeight === height}
            onClick={() => onChange({ lineHeight: height })}
          >
            {LINE_HEIGHT_SHORT[String(height)]}
          </button>
        ))}
      </div>

      <div className="seg" role="group" aria-label="行宽">
        {MEASURES.map((measure) => (
          <button
            key={measure}
            type="button"
            className={prefs.measure === measure ? 'seg-item active' : 'seg-item'}
            title={`行宽 ${MEASURE_LABELS[measure]}`}
            aria-label={`行宽 ${MEASURE_LABELS[measure]}`}
            aria-pressed={prefs.measure === measure}
            onClick={() => onChange({ measure })}
          >
            {MEASURE_SHORT[measure]}
          </button>
        ))}
      </div>

      <div className="seg" role="group" aria-label="主题">
        {THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            className={prefs.theme === theme ? 'seg-item active' : 'seg-item'}
            title={`主题 ${THEME_LABELS[theme]}`}
            aria-label={`主题 ${THEME_LABELS[theme]}`}
            aria-pressed={prefs.theme === theme}
            onClick={() => onChange({ theme })}
          >
            {THEME_SHORT[theme]}
          </button>
        ))}
      </div>
    </>
  )
}
