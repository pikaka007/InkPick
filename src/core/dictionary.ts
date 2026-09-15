/**
 * 词典 —— 纯逻辑，不含任何 IO 与网络。
 *
 * 两件事：
 *
 * 1. **查词**：给一个词，返回音标与释义。
 * 2. **词形还原（lemma）**：把 running / ran / runs 都归到 run。
 *    不做这一步，单词本会被同一堆变体碎片填满，一个月后就废了。
 *
 * 数据来源是 ECDICT（MIT，见 resources/dictionary/ECDICT-LICENSE）。
 * 解析与构建逻辑在这里，文件 IO 在 shell 层。
 */
import { parseCsv } from './csv'
import type { Sense } from './types'

export interface DictEntry {
  word: string
  phonetic: string
  senses: Sense[]
  /** 柯林斯星级，0 表示未收录 */
  collins: number
  /** 词频排名，0 表示未知 */
  frq: number
}

export type MatchKind = 'exact' | 'lemma' | 'none'

export interface LookupResult {
  /** 调用方原样传入的词 */
  query: string
  /** 归一化后的查询词 */
  normalized: string
  /** 还原出的原形。查不到时退化为 normalized */
  lemma: string
  match: MatchKind
  /** match === 'exact' 时是该词自己的词条；'lemma' 时是原形的词条 */
  entry: DictEntry | null
}

export interface Dictionary {
  readonly size: number
  lookup(query: string): LookupResult
}

/** 词库的完整数据：词条 + 变形词索引 */
export interface DictionaryData {
  entries: Map<string, DictEntry>
  /** 变形词 → 原形 */
  lemmaOf: Map<string, string>
}

export function emptyDictionaryData(): DictionaryData {
  return { entries: new Map(), lemmaOf: new Map() }
}

/** ECDICT 的 exchange 字段编码 */
export const EXCHANGE_CODES: Record<string, string> = {
  p: '过去式',
  d: '过去分词',
  i: '现在分词',
  '3': '第三人称单数',
  r: '比较级',
  t: '最高级',
  s: '复数',
  '0': '原形',
  '1': '原形变换'
}

/**
 * 归一化查询词：小写、去掉首尾的引号标点、处理所有格。
 * 选中文本常常带着逗号、引号、括号，不清理就查不到。
 */
