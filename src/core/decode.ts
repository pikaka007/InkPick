/**
 * 文本编码识别 —— 纯函数，不碰文件系统（读文件是 shell 层的事）。
 *
 * 为什么需要它：国内大量 TXT 小说是 GBK / GB18030。按 UTF-8 硬读会得到一片
 * 「���ġ�」，而且**症状会伪装成别的功能的 bug** ——
 * 章节识别认出 0 章、词典查不到词、划词划出来是乱码。
 * 用户会以为是那些功能没做对，其实是文件没读对。
 *
 * 判断顺序（先看确定的，再看猜的）：
 *   1. UTF-8 BOM      → UTF-8
 *   2. UTF-16 BOM     → UTF-16
 *   3. UTF-8 严格试解 → 能过就是 UTF-8
 *   4. 以上都不是     → GB18030
 *
 * 第 3 步是这个方案的关键：**合法的 UTF-8 中文不可能由 GBK 中文字节偶然构成**，
 * 所以「严格试解」是一个可靠的分界线，不需要统计字数、猜标点比例。
 */

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030'

export const ENCODING_LABELS: Record<TextEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  gb18030: 'GBK/GB18030'
}

export interface DecodedText {
  text: string
  /** 实际用的是哪种编码 */
  encoding: TextEncoding
  /** 是否靠「试解」猜出来的（有 BOM 就是确定的，不算猜） */
  guessed: boolean
}

const BOM = {
  utf8: [0xef, 0xbb, 0xbf],
  utf16le: [0xff, 0xfe],
  utf16be: [0xfe, 0xff]
} as const

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

/** 严格解码：遇到非法字节就抛错。用来判断「这是不是合法 UTF-8」 */
function tryStrictDecode(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function lenientDecode(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    // 环境不支持这个解码器（理论上不会，TextDecoder 从 Node 11 起就有 GB18030）
    return new TextDecoder().decode(bytes)
  }
}

export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.length === 0) return { text: '', encoding: 'utf-8', guessed: false }

  // 1 / 2. 有 BOM 就不用猜。注意 BOM 本身要丢掉，不能让它进正文 ——
  // 它会让全文偏移整体差一格，所有标注跟着错位。
  if (startsWith(bytes, BOM.utf8)) {
    return { text: lenientDecode(bytes.subarray(3), 'utf-8'), encoding: 'utf-8', guessed: false }
  }
  if (startsWith(bytes, BOM.utf16le)) {
    return { text: lenientDecode(bytes.subarray(2), 'utf-16le'), encoding: 'utf-16le', guessed: false }
  }
  if (startsWith(bytes, BOM.utf16be)) {
    return { text: lenientDecode(bytes.subarray(2), 'utf-16be'), encoding: 'utf-16be', guessed: false }
  }

  // 3. 无 BOM：先按合法 UTF-8 试。纯 ASCII 也走这条（它本来就是合法 UTF-8）
  const asUtf8 = tryStrictDecode(bytes, 'utf-8')
  if (asUtf8 !== null) return { text: asUtf8, encoding: 'utf-8', guessed: true }

  // 4. 不是合法 UTF-8，按国内最常见的情况当作 GB18030
  return { text: lenientDecode(bytes, 'gb18030'), encoding: 'gb18030', guessed: true }
}

/**
 * 给用户看的编码提示。
 *
 * UTF-8 返回空串：它是默认情况，不需要每次导入都报一句废话。
 * 换了编码就必须说 —— 不声不响地换掉，万一猜错了用户连「为什么是乱码」都不知道。
 */
export function describeEncoding(decoded: DecodedText): string {
  if (decoded.encoding === 'utf-8') return ''
  const label = ENCODING_LABELS[decoded.encoding]
  return decoded.guessed ? `按 ${label} 读取（根据内容推测，不是 UTF-8）` : `按 ${label} 读取`
}
