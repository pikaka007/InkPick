/**
 * 从 ECDICT 全量 CSV 里裁出一份「内置 mini 词库」。
 *
 * 产物 resources/dictionary/{mini,lemma}.tsv 已提交进仓库，
 * 正常开发**不需要**跑这个脚本。只有在想换筛选策略、或升级 ECDICT 版本时：
 *
 *   npm run dict:build
 *
 * 前置：把源数据放到 .dict-src/，见 docs/DICTIONARY.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from '../src/core/csv'
import { normalizeWord, parseEcdictCsv, parseLemmaFile, serializeDictionary, serializeLemmaIndex } from '../src/core/dictionary'

// 脚本被 esbuild 打包到 node_modules/.cache 后执行，所以不能用 import.meta.dirname
const ROOT = process.cwd()
const SRC_CSV = join(ROOT, '.dict-src/ecdict.full.csv')
const SRC_LEMMA = join(ROOT, '.dict-src/lemma.en.txt')
const OUT_DIR = join(ROOT, 'resources/dictionary')

/** 词频排名在这个数以内就收进 mini —— 覆盖日常英文阅读绰绰有余 */
const FREQ_LIMIT = 20_000

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!existsSync(SRC_CSV)) {
  fail(`缺少源数据 ${SRC_CSV}，获取方式见 docs/DICTIONARY.md`)
}

// ---- 1. 先校验源数据没坏 ----
const csvText = readFileSync(SRC_CSV, 'utf-8')
const rows = parseCsv(csvText)
const columnCount = rows[0].length
const malformed = rows.filter((row) => row.length !== columnCount).length
console.log(`源数据：${rows.length.toLocaleString()} 行，${columnCount} 列，列数异常 ${malformed} 行`)
if (malformed > rows.length * 0.001) fail('列数异常的行超过千分之一，源文件可能已损坏')

// ---- 2. 筛选并构建 ----
const rankIn = (value: number): boolean => value > 0 && value <= FREQ_LIMIT
const selected = new Set<string>()

const extraLemma = existsSync(SRC_LEMMA) ? parseLemmaFile(readFileSync(SRC_LEMMA, 'utf-8')) : new Map<string, string>()
console.log(`lemma.en.txt：${extraLemma.size.toLocaleString()} 条词形映射`)

const data = parseEcdictCsv(csvText, {
  extraLemma,
  select: (info) => {
    // 只留单个英文词：词组、专名、含空格的一概不要
    if (info.word.length > 24 || !/^[a-z][a-z'-]*$/.test(info.word)) return false
    if (!(info.oxford || info.collins >= 1 || rankIn(info.frq) || rankIn(info.bnc))) return false
    selected.add(info.word)
    return true
  }
})

console.log(`mini 筛选：${selected.size.toLocaleString()} 个词条（牛津三千 / 柯林斯 ≥1 星 / 词频 ≤ ${FREQ_LIMIT.toLocaleString()}）`)
console.log(`解析结果：${data.entries.size.toLocaleString()} 词条，${data.lemmaOf.size.toLocaleString()} 条词形映射`)

// ---- 3. 写出产物 ----
mkdirSync(OUT_DIR, { recursive: true })
const dictText = serializeDictionary(data.entries)
const lemmaText = serializeLemmaIndex(data.lemmaOf)
writeFileSync(join(OUT_DIR, 'mini.tsv'), dictText, 'utf-8')
writeFileSync(join(OUT_DIR, 'lemma.tsv'), lemmaText, 'utf-8')

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`
console.log(`✓ mini.tsv   ${mb(Buffer.byteLength(dictText))}`)
console.log(`✓ lemma.tsv  ${mb(Buffer.byteLength(lemmaText))}`)

// ---- 4. 抽检：这几个词必须查得到，否则词库不能用 ----
console.log('抽检：')
let missing = 0
for (const word of ['read', 'reading', 'run', 'hurry', 'annotate', 'context', 'quick', 'slowly']) {
  const entry = data.entries.get(word)
  if (entry) {
    console.log(`  ✓ ${word.padEnd(10)} ${entry.senses[0]?.translation.slice(0, 28) ?? ''}`)
    continue
  }
  const lemma = data.lemmaOf.get(normalizeWord(word))
  console.log(`  ✗ ${word.padEnd(10)} 缺${lemma ? `（词形 → ${lemma}）` : ''}`)
  if (!lemma) missing++
}
if (missing > 0) fail(`抽检有 ${missing} 个常用词既不在词库也还原不出原形`)
