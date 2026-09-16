/**
 * 导航历史 —— 纯函数，可单测。
 *
 * 解决什么问题：从侧栏点一个词跳到原文某处之后，**回不到刚才读到的地方**。
 * 而且不止是「没有按钮」：跳转会触发滚动，滚动会写阅读进度 ——
 * 所以点一个第 2 章的词，你的阅读进度就从 60% 变成 10% 了，
 * 关掉应用再打开也是从那里开始。位置是**真的丢了**，不只是「不顺手」。
 *
 * 所以要做两件事，缺一不可：
 *   1. 记住跳转前的位置，给一个「返回」入口（这里管这个）
 *   2. 跳转本身不该改写阅读进度（在 Reader 里用「谁在驱动滚动」来区分）
 *
 * 用栈而不是单个位置：连着点几个词之后，应该能一路退回去，
 * 这和浏览器的后退是同一个模型。
 */

export interface NavEntry {
  docId: string
  /** 全文偏移量 */
  offset: number
}

/** 最多记这么多步。再多对「退回去」也没意义了，只是白占内存 */
export const NAV_HISTORY_LIMIT = 20

/**
 * 压入一步。
 *
 * 连续压入同一个位置会被忽略 —— 否则「在同一个地方点两个相邻的词」
 * 会攒出两条一模一样的记录，退一次看起来像没反应。
 */
export function pushNav(history: NavEntry[], entry: NavEntry): NavEntry[] {
  const last = history[history.length - 1]
  if (last && last.docId === entry.docId && last.offset === entry.offset) return history

  const next = [...history, entry]
  return next.length > NAV_HISTORY_LIMIT ? next.slice(next.length - NAV_HISTORY_LIMIT) : next
}

/** 弹出一层。空栈时 top 为 null，rest 原样返回 */
export function popNav(history: NavEntry[]): { top: NavEntry | null; rest: NavEntry[] } {
  if (history.length === 0) return { top: null, rest: history }
  return { top: history[history.length - 1], rest: history.slice(0, -1) }
}
