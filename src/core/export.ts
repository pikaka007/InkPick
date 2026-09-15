/**
 * 导出 —— 纯字符串处理，不碰文件系统（落盘由 shell 层做）。
 *
 * 这是整个 MVP 的「逃生舱」：没有云同步、没有复习算法都不要紧，
 * 只要词表和笔记能被带走，数据就不会被这个应用锁死。
 */
import type { Annotation, Doc } from './types'
import type { VocabGroup } from './vocab'
import { groupDefinition, groupVocab } from './vocab'

/* ---------- CSV ---------- */

/** RFC4180 转义：含逗号 / 引号 / 换行的字段加引号，内部引号翻倍 */
export function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function csvRow(values: string[]): string {
  return values.map(csvField).join(',')
}

/**
 * 单词本 → Anki 用的 CSV。一个词一行，不是一次收藏一行 ——
 * 否则同一个词的多次收藏会变成多张重复卡片。
 *
 * 第一行是表头。Anki 导入时会自动识别并跳过；
 * 文件本身用 Excel / Numbers 打开也是自解释的。
 */
export function vocabToAnkiCsv(groups: VocabGroup[], sourceTitle: string): string {
  const header = csvRow(['Word', 'Phonetic', 'Definition', 'Context', 'Source'])
  const rows = groups.map((group) =>
    csvRow([
      group.lemma,
      group.phonetic,
      definitionOf(group),
      // 多次收藏的上下文各占一行：Anki 卡片背面看起来更清楚
      group.items.map((item) => item.contextText || item.anchor.text).join('\n'),
      sourceTitle
    ])
  )
  return [header, ...rows].join('\n') + '\n'
}

/** 导出时给全部义项，不像界面上只显示前三条 */
function definitionOf(group: VocabGroup): string {
  if (group.senses.length > 0) {
    return group.senses
      .map((sense) => (sense.pos ? `${sense.pos} ${sense.translation}` : sense.translation))
      .join('；')
  }
  return group.manualDefinition
}

/* ---------- Markdown ---------- */

export interface MarkdownOptions {
  /** 导出时间，注入以便测试 */
  now?: Date
  /** 没有笔记 / 没有词条时是否也输出小节标题 */
  includeEmptySections?: boolean
}

export function annotationsToMarkdown(
  annotations: Annotation[],
  doc: Pick<Doc, 'title'>,
  options: MarkdownOptions = {}
): string {
  const groups = groupVocab(annotations)
  const notes = annotations.filter((item) => item.type === 'note')
  const date = (options.now ?? new Date()).toISOString().slice(0, 10)

  const lines: string[] = []
  lines.push(`# ${doc.title}`)
  lines.push('')
  lines.push(`> InkPick 导出 · ${date} · ${groups.length} 条词条 / ${notes.length} 条笔记`)

  if (groups.length > 0 || options.includeEmptySections) {
    lines.push('', '## 单词', '')
    for (const group of groups) {
      lines.push(`**${group.lemma}**${group.phonetic ? ` /${group.phonetic}/` : ''} — ${groupDefinition(group) || '（未补释义）'}`)
      lines.push('')
      for (const item of group.items) {
        const form = formLabel(item, group)
        lines.push(`- ${form}${item.contextText || item.anchor.text}`)
      }
      if (group.manualDefinition && group.senses.length > 0) {
        lines.push(`- （手写）${group.manualDefinition}`)
      }
      lines.push('')
    }
  }

  if (notes.length > 0 || options.includeEmptySections) {
    lines.push('## 笔记', '')
    for (const note of notes) {
      lines.push(`### ${note.content ?? ''}`)
      lines.push('')
      lines.push(`> ${note.contextText || note.anchor.text}`)
      lines.push('')
    }
  }

  // 去掉末尾多余空行，保留一个换行
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n') + '\n'
}

/** 用户当时选中的形态与原形不同时，标出来（如 words → word） */
function formLabel(item: Annotation, group: VocabGroup): string {
  const term = item.term ?? ''
  if (term && term.toLowerCase() !== group.lemma.toLowerCase()) return `*(${term})* `
  return ''
}

/* ---------- 文件名 ---------- */

/** 去掉文件系统不接受的字符（跨平台取并集） */
export function safeFileName(input: string, fallback = 'inkpick'): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  return (cleaned || fallback).slice(0, 60)
}

export function suggestedFileName(docTitle: string, kind: 'vocab' | 'notes', extension: string): string {
  const suffix = kind === 'vocab' ? '词表' : '笔记'
  return `${safeFileName(docTitle)}-${suffix}.${extension}`
}
