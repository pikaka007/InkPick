/**
 * 文档体检（开发用）。
 *
 * 教训：不要把含非 ASCII 的内容写进 `bash -e "node -e ..."` 这类脚本里 ——
 * 反引号会被 shell 当命令替换、emoji / ⌘ 会被换成 ?。
 * 这个脚本负责把这类「静默损坏」找出来。
 *
 *   npm run check:docs
 */
import { readFileSync } from 'node:fs'

const FILES = [
  'README.md',
  'AGENTS.md',
  'docs/MVP.md',
  'docs/ROADMAP.md',
  'docs/DICTIONARY.md',
  'docs/EXPORT.md'
]

/** 每条规则给出「看起来像被吃掉了」的特征，以及说明 */
const RULES: { pattern: RegExp; why: string }[] = [
  { pattern: /^\s*[\d.]*\s*\?\s/, why: '行首的 ? 可能是被吃掉的 emoji（如 ✅）' },
  { pattern: /\|\s*\?\s/, why: '表格单元格里的 ? 可能是被吃掉的 emoji' },
  { pattern: /\[\]\(/, why: '空链接文字：Markdown 链接里的反引号内容被命令替换了' },
  { pattern: /Ctrl\/\?|Cmd\/\?|⌘?\?\+/, why: 'Ctrl/⌘ 里的 ⌘ 被换成了 ?' },
  { pattern: /[\u4e00-\u9fa5]\?[\u4e00-\u9fa5]/, why: '中文之间夹着 ?，可能丢了符号' }
]

let suspicious = 0
for (const file of FILES) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        suspicious++
        console.log(`${file}:${index + 1}  ${rule.why}\n    ${line.trim()}`)
      }
    }
  })
}

console.log(suspicious === 0 ? '没有发现被吃掉的字符' : `发现 ${suspicious} 处可疑，请人工确认`)
