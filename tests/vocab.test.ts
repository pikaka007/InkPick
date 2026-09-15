import { describe, expect, it } from 'vitest'
import { createAnchor } from '@core/anchor'
import { groupDefinition, groupVocab, needsManualDefinition } from '@core/vocab'
import type { Annotation, LookupStatus } from '@core/types'

const CONTENT = 'run run run runs runs'

function vocab(overrides: Partial<Annotation> & { term: string; start: number }): Annotation {
  const { start, ...rest } = overrides
  const end = start + rest.term.length
  return {
    id: `a-${start}`,
    docId: 'doc-1',
    type: 'vocab',
    anchor: createAnchor(CONTENT, start, end),
    contextText: CONTENT.slice(start, end),
    createdAt: 1000 + start,
    updatedAt: 1000 + start,
    lookupStatus: 'pending',
    ...rest
  }
}

describe('groupVocab', () => {
  it('按 lemma 归并，同一个词收多次只出现一组', () => {
    const groups = groupVocab([
      vocab({ term: 'run', lemma: 'run', start: 0, lookupStatus: 'found' }),
      vocab({ term: 'runs', lemma: 'run', start: 8, lookupStatus: 'found' }),
      vocab({ term: 'runs', lemma: 'run', start: 13, lookupStatus: 'found' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].lemma).toBe('run')
    expect(groups[0].items).toHaveLength(3)
  })

  it('同一组内按原文位置排序，而不是收藏时间', () => {
    const groups = groupVocab([
      vocab({ term: 'runs', lemma: 'run', start: 13, createdAt: 1 }),
      vocab({ term: 'run', lemma: 'run', start: 0, createdAt: 2 })
    ])
    expect(groups[0].items.map((item) => item.anchor.start)).toEqual([0, 13])
  })

  it('跨文档时先按书分组（按首次标注的先后），组内按位置', () => {
    const inDoc = (docId: string, start: number): Annotation => ({
      ...vocab({ term: 'runs', lemma: 'run', start }),
      docId
    })

    const groups = groupVocab([inDoc('doc-a', 10), inDoc('doc-b', 0), inDoc('doc-a', 0)])

    // doc-a 先被标注，它的两条排在一起；两本书不能交错
    expect(groups[0].items.map((item) => item.docId)).toEqual(['doc-a', 'doc-a', 'doc-b'])
    expect(groups[0].items.map((item) => item.anchor.start)).toEqual([0, 10, 0])
  })

  it('没有 lemma 时退回 term 分组', () => {
    const groups = groupVocab([vocab({ term: 'habit', start: 0 }), vocab({ term: 'Habit', start: 8 })])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('habit')
  })

  it('笔记不参与分组', () => {
    const groups = groupVocab([{ ...vocab({ term: 'run', start: 0 }), type: 'note' }])
    expect(groups).toHaveLength(0)
  })

  it('组内取信息最全的那条：音标 / 释义 / 手写释义都能补上', () => {
    const groups = groupVocab([
      vocab({ term: 'run', lemma: 'run', start: 0, lookupStatus: 'pending' }),
      vocab({
        term: 'runs',
        lemma: 'run',
        start: 8,
        lookupStatus: 'found',
        phonetic: 'rʌn',
        senses: [{ pos: 'v.', translation: '跑' }]
      })
    ])

    expect(groups[0].phonetic).toBe('rʌn')
    expect(groups[0].senses).toEqual([{ pos: 'v.', translation: '跑' }])
    expect(groups[0].status).toBe('found')
  })

  it('状态取最靠后的那个（found > missing > pending）', () => {
    const pair = (a: LookupStatus, b: LookupStatus): LookupStatus =>
      groupVocab([
        vocab({ term: 'x', lemma: 'x', start: 0, lookupStatus: a }),
        vocab({ term: 'x', lemma: 'x', start: 2, lookupStatus: b })
      ])[0].status

    expect(pair('pending', 'missing')).toBe('missing')
    expect(pair('missing', 'found')).toBe('found')
    expect(pair('found', 'pending')).toBe('found')
    expect(pair('missing', 'pending')).toBe('missing')
  })

  it('不同词分成多组，按首次收藏顺序排列', () => {
    const groups = groupVocab([
      vocab({ term: 'runs', lemma: 'run', start: 8, createdAt: 200 }),
      vocab({ term: 'habit', lemma: 'habit', start: 0, createdAt: 100 })
    ])
    expect(groups.map((group) => group.key)).toEqual(['habit', 'run'])
  })

  it('空输入返回空数组', () => {
    expect(groupVocab([])).toEqual([])
  })
})

describe('groupDefinition', () => {
  it('有词典释义时优先用词典，最多三条', () => {
    const groups = groupVocab([
      vocab({
        term: 'run',
        lemma: 'run',
        start: 0,
        lookupStatus: 'found',
        senses: [
          { pos: 'v.', translation: '跑' },
          { pos: 'n.', translation: '奔跑' },
          { pos: 'v.', translation: '经营' },
          { pos: 'n.', translation: '一段' }
        ]
      })
    ])
    expect(groupDefinition(groups[0])).toBe('v. 跑；n. 奔跑；v. 经营')
  })

  it('词典没有时用手写释义', () => {
    const groups = groupVocab([
      vocab({ term: 'inkpick', lemma: 'inkpick', start: 0, lookupStatus: 'missing', manualDefinition: '本项目' })
    ])
    expect(groupDefinition(groups[0])).toBe('本项目')
  })

  it('两样都没有时返回空串', () => {
    const groups = groupVocab([vocab({ term: 'zzz', lemma: 'zzz', start: 0, lookupStatus: 'missing' })])
    expect(groupDefinition(groups[0])).toBe('')
  })
})

describe('needsManualDefinition', () => {
  const build = (annotation: Annotation): ReturnType<typeof groupVocab>[number] => groupVocab([annotation])[0]

  it('词典没收录且没手写时要补', () => {
    expect(needsManualDefinition(build(vocab({ term: 'zzz', start: 0, lookupStatus: 'missing' })))).toBe(true)
  })

  it('查到了就不用补', () => {
    const annotation = vocab({
      term: 'run',
      start: 0,
      lookupStatus: 'found',
      senses: [{ pos: 'v.', translation: '跑' }]
    })
    expect(needsManualDefinition(build(annotation))).toBe(false)
  })

  it('手写过就不用补', () => {
    const annotation = vocab({ term: 'zzz', start: 0, lookupStatus: 'missing', manualDefinition: '自定义' })
    expect(needsManualDefinition(build(annotation))).toBe(false)
  })

  it('刚收藏还没查时不催用户补', () => {
    expect(needsManualDefinition(build(vocab({ term: 'run', start: 0, lookupStatus: 'pending' })))).toBe(false)
  })
})
