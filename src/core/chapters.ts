/**
 * 章节识别 —— 纯函数，不碰 DOM。
 *
 * TXT 没有任何结构，章节只能从正文里「认」出来，所以这里全是启发式规则。
 * 两条原则：
 *
 * 1. **认不出就整个功能消失**。没有章节标记的文件（比如大多数英文小说）
 *    返回空数组，界面上不出现目录、不出现上一章/下一章 —— 而不是给一堆垃圾章节。
 * 2. **误判的代价不对称，所以不必追求完美**。误判出一条假章节，目录里多一条垃圾；
 *    漏判一章，它被并进上一章。两者都很轻。真正要防的是**认出一堆正文句子当标题**，
 *    那会让目录彻底没法用。防这个靠三件事同时上：
 *    整行匹配 + 行长上限 + 拒绝句读标点（正文句子几乎必然带标点，这就是分界线）。
 *
 * 注意：识别**基于段落**（splitParagraphs 的结果）而不是重新按行切。
 * 因为标题行本身就是一个段落，这样拿到的 segStart 与渲染层的 data-seg 序号
 * 天然对齐，不用再做一次坐标换算。
 */
import type { TextSegment } from './text'

export interface Chapter {
  /** 从 0 开始 */
  index: number
  /** 标题原文（已 trim） */
  title: string
  /** 标题行首字符在全文中的偏移 */
  start: number
  /** 下一章标题行首偏移；最后一章为全文长度 */
  end: number
  /** 标题所在段落序号（含） */
  segStart: number
  /** 下一章标题所在段落序号（不含）；最后一章为段落总数 */
  segEnd: number
}

/* ---------- 规则 ---------- */

/** 汉数字与阿拉伯数字（含全角） */
const NUM = '[0-9０-９一二三四五六七八九十百千万零两]'

/**
 * 出现这些字符就说明这是一句话，不是标题。
 * 刻意**不包含** （）() 【】[] ：: —— 因为「第一章（上）」「番外：十年之后」
 * 这类标题很常见，把它们判掉会漏掉真实的章节。
 */
const SENTENCE_MARK = /[。！？；…，、"'“”‘’《》〈〉]/

/** 标题行最长多少字符。真实标题远超这个长度的基本没有 */
const MAX_TITLE_LEN = 80

interface Rule {
  name: string
  re: RegExp
}

const RULES: Rule[] = [
  // 第X章 / 第X节 / 第X回
  { name: '章回节', re: new RegExp(`^第\\s*${NUM}{1,6}\\s*[章节回]\\s*.{0,40}$`) },
  // 第X卷 / 第X部 / 第X篇 —— 卷比章大一级，这里先平铺成一条
  { name: '卷部篇', re: new RegExp(`^第\\s*${NUM}{1,6}\\s*[卷部篇集]\\s*.{0,40}$`) },
  // 楔子 / 序章 / 尾声 / 番外三
  { name: '特殊章', re: /^(楔子|序章|序言|前言|引子|后记|尾声|终章|大结局|番外.{0,12})$/ },
  // Chapter 12 / CHAPTER XII / Part Two
  { name: '英文', re: /^(Chapter|CHAPTER|chapter|Part|PART)\s+([0-9]{1,4}|[IVXLCDM]{1,8}|[A-Z][a-z]+)\b.{0,64}$/ },
  // Markdown 标题（.md 也在支持的文件类型里）
  { name: 'Markdown', re: /^#{1,6}\s+.{1,64}$/ }
]

/**
 * 判断一行（去掉首尾空白后）是不是章节标题。
 * 导出出来是为了单测能直接对着规则表验证，不用每次都构造整篇正文。
 */
export function classifyHeading(line: string): string | null {
  const text = line.trim()
  if (!text) return null
  // 全角空格也是空白，trim 已经处理；标题不会太长
  if (text.length > MAX_TITLE_LEN) return null
  // 带句读的一律不是标题
  if (SENTENCE_MARK.test(text)) return null

  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.name
  }
  return null
}

/* ---------- 主入口 ---------- */

/**
 * 从段落序列里认出所有章节。
 *
 * @param segments splitParagraphs 的结果
 * @param contentLength 全文长度，用来定最后一章的 end
 */
export function detectChapters(segments: TextSegment[], contentLength: number): Chapter[] {
  const found: { title: string; start: number; segStart: number }[] = []

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!classifyHeading(segment.text)) continue
    found.push({ title: segment.text.trim(), start: segment.start, segStart: index })
  }

  return found.map((item, index) => {
    const next = found[index + 1]
    return {
      index,
      title: item.title,
      start: item.start,
      end: next ? next.start : contentLength,
      segStart: item.segStart,
      segEnd: next ? next.segStart : segments.length
    }
  })
}

/**
 * 给定段落序号，返回它属于第几章。
 * 返回 -1 表示落在第一章之前（书名、作者、简介那一段）—— 界面上不显示章名。
 *
 * 用二分查找：一本 1000 章的书，每滚过一段都要查一次。
 */
export function chapterIndexAtSegment(chapters: Chapter[], segIndex: number): number {
  let low = 0
  let high = chapters.length - 1
  let best = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (chapters[mid].segStart <= segIndex) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

/**
 * 需要画「本章完」分隔线的段落序号集合。
 * 只取第二章及以后的章首 —— 第一章前面不需要分隔线。
 */
export function chapterBoundarySegments(chapters: Chapter[]): Set<number> {
  const set = new Set<number>()
  for (const chapter of chapters.slice(1)) set.add(chapter.segStart)
  return set
}

/** 目录里显示的「约 N 字」。含标题与空行，所以是「约」 */
export function chapterLength(chapter: Chapter): number {
  return Math.max(0, chapter.end - chapter.start)
}

/** 标题太长时截断，给 title 属性留完整原文 */
export function truncateTitle(title: string, max = 28): string {
  return title.length <= max ? title : `${title.slice(0, max)}…`
}
