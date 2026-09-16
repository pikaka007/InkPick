import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DAILY_NEW,
  DEFAULT_EASE,
  MAX_EASE,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  RELEARN_DELAY_MS,
  buildReviewQueue,
  describeNextDue,
  introducedToday,
  isDue,
  nextReview,
  queueSize,
  startOfDay
} from '@core/review'
import type { ReviewState } from '@core/types'
import { createEmptyStore, deserializeStore, serializeStore, setReview } from '@core/store'

const DAY = 24 * 60 * 60 * 1000

/** 固定一个「现在」，避免测试依赖真实时间 */
const NOW = new Date('2026-05-10T10:00:00').getTime()

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    due: NOW,
    interval: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
    firstAt: NOW,
    reviewedAt: NOW,
    ...overrides
  }
}

describe('nextReview · 新词第一次复习', () => {
  it('记得 → 1 天后，难度系数升一点', () => {
    const next = nextReview(undefined, 'remembered', NOW)
    expect(next.interval).toBe(1)
    expect(next.due).toBe(NOW + DAY)
    expect(next.reps).toBe(1)
    expect(next.ease).toBeCloseTo(DEFAULT_EASE + 0.1, 5)
    expect(next.firstAt).toBe(NOW)
  })

  it('模糊 → 也是 1 天（保底），但难度系数降', () => {
    const next = nextReview(undefined, 'fuzzy', NOW)
    expect(next.interval).toBe(1)
    expect(next.ease).toBeCloseTo(DEFAULT_EASE - 0.05, 5)
  })

  it('忘了 → 间隔归零、几分钟后再来、忘的次数 +1', () => {
    const next = nextReview(undefined, 'forgot', NOW)
    expect(next.interval).toBe(0)
    expect(next.due).toBe(NOW + RELEARN_DELAY_MS)
    expect(next.lapses).toBe(1)
    expect(next.reps).toBe(0)
    // 不能立刻再来：那会在一次会话里反复弹同一张卡
    expect(next.due).toBeGreaterThan(NOW)
  })
})

describe('nextReview · 间隔生长', () => {
  it('记得：1 天 → 3 天 → 按难度系数乘', () => {
    const first = nextReview(undefined, 'remembered', NOW)
    const second = nextReview(first, 'remembered', NOW)
    expect(second.interval).toBe(3)

    const third = nextReview(second, 'remembered', NOW)
    // 3 × ease（2.5 + 屡次加成）
    expect(third.interval).toBeGreaterThan(3)
    expect(third.interval).toBe(Math.round(second.interval * third.ease))
  })

  it('一直记得会越拉越长', () => {
    let current: ReviewState | undefined
    const intervals: number[] = []
    for (let i = 0; i < 8; i++) {
      current = nextReview(current, 'remembered', NOW)
      intervals.push(current.interval)
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1])
    }
    expect(intervals[intervals.length - 1]).toBeGreaterThan(30)
  })

  it('间隔有上限，不会算出「几年后」', () => {
    let current: ReviewState | undefined
    for (let i = 0; i < 40; i++) current = nextReview(current, 'remembered', NOW)
    expect(current!.interval).toBeLessThanOrEqual(MAX_INTERVAL_DAYS)
  })

  it('模糊让间隔慢慢涨，不会像「记得」那样翻倍', () => {
    const base = state({ interval: 10, reps: 5 })
    const fuzzy = nextReview(base, 'fuzzy', NOW)
    const remembered = nextReview(base, 'remembered', NOW)
    expect(fuzzy.interval).toBe(12) // 10 × 1.2
    expect(remembered.interval).toBeGreaterThan(fuzzy.interval)
  })

  it('忘了之后 reps 归零，下次记得又从 1 天开始', () => {
    const grown = state({ interval: 30, reps: 5 })
    const forgot = nextReview(grown, 'forgot', NOW)
    expect(forgot.interval).toBe(0)
    expect(forgot.reps).toBe(0)

    const again = nextReview(forgot, 'remembered', NOW)
    expect(again.interval).toBe(1)
  })

  it('从未评过分的词不该丢掉第一次复习时间', () => {
    const earlier = NOW - 5 * DAY
    const existing = state({ firstAt: earlier, interval: 10, reps: 2 })
    expect(nextReview(existing, 'remembered', NOW).firstAt).toBe(earlier)
  })
})

