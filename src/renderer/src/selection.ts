/**
 * DOM ⇄ offset 映射。
 *
 * 阅读器把全文按段渲染，每段带 data-seg="序号"，且段内只有一个文本节点。
 * 有了这个前提，「浏览器选中的 Range」才能稳定换算成「全文第几个字符」。
 * 这是整个标注功能的地基，改动必须同步补 tests/dom/selection.test.ts。
 */
import { clamp } from '@core/text'
import type { TextSegment } from '@core/text'

export interface OffsetRange {
  start: number
  end: number
}

export function segmentStarts(segments: TextSegment[]): number[] {
  return segments.map((segment) => segment.start)
}

function segmentElementOf(rootEl: HTMLElement, node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
  const segEl = element?.closest('[data-seg]') ?? null
  if (!(segEl instanceof HTMLElement) || !rootEl.contains(segEl)) return null
  return segEl
}

function segmentIndexOf(segEl: HTMLElement): number | null {
  const raw = segEl.dataset.seg
  if (raw === undefined) return null
  const index = Number(raw)
  return Number.isInteger(index) ? index : null
}

function segmentAt(rootEl: HTMLElement, index: number): HTMLElement | null {
  return rootEl.querySelector<HTMLElement>(`[data-seg="${index}"]`)
}

/** 节点在某段内的字符偏移 */
function innerOffset(segEl: HTMLElement, node: Node, offset: number): number {
  const walker = document.createTreeWalker(segEl, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let current = walker.nextNode()
  while (current) {
    if (current === node) return consumed + offset
    consumed += current.textContent?.length ?? 0
    current = walker.nextNode()
  }

  // 选区端点落在段元素本身（如整段被选中）时，offset 是子节点序号
  if (node === segEl) {
    let length = 0
    for (let i = 0; i < offset && i < segEl.childNodes.length; i++) {
      length += segEl.childNodes[i]?.textContent?.length ?? 0
    }
    return length
  }

  return consumed
}

/** 浏览器选区 → 全文偏移量 */
export function rangeToOffsets(rootEl: HTMLElement, range: Range, starts: number[]): OffsetRange | null {
  const startEl = segmentElementOf(rootEl, range.startContainer)
  const endEl = segmentElementOf(rootEl, range.endContainer)
  if (!startEl || !endEl) return null

  const startIndex = segmentIndexOf(startEl)
  const endIndex = segmentIndexOf(endEl)
  if (startIndex === null || endIndex === null) return null

  const start = starts[startIndex] + innerOffset(startEl, range.startContainer, range.startOffset)
  const end = starts[endIndex] + innerOffset(endEl, range.endContainer, range.endOffset)

  return start <= end ? { start, end } : { start: end, end: start }
}

function segmentIndexAtOffset(starts: number[], offset: number): number {
  let index = 0
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= offset) index = i
    else break
  }
  return index
}

function textNodeOf(segEl: HTMLElement): Text | null {
  const node = segEl.firstChild
  return node && node.nodeType === Node.TEXT_NODE ? (node as Text) : null
}

/** 全文偏移量 → 浏览器选区（用于高亮与跳转） */
export function rangeForOffsets(rootEl: HTMLElement, starts: number[], range: OffsetRange): Range | null {
  if (starts.length === 0) return null

  const startIndex = segmentIndexAtOffset(starts, range.start)
  const endIndex = segmentIndexAtOffset(starts, range.end)
  const startEl = segmentAt(rootEl, startIndex)
  const endEl = segmentAt(rootEl, endIndex)
  if (!startEl || !endEl) return null

  const startText = textNodeOf(startEl)
  const endText = textNodeOf(endEl)
  if (!startText || !endText) return null

  const result = document.createRange()
  result.setStart(startText, clamp(range.start - starts[startIndex], 0, startText.length))
  result.setEnd(endText, clamp(range.end - starts[endIndex], 0, endText.length))
  return result
}

/** offset 所在的段落元素（跳转时用来滚动定位） */
export function elementAtOffset(rootEl: HTMLElement, starts: number[], offset: number): HTMLElement | null {
  if (starts.length === 0) return null
  return segmentAt(rootEl, segmentIndexAtOffset(starts, offset))
}
