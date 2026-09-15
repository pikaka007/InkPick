/**
 * 释义摘要 —— 纯展示层处理。
 *
 * ECDICT 的 `translation` 是给词典软件用的，直接拿来当卡片太吵：
 *
 *   run    → n. 跑, 赛跑, 奔跑, 奔跑的路程, 趋向, 流出, 运转；vi. 跑, 奔跑, 跑步…；vt. ...
 *   strike → n. 罢工, 打击, 殴打；vt. 打, 撞击, 冲击, 侵袭, 取消, 结算, 打掉, 罢工, 刺透...
 *
 * 实测（整库 23,900 词条）：
 * - 整体 567,861 字 → 456,437 字（0.80）—— 大量单义项短词本来就没东西可删
 * - 长词条（原文 > 80 字）0.58，**这才是卡片变丑的根源**；
 *   最极端的 run 155→44 字（0.28）、strike 101→42 字（0.42）
 *
 * 噪音主要来自**义项内部的近义罗列**，而不是义项条数
 * （23,900 个词条里 18,254 个只有 1 条义项）。
 *
 * 重要：这里只做**展示用**的收敛，存储里的 `senses` 始终是完整的。
 * 所以将来想加「展开完整释义」不需要重新查词库。
 */
import type { Sense } from './types'

export interface SenseLimits {
  /** 最多显示几条义项 */
  maxSenses: number
  /** 每条义项内最多保留几个近义 */
  maxItems: number
}

export const DEFAULT_SENSE_LIMITS: SenseLimits = { maxSenses: 3, maxItems: 3 }

/**
 * 去掉领域标记：`[计]` `[法]` `[网络]` `【医】`
 * 以及词尾的语域标记 `(archaic)` `(slang)`
 */
export function stripDomainMarkers(text: string): string {
  return text
    .replace(/\[[^\]]{1,8}\]/g, '')
    .replace(/【[^】]{1,8}】/g, '')
    .replace(/\([a-z][a-z.\s]{1,12}\)\s*$/i, '')
    .replace(/^[\s,，;；、.]+/, '')
    .replace(/[\s,，;；、]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 近义罗列太长时截断，保留前几个 */
export function limitSynonyms(text: string, max: number): string {
  const parts = text
    .split(/[,，;；、]/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length <= max) return text.trim()
  return `${parts.slice(0, max).join(', ')}…`
}

/**
 * 收敛义项。去掉领域标记后为空的义项直接丢弃；
 * 若全部被丢光（极端情况），回退到第一条原始义项，宁可显示原文也不能显示空。
 */
export function summarizeSenses(senses: Sense[], limits: SenseLimits = DEFAULT_SENSE_LIMITS): Sense[] {
  const summarized: Sense[] = []

  for (const sense of senses) {
    if (summarized.length >= limits.maxSenses) break

    const text = limitSynonyms(stripDomainMarkers(sense.translation), limits.maxItems)
    if (!text) continue
    summarized.push({ pos: sense.pos, translation: text })
  }

  if (summarized.length === 0 && senses.length > 0) {
    return [{ pos: senses[0].pos, translation: senses[0].translation.trim() }]
  }
  return summarized
}

/** 摘要并拼成一行，供界面与导出共用 */
export function formatSenses(senses: Sense[], limits: SenseLimits = DEFAULT_SENSE_LIMITS): string {
  return summarizeSenses(senses, limits)
    .map((sense) => (sense.pos ? `${sense.pos} ${sense.translation}` : sense.translation))
    .join('；')
}
