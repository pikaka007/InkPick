import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDictionaryTsv } from '@core/dictionary'
import { DEFAULT_SENSE_LIMITS, formatSenses, limitSynonyms, stripDomainMarkers, summarizeSenses } from '@core/senses'
import type { Sense } from '@core/types'

describe('stripDomainMarkers', () => {
  it('去掉方括号领域标记', () => {
    expect(stripDomainMarkers('[计] 字')).toBe('字')
    expect(stripDomainMarkers('用言辞表达 [计] 字')).toBe('用言辞表达 字')
    expect(stripDomainMarkers('[医][法] 姜')).toBe('姜')
    expect(stripDomainMarkers('【网络】 胡德')).toBe('胡德')
  })

  it('去掉词尾的语域标记', () => {
    expect(stripDomainMarkers('跑 (archaic)')).toBe('跑')
    expect(stripDomainMarkers('跑 (informal)')).toBe('跑')
  })

  it('不误伤正常内容', () => {
    expect(stripDomainMarkers('n. 阅读, 读物')).toBe('n. 阅读, 读物')
    expect(stripDomainMarkers('(使)组成')).toBe('(使)组成')
    expect(stripDomainMarkers('一种很长的[额外说明超过八个字]的文本')).toBe('一种很长的[额外说明超过八个字]的文本')
  })

  it('清掉剥标记后残留的分隔符', () => {
    expect(stripDomainMarkers('[计] , 字')).toBe('字')
    expect(stripDomainMarkers('字 [计]')).toBe('字')
  })
})

describe('limitSynonyms', () => {
  it('不超过上限时原样保留', () => {
    expect(limitSynonyms('读, 阅读', 3)).toBe('读, 阅读')
  })

  it('超长时截断并加省略号', () => {
    expect(limitSynonyms('跑, 赛跑, 奔跑, 奔跑的路程, 趋向', 3)).toBe('跑, 赛跑, 奔跑…')
  })

  it('中英文分隔符都认', () => {
    expect(limitSynonyms('甲；乙、丙，丁', 2)).toBe('甲, 乙…')
  })

  it('空串不炸', () => {
    expect(limitSynonyms('', 3)).toBe('')
    expect(limitSynonyms('  ', 3)).toBe('')
  })
})

describe('summarizeSenses', () => {
  const many: Sense[] = [
    { pos: 'n.', translation: '跑, 赛跑, 奔跑, 奔跑的路程, 趋向' },
    { pos: 'vi.', translation: '跑, 奔跑, 跑步' },
    { pos: 'vt.', translation: '跑, 经营, 管理' },
    { pos: 'a.', translation: '融化的' }
  ]

  it('限制义项条数', () => {
    expect(summarizeSenses(many, { maxSenses: 2, maxItems: 10 })).toHaveLength(2)
  })

  it('限制每条义项内的近义数', () => {
    const result = summarizeSenses(many, { maxSenses: 1, maxItems: 3 })
    expect(result[0].translation).toBe('跑, 赛跑, 奔跑…')
  })

  it('保留词性', () => {
    expect(summarizeSenses(many, { maxSenses: 2, maxItems: 2 })[1].pos).toBe('vi.')
  })

  it('剥标记后为空的义项被丢掉', () => {
    const result = summarizeSenses([
      { pos: 'n.', translation: '[计]' },
      { pos: 'n.', translation: '真正的内容' }
    ])
    expect(result).toEqual([{ pos: 'n.', translation: '真正的内容' }])
  })

  it('极端情况下全部被剥光时回退到原始义项，绝不返回空', () => {
    const result = summarizeSenses([{ pos: 'n.', translation: '[计]' }])
    expect(result).toHaveLength(1)
    expect(result[0].translation).toBe('[计]')
  })

  it('空输入返回空数组', () => {
    expect(summarizeSenses([])).toEqual([])
  })
})

describe('formatSenses', () => {
  it('拼成一行', () => {
    expect(
      formatSenses(
        [
          { pos: 'n.', translation: '阅读, 知识, 读物' },
          { pos: 'v.', translation: '读' }
        ],
        { maxSenses: 3, maxItems: 3 }
      )
    ).toBe('n. 阅读, 知识, 读物；v. 读')
  })

  it('没有词性时不加前缀', () => {
    expect(formatSenses([{ pos: '', translation: '匆忙' }])).toBe('匆忙')
  })
})

describe('对真实词库做整库校验', () => {
  const entries = parseDictionaryTsv(readFileSync(join(import.meta.dirname, '../resources/dictionary/mini.tsv'), 'utf-8'))

  it('任何词条的摘要都不会变成空串', () => {
    const broken: string[] = []
    for (const entry of entries.values()) {
      if (formatSenses(entry.senses).trim() === '') broken.push(entry.word)
    }
    expect(broken).toEqual([])
  })

  it('摘要后长度变短，长词条管得最有效', () => {
    const width = (text: string): number => [...text].length
    const rawOf = (senses: Sense[]): string =>
      senses.map((s) => (s.pos ? `${s.pos} ${s.translation}` : s.translation)).join('；')

    let rawTotal = 0
    let summarizedTotal = 0
    let longRaw = 0
    let longSummarized = 0

    for (const entry of entries.values()) {
      const raw = width(rawOf(entry.senses))
      const summarized = width(formatSenses(entry.senses))
      rawTotal += raw
      summarizedTotal += summarized
      // 真正难看的是长词条（卡片上占半屏），单独统计
      if (raw > 80) {
        longRaw += raw
        longSummarized += summarized
      }
    }

    expect(rawTotal).toBeGreaterThan(500_000)
    expect(longRaw).toBeGreaterThan(20_000)

    // 实测：整体 0.80（大量单义项短词本来就没东西可删）
    expect(summarizedTotal / rawTotal).toBeLessThan(0.85)
    // 实测：长词条 0.58；run 0.28、strike 0.42 是最极端的一类
    expect(longSummarized / longRaw).toBeLessThan(0.65)
  })

  it('关键含义不会被摘要弄丢', () => {
    const check = (word: string, expected: string): void => {
      const entry = entries.get(word)
      expect(entry, `${word} 应该在词库里`).toBeDefined()
      expect(formatSenses(entry!.senses), `${word} 的摘要里应含「${expected}」`).toContain(expected)
    }

    check('run', '跑')
    check('reading', '阅读')
    check('word', '词')
    check('strike', '罢工')
    check('habit', '习惯')
    check('gist', '要点')
  })

  it('领域标记不再出现在摘要里', () => {
    const leaked: string[] = []
    for (const entry of entries.values()) {
      if (/\[[^\]]{1,8}\]/.test(formatSenses(entry.senses))) leaked.push(entry.word)
    }
    expect(leaked).toEqual([])
  })

  it('默认上限就是 3 义项 / 3 近义', () => {
    expect(DEFAULT_SENSE_LIMITS).toEqual({ maxSenses: 3, maxItems: 3 })
  })
})
