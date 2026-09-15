/**
 * 检查文档里有没有被 shell 吃掉的字符（开发用）。
 * 教训：不要把含非 ASCII 的内容写进 bash -e 的脚本里，反引号会被命令替换、
 * emoji 会被换成 ?。这个脚本用来兜底体检。
 */
import { readFileSync } from 'node:fs'

const FILES = ['README.md', 'AGENTS.md', 'docs/MVP.md', 'docs/ROADMAP.md', 'docs/DICTIONARY.md', 'docs/EXPORT.md']

let suspicious = 0
for (const file of FILES) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    // 形如 "8. ? 搜索" 或 "见 [](xxx.md)" —— 被 eaten 的 emoji / 链接文字
    const eatenEmoji = /^\s*[\d.]*\s*\?\s/.test(line)
    const emptyLinkText = /\[\]\(/.test(line)
    if (eatenEmoji || emptyLinkText) {
      suspicious++
      console.log(`${file}:${index + 1}: ${line.trim()}`)
    }
  })
}

console.log(suspicious === 0 ? '没有发现被吃掉的字符' : `发现 ${suspicious} 处可疑`)