export function normalizeWord(input: string): string {
  let word = input.trim().toLowerCase()
  // 去掉首尾的非字母数字（保留词内部的连字符与撇号）
  word = word.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9'’-]+$/, '')
  word = word.replace(/’/g, "'")
  // 所有格：readers' / reader's
  word = word.replace(/'s?$/, '')
  return word
}

/** `p:ran/d:run/i:running` → [{ code: 'p', value: 'ran' }, ...] */
export function parseExchange(exchange: string): { code: string; value: string }[] {
  if (!exchange) return []
  const result: { code: string; value: string }[] = []
  for (const part of exchange.split('/')) {
    const at = part.indexOf(':')
    if (at <= 0) continue
    const code = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim().toLowerCase()
    if (value) result.push({ code, value })
  }
  return result
}

/** 取某个词条的全部变形词（不含它自己） */
export function exchangeForms(exchange: string, self: string): string[] {
  const forms: string[] = []
  for (const { code, value } of parseExchange(exchange)) {
    // 0 是「原形」指针，1 是变换类型，都不是变形词
    if (code === '0' || code === '1') continue
    if (value !== self && !forms.includes(value)) forms.push(value)
  }
  return forms
}

/**
 * 把 ECDICT 的整段 translation 拆成一条条义项。
 * 形如 `n. 奔跑\nv. 经营`，也可能整段没有词性。
 */
export function parseTranslation(raw: string): Sense[] {
  if (!raw) return []

  const lines = raw
    // ECDICT 里混用了字面量 `\n` 与 `\r\n` 两种转义，先统一
    .replace(/\\r\\n|\\r/g, '\\n')
    .split(/\\n|\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const senses: Sense[] = []
  for (const line of lines) {
    // 【网络】【医】这类标记不是词性，保留为义项文本
    const match = /^([a-z]{1,6}\.)\s*(.*)$/i.exec(line)
    if (match) {
      senses.push({ pos: match[1], translation: match[2] })
    } else if (senses.length > 0) {
      senses[senses.length - 1].translation += ` ${line}`
    } else {
      senses.push({ pos: '', translation: line })
    }
  }
  return senses
}

export function createDictionary(data: DictionaryData): Dictionary {
  const { entries, lemmaOf } = data
  return {
    size: entries.size,

    lookup(query: string): LookupResult {
      const normalized = normalizeWord(query)

      const exact = entries.get(normalized)
      if (exact) {
        return { query, normalized, lemma: exact.word, match: 'exact', entry: exact }
      }

      const lemma = lemmaOf.get(normalized)
      if (lemma) {
        const entry = entries.get(lemma)
        if (entry) return { query, normalized, lemma, match: 'lemma', entry }
        return { query, normalized, lemma, match: 'none', entry: null }
      }

      return { query, normalized, lemma: normalized, match: 'none', entry: null }
    }
  }
}

/** 供 select 回调判断是否收下某个词条的字段 */
export interface EcdictRowInfo {
  word: string
  collins: number
  oxford: boolean
  bnc: number
  frq: number
}

export interface ParseEcdictOptions {
  /** 额外的「变形词 → 原形」映射，如 ECDICT 自带的 lemma.en.txt */
  extraLemma?: Map<string, string>
  /** 筛选词条。不传则全部收下。用于裁 mini 词库 */
  select?: (info: EcdictRowInfo) => boolean
}

/**
 * 解析 ECDICT 的 CSV 词库，同时建好变形词索引。
 * header: word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
 *
 * 一趟扫描完成两件事，因为 66MB 的文件不值得读两遍。
 */
export function parseEcdictCsv(text: string, options: ParseEcdictOptions = {}): DictionaryData {
  const data = emptyDictionaryData()
  const rows = parseCsv(text)
  if (rows.length < 2) return data

  const header = rows[0]
  const col = (name: string): number => header.indexOf(name)
  const iWord = col('word')
  const iPhonetic = col('phonetic')
  const iTranslation = col('translation')
  const iCollins = col('collins')
  const iOxford = col('oxford')
  const iBnc = col('bnc')
  const iFrq = col('frq')
  const iExchange = col('exchange')

  if (iWord < 0 || iTranslation < 0) return data

  // 先全部读成词条，再回头建索引 —— 否则遇到「原形排在后头」时会漏掉
  const exchanges: { word: string; exchange: string }[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const word = normalizeWord(row[iWord] ?? '')
    if (!word || data.entries.has(word)) continue

    if (
      options.select &&
      !options.select({
        word,
        collins: Number(row[iCollins] ?? 0) || 0,
        oxford: row[iOxford] === '1',
        bnc: Number(row[iBnc] ?? 0) || 0,
        frq: Number(row[iFrq] ?? 0) || 0
      })
    ) {
      continue
    }

    const senses = parseTranslation(row[iTranslation] ?? '')
    if (senses.length === 0) continue

    data.entries.set(word, {
      word,
      phonetic: (row[iPhonetic] ?? '').trim(),
      senses,
      collins: Number(row[iCollins] ?? 0) || 0,
      frq: Number(row[iFrq] ?? 0) || 0
    })
    exchanges.push({ word, exchange: iExchange >= 0 ? (row[iExchange] ?? '') : '' })
  }

  indexExchange(exchanges, data)
  mergeLemma(data, options.extraLemma)
  return data
}

/** 把每个词条的 exchange 展开成「变形词 → 原形」 */
function indexExchange(rows: { word: string; exchange: string }[], data: DictionaryData): void {
  for (const row of rows) {
    for (const form of exchangeForms(row.exchange, row.word)) {
      // 本身能独立成词的词形不归并：reading（名词阅读）有自己的释义，
      // 归到 read 底下反而会丢信息。分组展示时再看 lemma 索引。
      if (data.entries.has(form) || data.lemmaOf.has(form)) continue
      data.lemmaOf.set(form, row.word)
    }
  }
}

function mergeLemma(data: DictionaryData, extra?: Map<string, string>): void {
  if (!extra) return
  for (const [form, lemma] of extra) {
    if (data.lemmaOf.has(form)) continue
    if (data.entries.has(form)) continue
    if (!data.entries.has(lemma)) continue
    data.lemmaOf.set(form, lemma)
  }
}

/** ECDICT 仓库里自带的 lemma.en.txt：`form -> lemma` */
export function parseLemmaFile(text: string): Map<string, string> {
  const lemmaOf = new Map<string, string>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';')) continue

    const at = trimmed.indexOf('->')
    if (at <= 0) continue

    const form = normalizeWord(trimmed.slice(0, at))
    const lemma = normalizeWord(trimmed.slice(at + 2))
    if (form && lemma) lemmaOf.set(form, lemma)
  }
  return lemmaOf
}

/* ---------- 序列化：运行时用紧凑 TSV，不用再碰 66MB 的 CSV ---------- */

function escapeField(value: string): string {
  return value
    // 字面量 `\r\n` / `\r` 统一成 `\n`，避免释义尾部留下 \r
    .replace(/\\r\\n|\\r/g, '\\n')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/\t/g, ' ')
    .trim()
}

function unescapeField(value: string): string {
  // 目前解析端（parseTranslation）已能识别 `\n` 转义，这里保持原样
  return value
}

/** 词条 → TSV。translation 保留 `\n` 转义，单行存储，体积也小 */
export function serializeDictionary(entries: Map<string, DictEntry>): string {
  const lines: string[] = []
  for (const entry of entries.values()) {
    const translation = entry.senses.map((sense) => (sense.pos ? `${sense.pos} ${sense.translation}` : sense.translation)).join('\\n')
    lines.push(
      [entry.word, escapeField(entry.phonetic), escapeField(translation), String(entry.collins), String(entry.frq)].join('\t')
    )
  }
  return lines.join('\n')
}

export function parseDictionaryTsv(text: string): Map<string, DictEntry> {
  const entries = new Map<string, DictEntry>()
  for (const line of text.split('\n')) {
    if (!line) continue
    const [word, phonetic = '', translation = '', collins = '0', frq = '0'] = line.split('\t')
    const normalized = normalizeWord(word)
    if (!normalized || entries.has(normalized)) continue

    const senses = parseTranslation(unescapeField(translation))
    if (senses.length === 0) continue

    entries.set(normalized, {
      word: normalized,
      phonetic: unescapeField(phonetic),
      senses,
      collins: Number(collins) || 0,
      frq: Number(frq) || 0
    })
  }
  return entries
}

export function serializeLemmaIndex(lemmaOf: Map<string, string>): string {
  const lines: string[] = []
  for (const [form, lemma] of lemmaOf) lines.push(`${form}\t${lemma}`)
  return lines.join('\n')
}

export function parseLemmaIndex(text: string): Map<string, string> {
  const lemmaOf = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (!line) continue
    const at = line.indexOf('\t')
    if (at <= 0) continue
    lemmaOf.set(line.slice(0, at), line.slice(at + 1))
  }
  return lemmaOf
}
