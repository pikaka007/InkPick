import { describe, expect, it } from 'vitest'
import { clamp, normalizeContent, sentenceAround, splitParagraphs } from '@core/text'

describe('normalizeContent', () => {
  it('去掉 BOM 并把 CRLF / CR 统一成 LF', () => {
    expect(normalizeContent('\uFEFFa\r\nb\rc')).toBe('a\nb\nc')
  })

  it('保持已有 LF 不变', () => {
    expect(normalizeContent('a\nb')).toBe('a\nb')
  })
})

describe('splitParagraphs', () => {
  it('按非空行切段，并记录每段在全文中的真实起点', () => {
    const content = 'alpha\n\nbeta\ngamma'
    expect(splitParagraphs(content)).toEqual([
      { start: 0, text: 'alpha' },
      { start: 7, text: 'beta' },
      { start: 12, text: 'gamma' }
    ])
  })

  it('每段都不含换行符 —— 这是 DOM 偏移量换算的前提', () => {
    const content = 'one\n\ntwo\n\n\nthree'
    for (const segment of splitParagraphs(content)) {
      expect(segment.text).not.toContain('\n')
      expect(content.slice(segment.start, segment.start + segment.text.length)).toBe(segment.text)
    }
  })

  it('全是空行时返回空数组', () => {
    expect(splitParagraphs('\n\n\n')).toEqual([])
  })
})

describe('sentenceAround', () => {
  const content = 'Reading slowly is a habit. Most people skim the page and move on. The rest annotate.'

  it('取选中词所在的那句话', () => {
    const start = content.indexOf('skim')
    expect(sentenceAround(content, start, start + 4)).toBe('Most people skim the page and move on.')
  })

  it('选区跨句时覆盖完整句子', () => {
    const start = content.indexOf('habit')
    const end = content.indexOf('skim') + 4
    expect(sentenceAround(content, start, end)).toBe('Reading slowly is a habit. Most people skim the page and move on.')
  })

  it('单个换行不是句子边界（硬换行的 txt 里句子会跨行）', () => {
    const hardWrapped = 'first line no period\nsecond line'
    const start = hardWrapped.indexOf('second')
    expect(sentenceAround(hardWrapped, start, start + 6)).toBe('first line no period second line')
  })

  it('空行才是段落边界', () => {
    const twoParagraphs = 'first para\n\nsecond para'
    const start = twoParagraphs.indexOf('second')
    expect(sentenceAround(twoParagraphs, start, start + 6)).toBe('second para')
  })

  it('连续空行也不会串到上一段', () => {
    const content = 'alpha\n\n\n\nbeta'
    const start = content.indexOf('beta')
    expect(sentenceAround(content, start, start + 4)).toBe('beta')
  })

  it('超长句子按 maxLen 截断，但必须完整包含选区', () => {
    const long = `${'a'.repeat(300)}TARGET${'b'.repeat(300)}`
    const start = long.indexOf('TARGET')
    const result = sentenceAround(long, start, start + 6, 100)
    expect(result.length).toBeLessThanOrEqual(100)
    expect(result).toContain('TARGET')
  })

  it('选区本身超长时从选区起点开始截断', () => {
    const long = 'x'.repeat(500)
    const result = sentenceAround(long, 100, 400, 50)
    expect(result).toBe('x'.repeat(50))
  })

  it('折叠连续空白，方便在列表里显示', () => {
    const messy = 'This   is\n  spaced.'
    expect(sentenceAround(messy, 0, 4)).toBe('This is spaced.')
  })
})

describe('clamp', () => {
  it('夹在区间内', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(99, 0, 10)).toBe(10)
  })
})
