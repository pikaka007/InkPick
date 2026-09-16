import { describe, expect, it } from 'vitest'
import { describeEncoding, decodeText } from '@core/decode'

/** UTF-8 字节 */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** GBK 字节。TextEncoder 只会编码 UTF-8，所以这里直接写字节 —— 反查过是正确的 */
const GBK = {
  中文: [0xd6, 0xd0, 0xce, 0xc4],
  第一章: [0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2],
  正文第一段: [0xd5, 0xfd, 0xce, 0xc4, 0xb5, 0xda, 0xd2, 0xbb, 0xb6, 0xce]
}

const gbk = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat())

describe('decodeText', () => {
  it('纯 ASCII 按 UTF-8，并标记为猜的', () => {
    const result = decodeText(utf8('Hello world.'))
    expect(result.text).toBe('Hello world.')
    expect(result.encoding).toBe('utf-8')
    // 没有 BOM，所以是试出来的
    expect(result.guessed).toBe(true)
  })

  it('UTF-8 中文正常', () => {
    const result = decodeText(utf8('第一章 重生'))
    expect(result.text).toBe('第一章 重生')
    expect(result.encoding).toBe('utf-8')
  })

  it('★ GBK 中文不会再变成乱码', () => {
    const result = decodeText(gbk(GBK.第一章, [0x20], GBK.正文第一段))
    expect(result.text).toBe('第一章 正文第一段')
    expect(result.encoding).toBe('gb18030')
  })

  it('★ GBK 的全角标点也对', () => {
    // 「中文。」—— 全角句号在 GBK 里是 A1A3
    const result = decodeText(gbk(GBK.中文, [0xa1, 0xa3]))
    expect(result.text).toBe('中文。')
  })

  describe('BOM', () => {
    it('UTF-8 BOM 被丢掉，且不算猜', () => {
      const result = decodeText(gbk([0xef, 0xbb, 0xbf], [...utf8('中文')]))
      expect(result.text).toBe('中文')
      expect(result.encoding).toBe('utf-8')
      expect(result.guessed).toBe(false)
    })

    it('带 BOM 时不能把 BOM 留在正文里', () => {
      // BOM 留在正文会让全文偏移整体差一格，所有标注跟着错位
      const result = decodeText(gbk([0xef, 0xbb, 0xbf], [...utf8('第一章')]))
      expect(result.text.startsWith('\uFEFF')).toBe(false)
      expect(result.text.length).toBe(3)
    })

    it('UTF-16 LE', () => {
      const result = decodeText(gbk([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]))
      expect(result.text).toBe('中文')
      expect(result.encoding).toBe('utf-16le')
      expect(result.guessed).toBe(false)
    })

    it('UTF-16 BE', () => {
      const result = decodeText(gbk([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]))
      expect(result.text).toBe('中文')
      expect(result.encoding).toBe('utf-16be')
      expect(result.guessed).toBe(false)
    })
  })

  it('空文件返回空串，不报错', () => {
    const result = decodeText(new Uint8Array([]))
    expect(result.text).toBe('')
    expect(result.encoding).toBe('utf-8')
  })

  it('GBK 文件不会因为「恰好能当 UTF-8 解」而蒙混过关', () => {
    // 这是整个方案的关键假设：合法 UTF-8 中文不可能由 GBK 中文字节偶然构成。
    // 一串常见汉字的 GBK 字节全部能通过严格 UTF-8 校验的概率极低；
    // 这里用一段较长的 GBK 文本把这条守住。
    const long = gbk(
      GBK.第一章,
      [0x20],
      GBK.正文第一段,
      [0xa1, 0xa3],
      GBK.正文第一段,
      [0xa1, 0xa3],
      GBK.中文
    )
    expect(decodeText(long).encoding).toBe('gb18030')
  })
})

describe('describeEncoding', () => {
  it('UTF-8 没什么好说的，不打扰用户', () => {
    expect(describeEncoding({ text: '', encoding: 'utf-8', guessed: true })).toBe('')
    expect(describeEncoding({ text: '', encoding: 'utf-8', guessed: false })).toBe('')
  })

  it('换了编码要说出来，而且说明是猜的', () => {
    expect(describeEncoding({ text: '', encoding: 'gb18030', guessed: true })).toContain('GBK')
    expect(describeEncoding({ text: '', encoding: 'gb18030', guessed: true })).toContain('推测')
    // 有 BOM 时是确定的，不用带「推测」
    expect(describeEncoding({ text: '', encoding: 'utf-16le', guessed: false })).not.toContain('推测')
  })
})
