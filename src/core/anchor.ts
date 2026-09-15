/**
 * Anchor —— 定位与重定位。
 *
 * 这是整个项目最值钱的一段代码。原文一旦被改动（换版本、修订、重新导入），
 * 光靠 offset 找不到东西。所以 anchor 里冗余存了 text / prefix / suffix：
 *
 *   1. 先按 text 在全文里找所有候选（可能有多处重复）
 *   2. 用 prefix / suffix 的匹配度给候选打分，选最像原来那处的
 *   3. text 彻底找不到时（原文被改），退化为用 prefix 相对定位，保住「大概位置」
 *
 * 改动本文件必须同步补 tests/anchor.test.ts。
 */
import type { Anchor } from './types'
import { clamp } from './text'

/** 前后各存多少字符作为上下文 */
export const CONTEXT_LEN = 32

/** 单次重定位最多扫描多少个候选，防止超长文档里卡死 */
const MAX_CANDIDATES = 2000

export function createAnchor(content: string, start: number, end: number, contextLen = CONTEXT_LEN): Anchor {
  const s = clamp(Math.min(start, end), 0, content.length)
  const e = clamp(Math.max(start, end), 0, content.length)
  return {
    start: s,
    end: e,
    text: content.slice(s, e),
    prefix: content.slice(Math.max(0, s - contextLen), s),
    suffix: content.slice(e, Math.min(content.length, e + contextLen))
  }
}

export interface ResolveResult {
  start: number
  end: number
  /** 是否靠模糊匹配找到（offset 已不可信） */
  fuzzy: boolean
}

/**
 * 把 anchor 重新落到 content 上。
 * 返回 null 只在一种情况下发生：选区文本为空，无法定位。
 */
export function resolveAnchor(content: string, anchor: Anchor): ResolveResult | null {
  if (!anchor.text) return null

  const candidates = findOccurrences(content, anchor.text)
  if (candidates.length > 0) {
    const best = pickBest(content, anchor, candidates)
    return { start: best, end: best + anchor.text.length, fuzzy: best !== anchor.start }
  }

  return resolveByContext(content, anchor)
}

/** text 在 content 中的所有出现位置（有上限） */
export function findOccurrences(content: string, text: string): number[] {
  const positions: number[] = []
  let from = 0
  while (positions.length < MAX_CANDIDATES) {
    const at = content.indexOf(text, from)
    if (at === -1) break
    positions.push(at)
    from = at + 1
  }
  return positions
}

/** 用 prefix/suffix 给候选打分，取最匹配的；同分时取离原 offset 最近的 */
function pickBest(content: string, anchor: Anchor, candidates: number[]): number {
  let best = candidates[0]
  let bestScore = -1
  let bestDistance = Number.POSITIVE_INFINITY

  for (const start of candidates) {
    const score = contextScore(content, anchor, start, start + anchor.text.length)
    const distance = Math.abs(start - anchor.start)
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = start
      bestScore = score
      bestDistance = distance
    }
  }
  return best
}

/** 候选位置前后文与 anchor 记录的前后文的吻合程度 */
function contextScore(content: string, anchor: Anchor, start: number, end: number): number {
  const before = content.slice(Math.max(0, start - anchor.prefix.length), start)
  const after = content.slice(end, end + anchor.suffix.length)
  return commonSuffixLength(before, anchor.prefix) + commonPrefixLength(after, anchor.suffix)
}

/** text 已找不到时的兜底：靠 prefix 相对定位，尽量保住「大概位置」 */
function resolveByContext(content: string, anchor: Anchor): ResolveResult | null {
  const len = anchor.text.length

  if (anchor.prefix) {
    const hits = findOccurrences(content, anchor.prefix)
    if (hits.length > 0) {
      const at = pickNearest(hits, anchor.start - anchor.prefix.length)
      const start = at + anchor.prefix.length
      return { start, end: Math.min(content.length, start + len), fuzzy: true }
    }
  }

  if (anchor.suffix) {
    const hits = findOccurrences(content, anchor.suffix)
    if (hits.length > 0) {
      const at = pickNearest(hits, anchor.end)
      const end = at
      const start = Math.max(0, end - len)
      return { start, end, fuzzy: true }
    }
  }

  return null
}

function pickNearest(positions: number[], target: number): number {
  let best = positions[0]
  let bestDistance = Math.abs(best - target)
  for (const p of positions) {
    const d = Math.abs(p - target)
    if (d < bestDistance) {
      best = p
      bestDistance = d
    }
  }
  return best
}

/** a 末尾与 b 末尾相同的字符数，上限 min(a.length, b.length) */
export function commonSuffixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let n = 0
  while (n < max && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

/** a 开头与 b 开头相同的字符数，上限 min(a.length, b.length) */
export function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let n = 0
  while (n < max && a[n] === b[n]) n++
  return n
}