describe('nextReview · 难度系数的边界', () => {
  it('一直忘了也不会掉到负数，夹在 MIN_EASE', () => {
    let current: ReviewState | undefined
    for (let i = 0; i < 20; i++) current = nextReview(current, 'forgot', NOW)
    expect(current!.ease).toBe(MIN_EASE)
  })

  it('一直记得也不会无限变大，夹在 MAX_EASE', () => {
    let current: ReviewState | undefined
    for (let i = 0; i < 30; i++) current = nextReview(current, 'remembered', NOW)
    expect(current!.ease).toBeLessThanOrEqual(MAX_EASE)
  })
})

describe('isDue', () => {
  it('到期时间在当前时刻之前就是该复习了', () => {
    expect(isDue(state({ due: NOW - 1 }), NOW)).toBe(true)
    expect(isDue(state({ due: NOW }), NOW)).toBe(true)
    expect(isDue(state({ due: NOW + 1 }), NOW)).toBe(false)
  })
})

describe('startOfDay', () => {
  it('取本地时间的今天零点', () => {
    const start = startOfDay(NOW)
    const date = new Date(start)
    expect(date.getHours()).toBe(0)
    expect(date.getMinutes()).toBe(0)
    expect(date.getSeconds()).toBe(0)
    expect(date.getDate()).toBe(new Date(NOW).getDate())
  })

  it('今天任意时刻算出来的零点都一样', () => {
    expect(startOfDay(NOW)).toBe(startOfDay(NOW + 5 * 60 * 60 * 1000))
  })
})

describe('introducedToday', () => {
  it('只数今天第一次复习的那些', () => {
    const review = {
      a: state({ firstAt: NOW - 3 * DAY }),
      b: state({ firstAt: startOfDay(NOW) + 60_000 }),
      c: state({ firstAt: NOW })
    }
    expect(introducedToday(review, NOW)).toBe(2)
  })

  it('空表是 0', () => {
    expect(introducedToday({}, NOW)).toBe(0)
  })
})

describe('buildReviewQueue', () => {
  it('到期的排前面，且过期最久的在最前', () => {
    const review = {
      a: state({ due: NOW - 1 * DAY }),
      b: state({ due: NOW - 5 * DAY }),
      c: state({ due: NOW + 1 * DAY })
    }
    const queue = buildReviewQueue(['a', 'b', 'c'], review, { now: NOW })
    expect(queue.due).toEqual(['b', 'a'])
    // 还没到期的既不在 due 也不在 fresh
    expect(queue.fresh).toEqual([])
  })

  it('没有复习状态的是新词，按收藏顺序排队', () => {
    const queue = buildReviewQueue(['x', 'y', 'z'], {}, { now: NOW })
    expect(queue.fresh).toEqual(['x', 'y', 'z'])
    expect(queue.due).toEqual([])
  })

  it('新词受每日上限限制，超出的记进 deferred', () => {
    const keys = Array.from({ length: 25 }, (_, i) => `k${i}`)
    const queue = buildReviewQueue(keys, {}, { now: NOW, dailyNewLimit: 10 })
    expect(queue.fresh).toHaveLength(10)
    expect(queue.deferred).toBe(15)
  })

  it('今天已经引入过的新词会占掉名额', () => {
    const keys = ['new1', 'new2', 'new3']
    const review = {
      // 今天引入过 2 个
      done1: state({ firstAt: startOfDay(NOW) + 1000 }),
      done2: state({ firstAt: startOfDay(NOW) + 2000 })
    }
    const queue = buildReviewQueue(keys, review, { now: NOW, dailyNewLimit: 3 })
    expect(queue.fresh).toEqual(['new1'])
    expect(queue.deferred).toBe(2)
  })

  it('名额用完了就一个都不给', () => {
    const review = {
      a: state({ firstAt: NOW }),
      b: state({ firstAt: NOW })
    }
    const queue = buildReviewQueue(['x'], review, { now: NOW, dailyNewLimit: 2 })
    expect(queue.fresh).toEqual([])
    expect(queue.deferred).toBe(1)
  })

  it('到期的不受每日上限影响（该复习的不能拖）', () => {
    const keys = ['due1', 'due2', 'new1']
    const review = {
      due1: state({ due: NOW - DAY }),
      due2: state({ due: NOW - 2 * DAY }),
      justDone: state({ firstAt: NOW })
    }
    const queue = buildReviewQueue(keys, review, { now: NOW, dailyNewLimit: 1 })
    expect(queue.due).toEqual(['due2', 'due1'])
    expect(queue.fresh).toEqual([])
    expect(queue.deferred).toBe(1)
  })

  it('队列里已删除的词不会冒出来（keys 是唯一依据）', () => {
    const review = { gone: state({ due: NOW - DAY }) }
    const queue = buildReviewQueue(['kept'], review, { now: NOW })
    expect(queue.due).toEqual([])
    expect(queue.fresh).toEqual(['kept'])
  })

  it('默认每日新词上限', () => {
    const keys = Array.from({ length: DEFAULT_DAILY_NEW + 5 }, (_, i) => `k${i}`)
    expect(buildReviewQueue(keys, {}, { now: NOW }).fresh).toHaveLength(DEFAULT_DAILY_NEW)
  })

  it('queueSize = 到期 + 新词', () => {
    const review = { a: state({ due: NOW - DAY }) }
    const queue = buildReviewQueue(['a', 'b'], review, { now: NOW })
    expect(queueSize(queue)).toBe(2)
  })
})

