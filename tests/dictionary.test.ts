import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDictionary,
  exchangeForms,
  normalizeWord,
  parseDictionaryTsv,
  parseEcdictCsv,
  parseExchange,
  parseLemmaFile,
  parseLemmaIndex,
  parseTranslation,
  serializeDictionary,
  serializeLemmaIndex
} from '@core/dictionary'
import type { DictionaryData } from '@core/dictionary'

const RESOURCES = join(import.meta.dirname, '../resources/dictionary')

describe('normalizeWord', () => {
  it('小写并去掉首尾标点', () => {
    expect(normalizeWord('  Reading,  ')).toBe('reading')
    expect(normalizeWord('"hurry!"')).toBe('hurry')
    expect(normalizeWord('(context)')).toBe('context')
  })

  it('去掉所有格', () => {
    expect(normalizeWord("reader's")).toBe('reader')
    expect(normalizeWord('readers’')).toBe('readers')
    expect(normalizeWord("readers'")).toBe('readers')
  })

  it('保留词内部的连字符与撇号', () => {
    expect(normalizeWord("well-known")).toBe('well-known')
    expect(normalizeWord("don't")).toBe("don't")
  })

  it('处理不了的东西返回空串', () => {
    expect(normalizeWord('   ')).toBe('')
    expect(normalizeWord('——')).toBe('')
  })
})

describe('parseExchange / exchangeForms', () => {
  it('解析 ECDICT 的 exchange 编码', () => {
    expect(parseExchange('p:ran/d:run/i:running/3:runs')).toEqual([
      { code: 'p', value: 'ran' },
      { code: 'd', value: 'run' },
      { code: 'i', value: 'running' },
      { code: '3', value: 'runs' }
    ])
  })

  it('取变形词时排除自己与「原形」指针', () => {
    // p:ran 的 p 是过去式；0:run 是原形指针，不是变形词
    const forms = exchangeForms('p:ran/0:run/1:i', 'run')
    expect(forms).toEqual(['ran'])
  })

  it('空字段不炸', () => {
    expect(parseExchange('')).toEqual([])
    expect(exchangeForms('', 'run')).toEqual([])
    expect(parseExchange('badformat/:/x:')).toEqual([])
  })
})

describe('parseTranslation', () => {
  it('按词性拆成义项', () => {
    expect(parseTranslation('n. 奔跑\\nv. 经营')).toEqual([
      { pos: 'n.', translation: '奔跑' },
      { pos: 'v.', translation: '经营' }
    ])
  })

  it('真实换行与字面量 \\n 都认', () => {
    expect(parseTranslation('n. 奔跑\nv. 经营')).toHaveLength(2)
  })

  it('没有词性的行并入上一条义项', () => {
    expect(parseTranslation('n. 奔跑\\n[网络] 跑')).toEqual([{ pos: 'n.', translation: '奔跑 [网络] 跑' }])
  })

  it('整段没有词性时也是一条义项', () => {
    expect(parseTranslation('匆忙, 急忙')).toEqual([{ pos: '', translation: '匆忙, 急忙' }])
  })

  it('清掉 \\r 转义留下的垃圾字符', () => {
    // ECDICT 里存在 `...第一的\r\nart. ...` 这种字面量转义
    const senses = parseTranslation('第一个字母\\r\\nart. 一个')
    expect(senses[0].translation).toBe('第一个字母')
    expect(senses[1]).toEqual({ pos: 'art.', translation: '一个' })
  })

  it('空串返回空数组', () => {
    expect(parseTranslation('')).toEqual([])
    expect(parseTranslation('\\n\\n')).toEqual([])
  })
})

describe('createDictionary.lookup', () => {
  const data: DictionaryData = {
    entries: new Map([
      [
        'run',
        { word: 'run', phonetic: 'rʌn', senses: [{ pos: 'v.', translation: '跑' }], collins: 5, frq: 100 }
      ],
      [
        'reading',
        { word: 'reading', phonetic: 'ˈriːdɪŋ', senses: [{ pos: 'n.', translation: '阅读' }], collins: 4, frq: 300 }
      ]
    ]),
    lemmaOf: new Map([['ran', 'run']])
  }
  const dictionary = createDictionary(data)

  it('精确命中时用自己的词条', () => {
    const result = dictionary.lookup('reading')
    expect(result.match).toBe('exact')
    expect(result.lemma).toBe('reading')
    expect(result.entry?.phonetic).toBe('ˈriːdɪŋ')
  })

  it('词形变体还原到原形，用原形的词条', () => {
    const result = dictionary.lookup('ran')
    expect(result.match).toBe('lemma')
    expect(result.lemma).toBe('run')
    expect(result.entry?.senses[0].translation).toBe('跑')
  })

  it('查询前会归一化', () => {
    expect(dictionary.lookup('  RUN, ').match).toBe('exact')
  })

  it('查不到时 lemma 退化为归一化结果，不抛错', () => {
    const result = dictionary.lookup('zzzzz')
    expect(result).toEqual({
      query: 'zzzzz',
      normalized: 'zzzzz',
      lemma: 'zzzzz',
      match: 'none',
      entry: null
    })
  })

  it('词形映射指向不存在的原形时算查不到', () => {
    const broken = createDictionary({ entries: new Map(), lemmaOf: new Map([['ran', 'run']]) })
    expect(broken.lookup('ran')).toMatchObject({ match: 'none', lemma: 'run', entry: null })
  })

  it('size 反映词条数', () => {
    expect(dictionary.size).toBe(2)
  })
})

