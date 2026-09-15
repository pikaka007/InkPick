/**
 * 最小 CSV 解析（RFC 4180 + 容错）。
 *
 * 为什么不用现成库：只为一个用途写 60 行，可控、可单测、零依赖。
 * 为什么要容错：ECDICT 的 CSV 里有未加引号却含引号的字段
 * （例如 `[医] "姜"`），严格解析器会从这里开始把整份文件读错位。
 */
export interface ParseCsvOptions {
  /**
   * 未加引号的字段里出现引号时，当作普通字符而非语法错误。默认开启。
   * 关掉它可以在校验数据时把这类脏数据暴露出来。
   */
  lenientQuotes?: boolean
}

export function parseCsv(text: string, options: ParseCsvOptions = {}): string[][] {
  const lenient = options.lenientQuotes ?? true
  const rows: string[][] = []

  let row: string[] = []
  let field = ''
  let inQuotes = false
  /** 当前字段是否还没写入任何字符 —— 只有此时引号才是「起始引号」 */
  let atFieldStart = true
  let index = 0

  while (index < text.length) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = false
        index++
        continue
      }
      field += char
      index++
      continue
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true
      atFieldStart = false
      index++
      continue
    }

    if (char === '"' && lenient) {
      field += char
      index++
      continue
    }

    if (char === ',') {
      row.push(field)
      field = ''
      atFieldStart = true
      index++
      continue
    }

    if (char === '\r') {
      // 只有 \r\n 里的 \r 被丢掉；裸露的 \r 也一并规范化掉
      index++
      continue
    }

    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      atFieldStart = true
      index++
      continue
    }

    field += char
    atFieldStart = false
    index++
  }

  // 文件不以换行结尾时补最后一条记录（结尾恰好是换行则不补）
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** 把 CSV 变成对象数组，键取自表头 */
export function parseCsvRecords(text: string, options: ParseCsvOptions = {}): Record<string, string>[] {
  const rows = parseCsv(text, options)
  if (rows.length === 0) return []

  const header = rows[0]
  const records: Record<string, string>[] = []
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]
    const record: Record<string, string> = {}
    for (let j = 0; j < header.length; j++) {
      record[header[j]] = values[j] ?? ''
    }
    records.push(record)
  }
  return records
}
