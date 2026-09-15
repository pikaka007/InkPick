import type { JSX } from 'react'
import {
  FONT_SIZES,
  LINE_HEIGHTS,
  MEASURE_LABELS,
  MEASURES,
  THEME_LABELS,
  THEMES,
  lineHeightLabel
} from '@core/prefs'
import type { ReaderPrefs } from '@core/prefs'

interface ReaderSettingsProps {
  prefs: ReaderPrefs
  onChange: (patch: Partial<ReaderPrefs>) => void
}

/**
 * 阅读设置面板。
 *
 * 用原生 select 而不是自绘下拉：跨平台行为一致、键盘可用、屏幕阅读器能读，
 * 也不用自己实现「点外面关闭 / Esc 关闭 / 方向键选择」。样式上确实朴素，
 * 但这几个设置一辈子改不了几次，值不值得为好看自己造一个轮子是另一回事 —— 不值。
 */
export default function ReaderSettings({ prefs, onChange }: ReaderSettingsProps): JSX.Element {
  return (
    <div className="settings-panel" role="dialog" aria-label="阅读设置">
      <label className="setting-row">
        <span>字号</span>
        <select
          aria-label="字号"
          value={String(prefs.fontSize)}
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>
      </label>

      <label className="setting-row">
        <span>行距</span>
        <select
          aria-label="行距"
          value={String(prefs.lineHeight)}
          onChange={(event) => onChange({ lineHeight: Number(event.target.value) })}
        >
          {LINE_HEIGHTS.map((height) => (
            <option key={height} value={height}>
              {lineHeightLabel(height)}（{height}）
            </option>
          ))}
        </select>
      </label>

      <label className="setting-row">
        <span>行宽</span>
        <select
          aria-label="行宽"
          value={prefs.measure}
          onChange={(event) => onChange({ measure: event.target.value as ReaderPrefs['measure'] })}
        >
          {MEASURES.map((measure) => (
            <option key={measure} value={measure}>
              {MEASURE_LABELS[measure]}
            </option>
          ))}
        </select>
      </label>

      <label className="setting-row">
        <span>主题</span>
        <select
          aria-label="主题"
          value={prefs.theme}
          onChange={(event) => onChange({ theme: event.target.value as ReaderPrefs['theme'] })}
        >
          {THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {THEME_LABELS[theme]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
