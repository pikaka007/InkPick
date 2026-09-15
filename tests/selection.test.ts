// @vitest-environment jsdom
/**
 * DOM ⇄ offset 映射的测试。
 * 这里覆盖的是「浏览器选区能不能被稳定翻译成全文偏移量」——
 * 标注功能的成败全看这一层。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { splitParagraphs } from '@core/text'
import { elementAtOffset, rangeForOffsets, rangeToOffsets, segmentStarts } from '@renderer/selection'

const CONTENT = 'alpha beta gamma\n\ndelta epsilon\n\nzeta eta theta'

let root: HTMLElement
let starts: number[]

/** 复刻阅读器的渲染方式：每段一个 data-seg，段内只有一个文本节点 */
function mount(content: string): void {
  const segments = splitParagraphs(content)
  root = document.createElement('div')
  segments.forEach((segment, index) => {
    const paragraph = document.createElement('p')
    paragraph.dataset.seg = String(index)
    paragraph.textContent = segment.text
    root.append(paragraph)
  })
  document.body.innerHTML = ''
  document.body.append(root)
  starts = segmentStarts(segments)
}

function segmentElement(index: number): HTMLElement {
  return root.querySelector<HTMLElement>(`[data-seg="${index}"]`)!
}

function textOf(index: number): Text {
  return segmentElement(index).firstChild as Text
}

function rangeWithin(index: number, start: number, end: number): Range {
  const range = document.createRange()
  range.setStart(textOf(index), start)
  range.setEnd(textOf(index), end)
  return range
}

beforeEach(() => {
  mount(CONTENT)
})

describe('rangeToOffsets', () => {
  it('段内选区换算成全文偏移量', () => {
    const start = CONTENT.indexOf('beta')
    const offsets = rangeToOffsets(root, rangeWithin(0, start, start + 4), starts)
    expect(offsets).toEqual({ start, end: start + 4 })
  })

  it('跨段选区两端都能换算', () => {
    const range = document.createRange()
    range.setStart(textOf(0), CONTENT.indexOf('beta'))
    range.setEnd(textOf(1), 5)

    const offsets = rangeToOffsets(root, range, starts)
    expect(offsets?.start).toBe(CONTENT.indexOf('beta'))
    expect(offsets?.end).toBe(CONTENT.indexOf('delta') + 5)
    expect(CONTENT.slice(offsets!.start, offsets!.end)).toBe('beta gamma\n\ndelta')
  })

  it('整段选中（端点是段元素本身）也能换算', () => {
    const range = document.createRange()
    range.setStart(segmentElement(2), 0)
    range.setEnd(segmentElement(2), segmentElement(2).childNodes.length)

    const offsets = rangeToOffsets(root, range, starts)
    expect(offsets).toEqual({ start: CONTENT.indexOf('zeta'), end: CONTENT.length })
  })

  it('端点倒置时返回有序区间（防御性）', () => {
    const fake = {
      startContainer: textOf(0),
      startOffset: 10,
      endContainer: textOf(0),
      endOffset: 2
    } as unknown as Range

    expect(rangeToOffsets(root, fake, starts)).toEqual({ start: 2, end: 10 })
  })

  it('选区不在阅读区内时返回 null', () => {
    const outside = document.createElement('p')
    outside.textContent = '外界文字'
    document.body.append(outside)

    const range = document.createRange()
    range.setStart(outside.firstChild as Text, 0)
    range.setEnd(outside.firstChild as Text, 2)

    expect(rangeToOffsets(root, range, starts)).toBeNull()
  })

  it('空选区（起止相同）返回零长度区间', () => {
    const offsets = rangeToOffsets(root, rangeWithin(0, 3, 3), starts)
    expect(offsets).toEqual({ start: 3, end: 3 })
  })
})

describe('rangeForOffsets', () => {
  it('与 rangeToOffsets 互为逆运算', () => {
    const original = rangeWithin(1, 6, 13)
    const offsets = rangeToOffsets(root, original, starts)!
    const restored = rangeForOffsets(root, starts, offsets)!

    expect(restored.toString()).toBe(original.toString())
    expect(restored.toString()).toBe('epsilon')
  })

  it('跳段落区间可以还原（offset 往返一致）', () => {
    const start = CONTENT.indexOf('gamma')
    const end = CONTENT.indexOf('delta') + 5
    const range = rangeForOffsets(root, starts, { start, end })!

    // 换行符不在 DOM 里，所以 toString 不含 \n\n；offset 才是唯一可信的表示
    expect(range.toString()).toBe('gammadelta')
    expect(rangeToOffsets(root, range, starts)).toEqual({ start, end })
  })

  it('offset 落在段落之间的换行符上时夹到段尾', () => {
    const endOfFirst = CONTENT.indexOf('alpha'.slice(0)) + 'alpha beta gamma'.length
    const range = rangeForOffsets(root, starts, { start: 0, end: endOfFirst + 1 })!

    // 换行符不该出现在选中内容里
    expect(range.toString()).toBe('alpha beta gamma')
  })

  it('空文档返回 null', () => {
    expect(rangeForOffsets(root, [], { start: 0, end: 1 })).toBeNull()
  })
})

describe('elementAtOffset', () => {
  it('命中 offset 所在的段落', () => {
    expect(elementAtOffset(root, starts, CONTENT.indexOf('epsilon'))?.dataset.seg).toBe('1')
  })

  it('段首 offset 命中该段', () => {
    expect(elementAtOffset(root, starts, CONTENT.indexOf('delta'))?.dataset.seg).toBe('1')
  })

  it('越界 offset 夹到首尾段落', () => {
    expect(elementAtOffset(root, starts, -5)?.dataset.seg).toBe('0')
    expect(elementAtOffset(root, starts, CONTENT.length + 100)?.dataset.seg).toBe('2')
  })

  it('没有段落时返回 null', () => {
    mount('\n\n\n')
    expect(elementAtOffset(root, starts, 0)).toBeNull()
  })
})
