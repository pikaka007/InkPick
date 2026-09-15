/**
 * CSS Custom Highlight API 的最小封装。
 *
 * 用它而不是往 DOM 里插 <mark>：不改动文本节点，offset 映射就不会被打乱。
 * 旧环境不支持时整体降级为「不高亮」，跳转滚动依然可用。
 */
interface HighlightRegistryLike {
  set(name: string, highlight: object): void
  delete(name: string): boolean
}

type HighlightCtor = new (...ranges: Range[]) => object

function registry(): HighlightRegistryLike | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS
  return css?.highlights ?? null
}

function highlightCtor(): HighlightCtor | null {
  return ((globalThis as { Highlight?: unknown }).Highlight as HighlightCtor | undefined) ?? null
}

export function highlightSupported(): boolean {
  return registry() !== null && highlightCtor() !== null
}

export function applyHighlight(name: string, ranges: Range[]): void {
  const reg = registry()
  const Ctor = highlightCtor()
  if (!reg || !Ctor) return

  if (ranges.length === 0) {
    reg.delete(name)
    return
  }
  reg.set(name, new Ctor(...ranges))
}

export function clearHighlight(name: string): void {
  registry()?.delete(name)
}
