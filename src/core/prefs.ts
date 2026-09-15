/**
 * 阅读偏好 —— 纯逻辑，可单测。UI 只负责把它画出来。
 *
 * 为什么把「档位」写在这里而不是散在组件里：
 * 1. 加一档字号、换一个主题色，只改这一个文件
 * 2. 循环切换、边界夹取的逻辑可以单测，不用靠点界面验证
 */
import { clamp } from './text'

export type Theme = 'light' | 'sepia' | 'dark'
export type Measure = 'narrow' | 'medium' | 'wide'

export interface ReaderPrefs {
  /** 正文字号，px */
  fontSize: number
  /** 行高倍数 */
  lineHeight: number
  /** 行宽档位 */
  measure: Measure
  theme: Theme
  /** 侧栏宽度，px */
  sidebarWidth: number
  /** 侧栏是否收起来 */
  sidebarCollapsed: boolean
}

/* ---------- 档位 ---------- */

export const FONT_SIZES = [15, 17, 19, 21, 24] as const
export const LINE_HEIGHTS = [1.6, 1.85, 2.1] as const
export const MEASURES: readonly Measure[] = ['narrow', 'medium', 'wide']
export const THEMES: readonly Theme[] = ['light', 'sepia', 'dark']

/** 行宽用 em：字号变大时行宽跟着变，保证每行字数大致不变 */
export const MEASURE_WIDTHS: Record<Measure, string> = {
  narrow: '32em',
  medium: '42em',
  wide: '54em'
}

export const MEASURE_LABELS: Record<Measure, string> = { narrow: '窄', medium: '中', wide: '宽' }
export const THEME_LABELS: Record<Theme, string> = { light: '浅色', sepia: '护眼', dark: '深色' }

/** 行高用名字而不是 1.85 这种数字，下拉框里更好认 */
export const LINE_HEIGHT_LABELS: Record<string, string> = {
  '1.6': '紧凑',
  '1.85': '标准',
  '2.1': '宽松'
}

export function lineHeightLabel(value: number): string {
  return LINE_HEIGHT_LABELS[String(value)] ?? String(value)
}

/* ---------- 侧栏 ---------- */

/** 再窄就放不下文档标题和引用原文了 */
export const SIDEBAR_MIN_WIDTH = 200
/** 再宽就抢正文的地方了 */
export const SIDEBAR_MAX_WIDTH = 520
export const DEFAULT_SIDEBAR_WIDTH = 320

export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 19,
  lineHeight: 1.85,
  measure: 'medium',
  theme: 'light',
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarCollapsed: false
}

/* ---------- 操作 ---------- */

/** 在档位表里循环取下一个 */
export function nextInCycle<T>(options: readonly T[], current: T): T {
  const at = options.indexOf(current)
  if (at === -1) return options[0]
  return options[(at + 1) % options.length]
}

/** 字号加减。到边界就停在边界，不做循环 —— 一直点 A+ 转回最小字体会很困惑 */
export function stepFontSize(current: number, direction: 1 | -1): number {
  const nearest = FONT_SIZES.indexOf(nearestFontSize(current) as (typeof FONT_SIZES)[number])
  const next = clamp(nearest + direction, 0, FONT_SIZES.length - 1)
  return FONT_SIZES[next]
}

/** 把任意数值吸附到最近的合法档位（兼容手改过的旧数据） */
export function nearestFontSize(value: number): number {
  // 显式标 number：FONT_SIZES 是 as const，不标会被推成字面量类型 15
  let best: number = FONT_SIZES[0]
  for (const size of FONT_SIZES) {
    if (Math.abs(size - value) < Math.abs(best - value)) best = size
  }
  return best
}

export function nearestLineHeight(value: number): number {
  let best: number = LINE_HEIGHTS[0]
  for (const height of LINE_HEIGHTS) {
    if (Math.abs(height - value) < Math.abs(best - value)) best = height
  }
  return best
}

/** 把宽度夹到合法范围。非法值（NaN / 负 / 巨大）退到默认宽度 */
export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH
  return Math.round(clamp(value, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))
}

/** 把可能来自旧数据 / 手改文件的值收敛到合法范围 */
export function normalizePrefs(input: Partial<ReaderPrefs> | undefined): ReaderPrefs {
  const prefs = input ?? {}
  return {
    fontSize: nearestFontSize(typeof prefs.fontSize === 'number' ? prefs.fontSize : DEFAULT_PREFS.fontSize),
    lineHeight: nearestLineHeight(typeof prefs.lineHeight === 'number' ? prefs.lineHeight : DEFAULT_PREFS.lineHeight),
    measure: MEASURES.includes(prefs.measure as Measure) ? (prefs.measure as Measure) : DEFAULT_PREFS.measure,
    theme: THEMES.includes(prefs.theme as Theme) ? (prefs.theme as Theme) : DEFAULT_PREFS.theme,
    sidebarWidth: clampSidebarWidth(
      typeof prefs.sidebarWidth === 'number' ? prefs.sidebarWidth : DEFAULT_PREFS.sidebarWidth
    ),
    sidebarCollapsed: prefs.sidebarCollapsed === true
  }
}

/* ---------- 阅读进度 ---------- */

/** 滚动位置 → 0~1。内容不足一屏时返回 0，避免 0/0 产生 NaN */
export function progressRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const scrollable = scrollHeight - clientHeight
  if (scrollable <= 0) return 0
  return clamp(scrollTop / scrollable, 0, 1)
}

/** 0~1 → 该滚到哪儿。与 progressRatio 互为反函数 */
export function scrollTopForRatio(ratio: number, scrollHeight: number, clientHeight: number): number {
  const scrollable = Math.max(0, scrollHeight - clientHeight)
  return clamp(ratio, 0, 1) * scrollable
}

export function formatPercent(ratio: number): string {
  return `${Math.round(clamp(ratio, 0, 1) * 100)}%`
}
