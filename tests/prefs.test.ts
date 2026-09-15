import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  FONT_SIZES,
  LINE_HEIGHTS,
  MEASURES,
  THEMES,
  formatPercent,
  nearestFontSize,
  nearestLineHeight,
  nextInCycle,
  normalizePrefs,
  progressRatio,
  scrollTopForRatio,
  stepFontSize
} from '@core/prefs'

describe('nextInCycle', () => {
  it('逐个循环', () => {
    expect(nextInCycle(THEMES, 'light')).toBe('sepia')
    expect(nextInCycle(THEMES, 'sepia')).toBe('dark')
    expect(nextInCycle(THEMES, 'dark')).toBe('light')
  })

  it('当前值不在表里时回到第一个，而不是崩', () => {
    expect(nextInCycle(THEMES, 'neon' as never)).toBe('light')
  })

  it('行宽同理', () => {
    expect(nextInCycle(MEASURES, 'narrow')).toBe('medium')
    expect(nextInCycle(MEASURES, 'wide')).toBe('narrow')
  })
})

describe('stepFontSize', () => {
  it('逐级加减', () => {
    expect(stepFontSize(19, 1)).toBe(21)
    expect(stepFontSize(19, -1)).toBe(17)
  })

  it('到边界就停住，不循环', () => {
    // 一直点 A+ 转回最小字体会让人困惑
    expect(stepFontSize(FONT_SIZES[FONT_SIZES.length - 1], 1)).toBe(FONT_SIZES[FONT_SIZES.length - 1])
    expect(stepFontSize(FONT_SIZES[0], -1)).toBe(FONT_SIZES[0])
  })

  it('传入非档位数值时先吸附再走一步', () => {
    expect(stepFontSize(19.4, 1)).toBe(21)
    expect(stepFontSize(100, -1)).toBe(21)
  })
})

describe('nearestFontSize / nearestLineHeight', () => {
  it('吸附到最近的档位', () => {
    expect(nearestFontSize(18)).toBe(17)
    expect(nearestFontSize(20)).toBe(19)
    expect(nearestFontSize(0)).toBe(FONT_SIZES[0])
    expect(nearestFontSize(999)).toBe(FONT_SIZES[FONT_SIZES.length - 1])
  })

  it('行高同理', () => {
    expect(nearestLineHeight(1.7)).toBe(1.6)
    expect(nearestLineHeight(2)).toBe(2.1)
  })
})

describe('normalizePrefs', () => {
  it('空值给默认', () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs({})).toEqual(DEFAULT_PREFS)
  })

  it('把非法值收敛回合法档位', () => {
    const prefs = normalizePrefs({
      fontSize: 999,
      lineHeight: 0.1,
      measure: 'gigantic' as never,
      theme: 'neon' as never
    })
    expect(prefs.fontSize).toBe(FONT_SIZES[FONT_SIZES.length - 1])
    expect(prefs.lineHeight).toBe(LINE_HEIGHTS[0])
    expect(prefs.measure).toBe(DEFAULT_PREFS.measure)
    expect(prefs.theme).toBe(DEFAULT_PREFS.theme)
  })

  it('合法值原样保留', () => {
    const prefs = normalizePrefs({ fontSize: 24, lineHeight: 2.1, measure: 'wide', theme: 'dark' })
    expect(prefs).toEqual({ fontSize: 24, lineHeight: 2.1, measure: 'wide', theme: 'dark' })
  })
})

describe('进度换算', () => {
  it('顶部是 0，底部是 1', () => {
    expect(progressRatio(0, 1000, 200)).toBe(0)
    expect(progressRatio(800, 1000, 200)).toBe(1)
  })

  it('中间位置按比例', () => {
    expect(progressRatio(400, 1000, 200)).toBe(0.5)
  })

  it('越界夹住', () => {
    expect(progressRatio(-50, 1000, 200)).toBe(0)
    expect(progressRatio(99999, 1000, 200)).toBe(1)
  })

  it('内容不足一屏时返回 0，不产生 NaN', () => {
    expect(progressRatio(0, 100, 500)).toBe(0)
    expect(Number.isNaN(progressRatio(0, 0, 0))).toBe(false)
  })

  it('与 scrollTopForRatio 互逆', () => {
    for (const ratio of [0, 0.25, 0.5, 1]) {
      expect(progressRatio(scrollTopForRatio(ratio, 1234, 200), 1234, 200)).toBeCloseTo(ratio, 6)
    }
  })

  it('不可滚动时滚到 0', () => {
    expect(scrollTopForRatio(0.5, 100, 500)).toBe(0)
  })
})

describe('formatPercent', () => {
  it('四舍五入成百分比', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.126)).toBe('13%')
    expect(formatPercent(1)).toBe('100%')
  })

  it('越界夹住', () => {
    expect(formatPercent(-1)).toBe('0%')
    expect(formatPercent(2)).toBe('100%')
  })
})
