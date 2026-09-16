import { describe, expect, it } from 'vitest'
import { NAV_HISTORY_LIMIT, popNav, pushNav } from '@core/history'
import type { NavEntry } from '@core/history'

const at = (offset: number, docId = 'doc-1'): NavEntry => ({ docId, offset })

describe('pushNav', () => {
  it('按顺序压入，返回新数组（不改原数组）', () => {
    const first: NavEntry[] = []
    const second = pushNav(first, at(100))
    const third = pushNav(second, at(500))

    expect(first).toEqual([])
    expect(second).toEqual([at(100)])
    expect(third).toEqual([at(100), at(500)])
  })

  it('连续压入同一个位置会被忽略', () => {
    // 否则「在同一个地方点两个相邻的词」会攒出两条一样的记录，
    // 退一次看起来像没反应
    const history = pushNav(pushNav([], at(100)), at(100))
    expect(history).toHaveLength(1)
  })

  it('同一个位置但在不同的书里，算两步', () => {
    const history = pushNav(pushNav([], at(100, 'doc-a')), at(100, 'doc-b'))
    expect(history).toHaveLength(2)
  })

  it('超过上限时丢掉最老的，保留最近的', () => {
    let history: NavEntry[] = []
    for (let i = 1; i <= NAV_HISTORY_LIMIT + 5; i++) history = pushNav(history, at(i * 10))

    expect(history).toHaveLength(NAV_HISTORY_LIMIT)
    // 最后一步一定在
    expect(history[history.length - 1]).toEqual(at((NAV_HISTORY_LIMIT + 5) * 10))
    // 最老的几步已经挤出去了
    expect(history.some((entry) => entry.offset === 10)).toBe(false)
  })
})

describe('popNav', () => {
  it('弹出最近一步，剩下的原样返回', () => {
    const { top, rest } = popNav([at(100), at(500)])
    expect(top).toEqual(at(500))
    expect(rest).toEqual([at(100)])
  })

  it('空栈时 top 为 null，不报错', () => {
    const { top, rest } = popNav([])
    expect(top).toBeNull()
    expect(rest).toEqual([])
  })

  it('连续弹到底', () => {
    let history = pushNav(pushNav([], at(100)), at(500))
    let steps = 0
    for (;;) {
      const { top, rest } = popNav(history)
      if (!top) break
      steps++
      history = rest
    }
    expect(steps).toBe(2)
    expect(history).toEqual([])
  })
})
