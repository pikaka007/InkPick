/**
 * 复习调度 —— 纯函数，不碰 DOM 也不碰文件系统。
 *
 * 用间隔重复（SM-2 的简化版）回答一个问题：**这个词该什么时候再出现一次。**
 * 三档评分，间隔按「记得」逐次拉长，忘掉就退回起点。
 *
 * 两个刻意的设计决定：
 *
 * 1. **复习的对象是「词」，不是「标注」。**
 *    同一个词在 3 本书里收过 → 3 条标注、1 个分组。如果按标注存复习状态，
 *    这个词会有 3 份独立的到期时间，你得复习它 3 次。
 *    所以状态按分组的 key（lemma）存，见 Store.review。
 *
 * 2. **「新词」和「到期」是同一个队列的两段。**
 *    「每天背 N 个」不是另一种模式，它只是限制每天往里放多少个新词；
 *    到期的一定会排在新词前面。
 */
import type { ReviewState } from './types'

export type ReviewGrade = 'forgot' | 'fuzzy' | 'remembered'

/** 初始难度系数。越大说明这个词对你越容易，间隔涨得越快 */
export const DEFAULT_EASE = 2.5
export const MIN_EASE = 1.3
export const MAX_EASE = 3.0
/** 间隔上限，不然几个月后会算出「两年后」这种没有意义的数字 */
export const MAX_INTERVAL_DAYS = 365
/**
 * 忘了之后多久重新出现。
 * 太短会在一次会话里反复弹同一张卡；太长就等于今天不管它了。
 */
export const RELEARN_DELAY_MS = 5 * 60 * 1000
/** 每天最多引入多少个新词。这是需要按真实手感调的参数 */
export const DEFAULT_DAILY_NEW = 10
/** 上限的合法范围：0 = 今天只清到期，不引入新词 */
export const MIN_DAILY_NEW = 0
export const MAX_DAILY_NEW = 50

/**
 * 复习范围 —— 哪些词参与复习。
 *
 * all    全部词（默认）
 * doc    只看当前这本书里的词（读大部头时不想被别的书的词打扰）
 * manual 只看手动记的词（自己那份考试词表）
 */
export type ReviewScope = 'all' | 'doc' | 'manual'

