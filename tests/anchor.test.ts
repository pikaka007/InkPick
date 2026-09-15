import { describe, expect, it } from 'vitest'
import { commonPrefixLength, commonSuffixLength, createAnchor, findOccurrences, resolveAnchor } from '@core/anchor'

const CONTENT = 'The quick brown fox jumps over the lazy dog. The quick brown cat sleeps.'

function anchorOf(content: string, needle: string, from = 0) {
  const start = content.indexOf(needle, from)
  return createAnchor(content, start, start + needle.length)
}

describe('createAnchor', () => {
  it('记录文本与前后上下文', () => {
    const anchor = anchorOf(CONTENT, 'brown fox')
    expect(anchor.text).toBe('brown fox')
    expect(anchor.prefix.endsWith('quick ')).toBe(true)
    expect(anchor.suffix.startsWith(' jumps')).toBe(true)
  })

  it('起止倒置时自动交换', () => {
    const forward = createAnchor(CONTENT, 4, 9)
    const backward = createAnchor(CONTENT, 9, 4)
    expect(backward).toEqual(forward)
  })

  it('越界不 panic，夹到合法范围', () => {
    const anchor = createAnchor('abc', -10, 999)
    expect(anchor).toMatchObject({ start: 0, end: 3, text: 'abc' })
  })

  it('文档开头 / 结尾处上下文为空字符串', () => {
    const head = createAnchor('hello', 0, 5)
    expect(head.prefix).toBe('')
    const tail = createAnchor('hello', 5, 5)
    expect(tail.text).toBe('')
    expect(tail.suffix).toBe('')
  })
})

describe('resolveAnchor', () => {
  it('原文未变时精确命中', () => {
    const anchor = anchorOf(CONTENT, 'lazy dog')
    const resolved = resolveAnchor(CONTENT, anchor)
    expect(resolved).toEqual({ start: anchor.start, end: anchor.end, fuzzy: false })
  })

  it('文本重复时用上下文选中正确的那个', () => {
    const content = 'alpha beta gamma alpha beta delta alpha beta gamma'
    // 第二处 alpha beta（后面是 delta）
    const second = content.indexOf('alpha beta', content.indexOf('alpha beta') + 1)
    const anchor = createAnchor(content, second, second + 'alpha beta'.length)

    // 前面插入了文字，offset 全部漂移
    const shifted = `PREFIX ${content}`
    const resolved = resolveAnchor(shifted, anchor)
    expect(resolved?.start).toBe(shifted.indexOf('alpha beta delta'))
    expect(resolved?.fuzzy).toBe(true)
  })

  it('offset 漂移但内容还在时能找回，并标记 fuzzy', () => {
    const anchor = anchorOf(CONTENT, 'jumps over')
    const shifted = `「新增的一段」\n\n${CONTENT}`
    const resolved = resolveAnchor(shifted, anchor)
    expect(shifted.slice(resolved!.start, resolved!.end)).toBe('jumps over')
    expect(resolved?.fuzzy).toBe(true)
  })

  it('原文被改写、选区文本消失时退化为按 prefix 相对定位', () => {
    const content = 'one two three four five six seven'
    const start = content.indexOf('three')
    const anchor = createAnchor(content, start, start + 'three'.length)

    // 「three」被删掉，但前面的 'one two ' 还在
    const edited = 'one two four five six seven'
    const resolved = resolveAnchor(edited, anchor)
    expect(resolved).not.toBeNull()
    expect(resolved?.fuzzy).toBe(true)
    expect(resolved?.start).toBe(edited.indexOf('four'))
  })

  it('prefix 也丢了时用 suffix 兜底', () => {
    const content = 'AAAAAAAAAA target ZZZZZZZZZZ'
    const start = content.indexOf('target')
    const anchor = createAnchor(content, start, start + 6)

    const edited = 'QQQ target ZZZZZZZZZZ'
    const resolved = resolveAnchor(edited, anchor)
    expect(resolved?.fuzzy).toBe(true)
    expect(edited.slice(resolved!.start, resolved!.end)).toBe('target')
  })

  it('原文与上下文全都被删掉时返回 null，而不是瞎猜', () => {
    const anchor = createAnchor('hello world', 6, 11)
    expect(resolveAnchor('nothing left here', anchor)).toBeNull()
  })

  it('空文本 anchor 返回 null', () => {
    expect(resolveAnchor(CONTENT, createAnchor(CONTENT, 3, 3))).toBeNull()
  })

  it('解析结果永远落在文档范围内', () => {
    const anchor = anchorOf(CONTENT, 'sleeps.')
    const resolved = resolveAnchor('The quick brown cat sleeps.', anchor)!
    expect(resolved.start).toBeGreaterThanOrEqual(0)
    expect(resolved.end).toBeLessThanOrEqual('The quick brown cat sleeps.'.length)
  })
})

describe('findOccurrences', () => {
  it('找出全部出现位置', () => {
    expect(findOccurrences('abab abab', 'ab')).toEqual([0, 2, 5, 7])
  })

  it('找不到时返回空数组', () => {
    expect(findOccurrences('abc', 'zz')).toEqual([])
  })
})

describe('上下文相似度', () => {
  it('commonPrefixLength / commonSuffixLength', () => {
    expect(commonPrefixLength('abcdef', 'abcxyz')).toBe(3)
    expect(commonSuffixLength('abcdef', 'xyzdef')).toBe(3)
    expect(commonPrefixLength('', 'abc')).toBe(0)
    expect(commonSuffixLength('abc', 'abc')).toBe(3)
  })
})
