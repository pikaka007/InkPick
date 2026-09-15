/**
 * 文本处理 —— 纯函数，是「offset ⇄ 屏幕位置」映射的地基。
 *
 * 关键约定：渲染层把全文切成若干段落，每段记录它在全文中的 start。
 * 段内不含换行符，因此每段渲染出来恰好是一个文本节点，DOM 偏移量换算才可靠。
 */

export interface TextSegment {
  /** 该段首字符在全文中的偏移 */
  start: number
  /** 段内容（不含换行符） */
  text: string
}

/** 去掉 BOM，统一换行符为 \n。必须在存库前调用，否则 offset 会漂。 */
export function normalizeContent(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

/** 按行切成段落。空行丢弃，但 start 仍指向全文中的真实位置。 */
export function splitParagraphs(content: string): TextSegment[] {
  const segments: TextSegment[] = []
  const re = /[^\n]+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    segments.push({ start: match.index, text: match[0] })
  }
  return segments
}

const SENTENCE_END = /[.!?。！？；;…]/
const MAX_CONTEXT = 200

/** 两个连续换行才算段落边界 —— 单个 \n 在硬换行的 txt 里只是行内空白 */
function paragraphStartAt(content: string, position: number): number {
  for (let i = Math.min(position, content.length - 1); i >= 1; i--) {
    if (content[i - 1] === '\n' && content[i] === '\n') return i + 1
  }
  return 0
}

function paragraphEndAt(content: string, position: number): number {
  for (let i = position; i < content.length - 1; i++) {
    if (content[i] === '\n' && content[i + 1] === '\n') return i
  }
  return content.length
}

/**
 * 取选中文本所在的那句话。
 * 先夹到段落（空行为界），再在段落内找标点边界；仍找不到就按 maxLen 截断。
 * 这是单词本的价值所在：日后看到词，能立刻想起它在原文里的语境。
 */
export function sentenceAround(content: string, start: number, end: number, maxLen = MAX_CONTEXT): string {
  const s = clamp(start, 0, content.length)
  const e = clamp(end, s, content.length)

  const paragraphStart = paragraphStartAt(content, s)
  const paragraphEnd = paragraphEndAt(content, e)

  // 句子边界：标点
  let left = s
  while (left > paragraphStart) {
    if (SENTENCE_END.test(content[left - 1])) break
    left--
  }

  let right = e
  while (right < paragraphEnd) {
    if (SENTENCE_END.test(content[right])) {
      right++
      break
    }
    right++
  }

  // 超出 maxLen 时向内收敛：必须完整保住选区本身
  if (right - left > maxLen) {
    if (e - s >= maxLen) {
      left = s
      right = Math.min(content.length, s + maxLen)
    } else {
      const room = maxLen - (e - s)
      const takeLeft = Math.min(s - left, Math.floor(room / 2))
      left = s - takeLeft
      right = Math.min(right, left + maxLen)
    }
  }

  return content.slice(left, right).replace(/\s+/g, ' ').trim()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