export interface ReviewSettings {
  dailyNew: number
  scope: ReviewScope
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { dailyNew: DEFAULT_DAILY_NEW, scope: 'all' }

export const REVIEW_SCOPES: readonly ReviewScope[] = ['all', 'doc', 'manual']
export const REVIEW_SCOPE_LABELS: Record<ReviewScope, string> = {
  all: '全部',
  doc: '本书',
  manual: '手动'
}

/** 手改过的存档 / 旧数据都可能带来非法值，这里收敛回合法范围 */
export function normalizeReviewSettings(input: Partial<ReviewSettings> | undefined): ReviewSettings {
  const settings = input ?? {}
  const dailyNew =
    typeof settings.dailyNew === 'number' && Number.isFinite(settings.dailyNew)
      ? Math.round(clamp(settings.dailyNew, MIN_DAILY_NEW, MAX_DAILY_NEW))
      : DEFAULT_DAILY_NEW
  const scope = REVIEW_SCOPES.includes(settings.scope as ReviewScope)
    ? (settings.scope as ReviewScope)
    : DEFAULT_REVIEW_SETTINGS.scope
  return { dailyNew, scope }
}

const DAY_MS = 24 * 60 * 60 * 1000

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampEase(ease: number): number {
  return clamp(ease, MIN_EASE, MAX_EASE)
}

function daysToMs(days: number): number {
  return Math.round(clamp(days, 0, MAX_INTERVAL_DAYS) * DAY_MS)
}

/** 本地时间的今天零点。用本地时间是因为「每天 N 个」是按人的作息算的 */
export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * 评一次分，算出新的复习状态。
 *
 * previous 为 undefined 表示这是个新词，第一次被复习。
 */
export function nextReview(previous: ReviewState | undefined, grade: ReviewGrade, now: number): ReviewState {
  const state: ReviewState = previous ?? {
    due: now,
    interval: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
    firstAt: now,
    reviewedAt: now
  }

  if (grade === 'forgot') {
    return {
      ...state,
      // 间隔归零、今天稍后再来一次
      due: now + RELEARN_DELAY_MS,
      interval: 0,
      ease: clampEase(state.ease - 0.2),
      reps: 0,
      lapses: state.lapses + 1,
      reviewedAt: now
    }
  }

  if (grade === 'fuzzy') {
    // 记住了但不熟：让间隔慢慢涨，同时把难度系数压一点
    const interval = clamp(Math.max(1, Math.round(state.interval * 1.2)), 1, MAX_INTERVAL_DAYS)
    return {
      ...state,
      interval,
      due: now + daysToMs(interval),
      ease: clampEase(state.ease - 0.05),
      reps: state.reps + 1,
      reviewedAt: now
    }
  }

  // remembered：第一次 1 天、第二次 3 天，之后按难度系数乘
  const ease = clampEase(state.ease + 0.1)
  const interval =
    state.reps === 0 ? 1 : state.reps === 1 ? 3 : clamp(Math.round(state.interval * ease), 1, MAX_INTERVAL_DAYS)

  return {
    ...state,
    interval,
    due: now + daysToMs(interval),
    ease,
    reps: state.reps + 1,
    reviewedAt: now
  }
}

/** 到期了没有 */
export function isDue(state: ReviewState, now: number): boolean {
  return state.due <= now
}

export interface ReviewQueue {
  /** 该复习的词（按过期程度排，最该复习的在前） */
  due: string[]
  /** 今天还能引入的新词 */
  fresh: string[]
  /** 因为每日上限今天不引入的新词数量 */
  deferred: number
}

export interface QueueOptions {
  now: number
  dailyNewLimit?: number
}

/** 今天已经引入过多少个新词。「引入」= 第一次复习，用 firstAt 判断 */
export function introducedToday(review: Record<string, ReviewState>, now: number, keys?: string[]): number {
  const dayStart = startOfDay(now)
  // 给了 keys 就只数这些词 —— 名额是按「当前范围」算的，
  // 不然换个范围会莫名其妙地没名额（早上复习的是别的范围内的词）
  const entries = keys ? keys.map((key) => review[key]) : Object.values(review)
  let count = 0
  for (const state of entries) {
    if (state && state.firstAt >= dayStart) count++
  }
  return count
}

/**
 * 攒出这次的复习队列。
 *
 * @param keys 词表里全部分组的 key，**顺序就是词的收藏顺序**（新词按它排队）
 * @param review 复习状态
 */
export function buildReviewQueue(
  keys: string[],
  review: Record<string, ReviewState>,
  options: QueueOptions
): ReviewQueue {
  const limit = options.dailyNewLimit ?? DEFAULT_DAILY_NEW
  const due: { key: string; due: number }[] = []
  const fresh: string[] = []

  for (const key of keys) {
    const state = review[key]
    if (!state) {
      fresh.push(key)
      continue
    }
    if (isDue(state, options.now)) due.push({ key, due: state.due })
  }

  // 过期最久的先来 —— 那是最快要忘的
  due.sort((a, b) => a.due - b.due)

  const room = Math.max(0, limit - introducedToday(review, options.now, keys))
  return {
    due: due.map((item) => item.key),
    fresh: fresh.slice(0, room),
    deferred: Math.max(0, fresh.length - room)
  }
}

/** 到某个时间点为止会到期的个数。复习完那一屏用来说「接下来还有多少」 */
export function dueBefore(keys: string[], review: Record<string, ReviewState>, timestamp: number): number {
  let count = 0
  for (const key of keys) {
    const state = review[key]
    if (state && state.due <= timestamp) count++
  }
  return count
}

/** 队列总数：侧栏那个「待复习 N」显示的就是它 */
export function queueSize(queue: ReviewQueue): number {
  return queue.due.length + queue.fresh.length
}

/** 刚评完分之后，下次什么时候见 —— 面板里给一句反馈 */
export function describeNextDue(state: ReviewState, now: number): string {
  if (state.interval === 0) return `${Math.round(RELEARN_DELAY_MS / 60000)} 分钟后再来`
  if (state.due <= now) return '待复习'
  const days = Math.max(1, Math.round((state.due - now) / DAY_MS))
  if (days === 1) return '明天再见'
  if (days < 30) return `${days} 天后再见`
  return `${Math.round(days / 30)} 个月后再见`
}
