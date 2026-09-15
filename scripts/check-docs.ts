/**
 * 文档体检（开发用）。
 *
 * 教训：不要把含非 ASCII 的内容写进 `bash -e "node -e ..."` 或 heredoc 里 ——
 * 反引号会被 shell 当命令替换，emoji / ⌘ 会被换成 ?，heredoc 里的中文会被写坏。
 * 这个脚本负责把这类「静默损坏」找出来。
 *
 *   npm run check:docs
 */
import { readFileSync } from 'node:fs'

/** 文档，加上了测试文件 —— 那边的损坏更难发现（表现为选择器超时） */
const FILES = [
  'README.md',
  'AGENTS.md',
  'docs/MVP.md',
  'docs/ROADMAP.md',
  'docs/DICTIONARY.md',
  'docs/EXPORT.md',
  'tests/e2e/app.test.ts'
]

/** 每条规则给出「看起来像被写坏了」的特征，以及说明 */
const RULES: { pattern: RegExp; why: string }[] = [
  { pattern: /^\s*[\d.]*\s*\?\s/, why: '行首的 ? 可能是被吃掉的 emoji（如 ✅）' },
  { pattern: /\|\s*\?\s/, why: '表格单元格里的 ? 可能是被吃掉的 emoji' },
  { pattern: /\[\]\(/, why: '空链接文字：Markdown 链接里的反引号内容被命令替换了' },
  { pattern: /Ctrl\/\?|Cmd\/\?|⌘?\?\+/, why: 'Ctrl/⌘ 里的 ⌘ 被换成了 ?' },
  { pattern: /[\u4e00-\u9fa5]\?[\u4e00-\u9fa5]/, why: '中文之间夹着 ?，可能丢了符号' },
  // 乱码字符：UTF-8 被按别的编码写坏了（heredoc 的典型症状）
  { pattern: /[\u0080-\u00ff]{3,}/, why: '连续的非 ASCII 单字节字符，像是编码写坏了' }
]

let suspicious = 0
for (const file of FILES) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        suspicious++
        console.log(`${file}:${index + 1}  ${rule.why}`)
        console.log(`    ${line.trim().slice(0, 120)}`)
      }
    }
  })
}

console.log(suspicious === 0 ? '没有发现被写坏的字符' : `发现 ${suspicious} 处可疑，请人工确认`)
