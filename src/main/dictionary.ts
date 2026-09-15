/**
 * 词典的运行时入口（主进程）。
 *
 * 词库用 `?raw` 打进 bundle，不做文件路径分支，也不用管打包后的 resourcesPath。
 * 首次查词时才解析（懒加载）：冷启动不受影响，实测解析 79ms / 29MB。
 *
 * 为什么没有「下载完整词典」：见 docs/DICTIONARY.md，实测全量要 1.4GB 内存，
 * 而且词形还原反而失效。提升覆盖率应该调 FREQ_LIMIT 重新生成词库。
 */
import miniTsv from '../../resources/dictionary/mini.tsv?raw'
import lemmaTsv from '../../resources/dictionary/lemma.tsv?raw'
import { createDictionary, parseDictionaryTsv, parseLemmaIndex } from '../core/dictionary'
import type { Dictionary, LookupResult } from '../core/dictionary'

export interface DictionaryStatus {
  source: 'bundled-mini'
  entries: number
  lemmaMappings: number
}

let dictionary: Dictionary | null = null
let lemmaMappings = 0

export function getDictionary(): Dictionary {
  if (!dictionary) {
    const entries = parseDictionaryTsv(miniTsv)
    const lemmaOf = parseLemmaIndex(lemmaTsv)
    dictionary = createDictionary({ entries, lemmaOf })
    lemmaMappings = lemmaOf.size
  }
  return dictionary
}

export function lookupWord(query: string): LookupResult {
  return getDictionary().lookup(query)
}

export function dictionaryStatus(): DictionaryStatus {
  return {
    source: 'bundled-mini',
    entries: getDictionary().size,
    lemmaMappings
  }
}
