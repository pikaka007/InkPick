import { describe, expect, it } from 'vitest'
import { parseCsv, parseCsvRecords } from '@core/csv'

describe('parseCsv', () => {
  it('解析基本表格', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('保留空字段', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']])
    expect(parseCsv(',,')).toEqual([['', '', '']])
  })

  it('引号内可以有逗号和换行', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']])
    expect(parseCsv('"line1\nline2",c')).toEqual([['line1\nline2', 'c']])
  })

  it('两个连续引号表示一个字面引号', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']])
  })

  it('CRLF 与 LF 都能作为行分隔符', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('结尾换行不产生多余的空行', () => {
    expect(parseCsv('a\n1\n')).toHaveLength(2)
  })

  it('末尾没有换行时也能收下最后一条记录', () => {
    expect(parseCsv('a\n1')).toEqual([['a'], ['1']])
  })

  it('默认容错：未加引号的字段里出现引号不会被当成语法', () => {
    // ECDICT 里真实存在的脏数据形态
    expect(parseCsv('[医] "姜",x')).toEqual([['[医] "姜"', 'x']])
  })

  it('关掉容错后，引号出现在字段中间会原样保留而不吞掉后续内容', () => {
    const rows = parseCsv('a"b,c', { lenientQuotes: false })
    expect(rows).toEqual([['a"b', 'c']])
  })

  it('容错模式下脏引号不会让后续行错位', () => {
    const csv = 'w,note\nfoo,"正常"\nbar,[医] "姜"\nbaz,"带,逗号"'
    expect(parseCsv(csv)).toEqual([
      ['w', 'note'],
      ['foo', '正常'],
      ['bar', '[医] "姜"'],
      ['baz', '带,逗号']
    ])
  })

  it('空文本返回空数组', () => {
    expect(parseCsv('')).toEqual([])
  })
})

describe('parseCsvRecords', () => {
  it('按表头转成对象，缺失列补空串', () => {
    const records = parseCsvRecords('word,phonetic,translation\nrun,rʌn,跑\nread,,读\n')
    expect(records).toEqual([
      { word: 'run', phonetic: 'rʌn', translation: '跑' },
      { word: 'read', phonetic: '', translation: '读' }
    ])
  })

  it('表头以外多出来的列被忽略，缺的列补空串', () => {
    expect(parseCsvRecords('a,b\n1,2,3')).toEqual([{ a: '1', b: '2' }])
    expect(parseCsvRecords('a,b\n1')).toEqual([{ a: '1', b: '' }])
  })

  it('空文本返回空数组', () => {
    expect(parseCsvRecords('')).toEqual([])
  })
})
