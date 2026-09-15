/**
 * 文档内搜索 —— 纯函数，不碰 DOM。
 *
 * 为什么要有上限：在 10MB 的书里搜「e」会命中上百万次，
 * 全部算出来再交给渲染层高亮，等于自己把界面卡死。
 * 所以命中数封顶，并把「被截断了」这件事明确告诉调用方，而不是静默少给。
 */

export interface Match {
  /** 在全文中的起始偏移 */
  start: number
  /** 结束偏移（不含） */
  end: number
}

export interface SearchResult {
  matches: Match[]
  /** 命中数超过上限、只返回了前 limit 个 */
  truncated: boolean
}

export interface SearchOptions {
  /** 最多返回多少个命中 */
  limit?: number
  caseSensitive?: boolean
}

/** 单次搜索的命中上限。再多也不会有用，只会卡 */
export const DEFAULT_SEARCH_LIMIT = 2000

export function findMatches(content: string, query: string, options: SearchOptions = {}): SearchResult {
  const needle = query.trim()
  if (!needle || !content) return { matches: [], truncated: false }

  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT
  const haystack = options.caseSensitive ? content : content.toLowerCase()
  const target = options.caseSensitive ? needle : needle.toLowerCase()

  const matches: Match[] = []
  let from = 0

  while (matches.length < limit) {
    const at = haystack.indexOf(target, from)
    if (at === -1) return { matches, truncated: false }

    matches.push({ start: at, end: at + target.length })
    // 跳过整个命中，不产生重叠结果
    from = at + target.length
  }

  // 还能再找到才叫「被截断」
  const truncated = haystack.indexOf(target, from) !== -1
  return { matches, truncated }
}

/**
 * 上一个 / 下一个命中的下标，到头就绕回去。
 * 这也是浏览器「查找」的习惯行为 —— 停在最后一个再按回车，应该回到第一个。
 */
export function stepMatchIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return 0
  if (current < 0 || current >= total) return direction === 1 ? 0 : total - 1
  return (current + direction + total) % total
}

/** `3/128`；0/128 表示「有 128 处命中，但还没跳到任何一处」 */
export function formatMatchPosition(index: number, total: number): string {
  if (total <= 0) return ''
  return `${Math.min(Math.max(index + 1, 0), total)}/${total}`
}