describe('describeNextDue', () => {  it('刚忘过说多少分钟后再来', () => {
    expect(describeNextDue(nextReview(undefined, 'forgot', NOW), NOW)).toContain('分钟后再来')
  })

  it('间隔 1 天说「明天再见」', () => {
    expect(describeNextDue(nextReview(undefined, 'remembered', NOW), NOW)).toBe('明天再见')
  })

  it('长间隔按天或按月说', () => {
    expect(describeNextDue(state({ interval: 10, due: NOW + 10 * DAY }), NOW)).toBe('10 天后再见')
    expect(describeNextDue(state({ interval: 60, due: NOW + 60 * DAY }), NOW)).toBe('2 个月后再见')
  })

  it('已经过期就说「待复习」', () => {
    expect(describeNextDue(state({ interval: 5, due: NOW - 1000 }), NOW)).toBe('待复习')
  })
})

describe('复习进度能存下来', () => {
  it('往返序列化后还在', () => {
    const store = setReview(createEmptyStore(), 'habit', nextReview(undefined, 'remembered', NOW))
    const back = deserializeStore(serializeStore(store))

    expect(Object.keys(back.review)).toEqual(['habit'])
    expect(back.review.habit.interval).toBe(1)
    expect(back.review.habit.firstAt).toBe(NOW)
  })

  it('旧存档没有这个字段时补空对象（不是报错）', () => {
    const legacy = JSON.stringify({ version: 1, docs: [], annotations: [], progress: {}, prefs: {} })
    expect(deserializeStore(legacy).review).toEqual({})
  })

  it('字段残缺的单条丢掉，不拖累其他条', () => {
    // 缺 lapses 会让 state.lapses + 1 算出 NaN，NaN 存进 JSON 变 null，下次又被丢
    const raw = JSON.stringify({
      version: 1,
      docs: [],
      annotations: [],
      progress: {},
      review: {
        good: { due: 1, interval: 2, ease: 2.5, reps: 1, lapses: 0, firstAt: 3, reviewedAt: 4 },
        broken: { due: 1, interval: 2, ease: 2.5, reps: 1, firstAt: 3 }
      }
    })
    expect(Object.keys(deserializeStore(raw).review)).toEqual(['good'])
  })

  it('完全不是对象的 review 当作空', () => {
    const raw = JSON.stringify({ version: 1, docs: [], annotations: [], progress: {}, review: 'nope' })
    expect(deserializeStore(raw).review).toEqual({})
  })

  it('setReview 不改原对象', () => {
    const before = createEmptyStore()
    const after = setReview(before, 'a', nextReview(undefined, 'fuzzy', NOW))
    expect(before.review).toEqual({})
    expect(Object.keys(after.review)).toEqual(['a'])
  })

  it('评分状态存下来后，重开时就能算出「今天已经引入了几个新词」', () => {
    let store = createEmptyStore()
    store = setReview(store, 'a', nextReview(undefined, 'remembered', NOW))
    store = setReview(store, 'b', nextReview(undefined, 'fuzzy', NOW))
    const back = deserializeStore(serializeStore(store))

    expect(introducedToday(back.review, NOW)).toBe(2)
    // 第二天就不算「今天引入的」了
    expect(introducedToday(back.review, NOW + DAY)).toBe(0)
  })
})