describe('parseEcdictCsv', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'run,rʌn,,v. 跑,n,5,1,,100,10,p:ran/i:running,,',
    'reading,ˈriːdɪŋ,,n. 阅读,n,4,,,200,300,,,',
    'obscure,əbˈskjʊə,,adj. 晦涩,c,0,,,50000,50000,,,'
  ].join('\n')

  it('建立词条', () => {
    const data = parseEcdictCsv(csv)
    expect(data.entries.size).toBe(3)
    expect(data.entries.get('run')?.senses[0]).toEqual({ pos: 'v.', translation: '跑' })
  })

  it('用 exchange 建词形索引', () => {
    const data = parseEcdictCsv(csv)
    expect(data.lemmaOf.get('ran')).toBe('run')
    expect(data.lemmaOf.get('running')).toBe('run')
  })

  it('本身能独立成词的词形不归并（避免 left → leave 这类误判）', () => {
    const withForms = `${csv}\nleft,left,,adj. 左边的,a,4,,,500,500,d:leave`
    const data = parseEcdictCsv(withForms)
    expect(data.lemmaOf.has('left')).toBe(false)
    expect(data.entries.get('left')?.senses[0].translation).toBe('左边的')
  })

  it('select 回调可以裁词库', () => {
    const data = parseEcdictCsv(csv, { select: (info) => info.frq > 0 && info.frq <= 1000 })
    expect([...data.entries.keys()]).toEqual(['run', 'reading'])
  })

  it('select 裁掉的词不会出现在词形索引里', () => {
    const rows = `${csv}\nran,ræn,,跑过去,,0,,,0,0,`
    const data = parseEcdictCsv(rows, { select: (info) => info.word !== 'obscure' && info.word !== 'ran' })
    expect(data.entries.has('ran')).toBe(false)
    expect(data.lemmaOf.get('ran')).toBe('run')
  })

  it('extraLemma 只补词库里的原形', () => {
    const data = parseEcdictCsv(csv, { extraLemma: new Map([['ran', 'run'], ['ghost', 'nowhere']]) })
    expect(data.lemmaOf.get('ran')).toBe('run')
    expect(data.lemmaOf.has('ghost')).toBe(false)
  })

  it('表头不对时返回空数据而不是抛错', () => {
    expect(parseEcdictCsv('a,b\n1,2').entries.size).toBe(0)
    expect(parseEcdictCsv('').entries.size).toBe(0)
  })

  it('没有释义的行被丢掉', () => {
    const data = parseEcdictCsv('word,phonetic,translation\nempty,,')
    expect(data.entries.size).toBe(0)
  })
})

describe('TSV 往返', () => {
  it('词条序列化后能原样解析回来', () => {
    const original = parseEcdictCsv(
      'word,phonetic,translation,collins,frq\nrun,rʌn,v. 跑\\nn. 奔跑,5,10\nreading,,n. 阅读,4,300'
    )
    const restored = parseDictionaryTsv(serializeDictionary(original.entries))

    expect(restored.size).toBe(2)
    expect(restored.get('run')).toEqual(original.entries.get('run'))
    expect(restored.get('reading')?.senses[0].translation).toBe('阅读')
  })

  it('词形索引往返一致', () => {
    const map = new Map([['ran', 'run'], ['runs', 'run']])
    expect(parseLemmaIndex(serializeLemmaIndex(map))).toEqual(map)
  })

  it('解析 TSV 时容忍空行与残缺行', () => {
    expect(parseDictionaryTsv('run\trʌn\tv. 跑\t5\t10\n\n残缺行\n').size).toBe(1)
    expect(parseLemmaIndex('ran\trun\n坏行\n').size).toBe(1)
  })
})

describe('parseLemmaFile', () => {
  it('解析 form -> lemma，跳过注释行', () => {
    const text = '; 注释\n; 还有注释\nran -> run\nreading -> read\n坏行\n'
    expect(parseLemmaFile(text)).toEqual(new Map([['ran', 'run'], ['reading', 'read']]))
  })
})

describe('内置 mini 词库（真实产物）', () => {
  const dictionary = createDictionary({
    entries: parseDictionaryTsv(readFileSync(join(RESOURCES, 'mini.tsv'), 'utf-8')),
    lemmaOf: parseLemmaIndex(readFileSync(join(RESOURCES, 'lemma.tsv'), 'utf-8'))
  })

  it('词条数量在合理范围', () => {
    expect(dictionary.size).toBeGreaterThan(20_000)
  })

  it('常用词查得到，且带着音标与释义', () => {
    for (const word of ['read', 'run', 'hurry', 'annotate', 'context', 'book', 'note', 'word']) {
      const result = dictionary.lookup(word)
      expect(result.match, `${word} 应该查得到`).toBe('exact')
      expect(result.entry?.senses.length, `${word} 应该有释义`).toBeGreaterThan(0)
    }
    expect(dictionary.lookup('run').entry?.phonetic).not.toBe('')
  })

  it('把读到一半的书里的词也拿来做回归', () => {
    const result = dictionary.lookup('Reading')
    expect(result.entry).not.toBeNull()
    expect(result.entry?.senses[0].translation).toContain('阅读')
  })

  it('词形变体还原到原形', () => {
    const result = dictionary.lookup('runs')
    if (result.match === 'lemma') {
      expect(result.lemma).toBe('run')
      expect(result.entry?.word).toBe('run')
    } else {
      // 如果 ECDICT 里 runs 本身有词条，也必须给得出释义
      expect(result.entry).not.toBeNull()
    }
  })

  it('释义里不残留 \\r 之类的转义垃圾', () => {
    const entry = dictionary.lookup('a').entry
    expect(entry).not.toBeNull()
    for (const sense of entry!.senses) {
      expect(sense.translation).not.toContain('\\r')
      expect(sense.translation).not.toContain('\\n')
    }
  })
})
