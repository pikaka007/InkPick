import { describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH_LIMIT, findMatches, formatMatchPosition, stepMatchIndex } from '@core/search'

describe('findMatches', () => {
  const text = 'Reading slowly is a habit. A habit that few people cultivate.'

  it('找出全部命中', () => {
    // 偏移量手算容易错，这里直接对着原文验证
    expect(findMatches(text, 'habit').matches).toEqual([
      { start: 20, end: 25 },
      { start: 29, end: 34 }
    ])
    for (const match of findMatches(text, 'habit').matches) {
      expect(text.slice(match.start, match.end)).toBe('habit')
    }
  })

  it('大小写不敏感', () => {
    expect(findMatches(text, 'READING').matches).toEqual([{ start: 0, end: 7 }])
    expect(findMatches(text, 'reading').matches).toHaveLength(1)
  })

  it('可以要求区分大小写', () => {
    expect(findMatches(text, 'READING', { caseSensitive: true }).matches).toEqual([])
    expect(findMatches(text, 'Reading', { caseSensitive: true }).matches).toHaveLength(1)
  })

  it('命中不重叠', () => {
    // 「aaaa」里搜「aa」应该是两处，而不是三处
    expect(findMatches('aaaa', 'aa').matches).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ])
    expect(findMatches('ababab', 'ab').matches).toHaveLength(3)
  })

  it('空查询或纯空白返回空结果', () => {
    expect(findMatches(text, '').matches).toEqual([])
    expect(findMatches(text, '   ').matches).toEqual([])
    expect(findMatches('', 'a').matches).toEqual([])
  })

  it('查询词首尾空白会被忽略', () => {
    expect(findMatches(text, '  habit  ').matches).toHaveLength(2)
  })

  it('中文也能搜', () => {
    expect(findMatches('一边读，一边记笔记。', '一边').matches).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 }
    ])
  })

  it('命中区间落在文本范围内，且与原文一致', () => {
    for (const match of findMatches(text, 'a').matches) {
      expect(match.start).toBeGreaterThanOrEqual(0)
      expect(match.end).toBeLessThanOrEqual(text.length)
      expect(text.slice(match.start, match.end).toLowerCase()).toBe('a')
    }
  })

  it('超过上限时按上限截断，并明确标记 truncated', () => {
    const many = 'a'.repeat(100)
    const result = findMatches(many, 'a', { limit: 10 })

    expect(result.matches).toHaveLength(10)
    expect(result.truncated).toBe(true)
  })

  it('刚好等于上限时不算截断', () => {
    const result = findMatches('ab'.repeat(5), 'ab', { limit: 5 })
    expect(result.matches).toHaveLength(5)
    expect(result.truncated).toBe(false)
  })

  it('没找到时不标记截断', () => {
    expect(findMatches(text, 'zzzz')).toEqual({ matches: [], truncated: false })
  })

  it('默认上限是个不会把界面拖死的数', () => {
    expect(DEFAULT_SEARCH_LIMIT).toBeLessThanOrEqual(5000)
    expect(DEFAULT_SEARCH_LIMIT).toBeGreaterThanOrEqual(200)
  })
})

describe('stepMatchIndex', () => {
  it('往后走', () => {
    expect(stepMatchIndex(0, 3, 1)).toBe(1)
    expect(stepMatchIndex(1, 3, 1)).toBe(2)
  })

  it('到头绕回第一个', () => {
    expect(stepMatchIndex(2, 3, 1)).toBe(0)
  })

  it('往前走到头绕回最后一个', () => {
    expect(stepMatchIndex(0, 3, -1)).toBe(2)
  })

  it('没有命中时恒为 0', () => {
    expect(stepMatchIndex(0, 0, 1)).toBe(0)
    expect(stepMatchIndex(5, 0, -1)).toBe(0)
  })

  it('下标越界时收敛到端点', () => {
    expect(stepMatchIndex(99, 3, 1)).toBe(0)
    expect(stepMatchIndex(-1, 3, -1)).toBe(2)
  })
})

describe('formatMatchPosition', () => {
  it('显示 1 起的序号', () => {
    expect(formatMatchPosition(0, 5)).toBe('1/5')
    expect(formatMatchPosition(4, 5)).toBe('5/5')
  })

  it('没有命中时给空串', () => {
    expect(formatMatchPosition(0, 0)).toBe('')
  })

  it('下标越界不会显示 6/5', () => {
    expect(formatMatchPosition(7, 5)).toBe('5/5')
  })
})
