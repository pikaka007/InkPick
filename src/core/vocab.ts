/**
 * 单词本的分组逻辑 —— 纯函数，可单测。
 *
 * 一次阅读里同一个词会在不同位置被收藏很多次。底层标注**不能合并**
 * （每条都绑定一个原文位置），但**列表要合并**：否则单词本会被
 * running / ran / runs 这类碎片填满。
 *
 * 所以：按 lemma 分组，一组一条词条，下面挂多次收藏与各自的上下文。
 */
import type { Annotation, LookupStatus, Sense } from './types'

export interface VocabGroup {
  /** 分组键 = lemma 小写 */
  key: string
  lemma: string
  phonetic: string
  senses: Sense[]
  manualDefinition: string
  status: LookupStatus
  /** 该词的历次收藏，按原文位置排序 */
  items: Annotation[]
}

function groupKeyOf(annotation: Annotation): string {
  const basis = annotation.lemma || annotation.term || annotation.anchor.text
  return basis.trim().toLowerCase()
}

const STATUS_RANK: Record<LookupStatus, number> = { pending: 0, missing: 1, found: 2 }

export function groupVocab(annotations: Annotation[]): VocabGroup[] {
  const groups = new Map<string, VocabGroup>()

  for (const annotation of annotations) {
    if (annotation.type !== 'vocab') continue

    const key = groupKeyOf(annotation)
    if (!key) continue

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        lemma: annotation.lemma || annotation.term || annotation.anchor.text,
        phonetic: '',
        senses: [],
        manualDefinition: '',
        status: annotation.lookupStatus ?? 'pending',
        items: []
      }
      groups.set(key, group)
    }

    group.items.push(annotation)

    // 组内取「信息最全」的那条作为展示来源：
    // 词形、释义、手写释义都可能是后补上的，谁有就用谁
    if (!group.phonetic && annotation.phonetic) group.phonetic = annotation.phonetic
    if (group.senses.length === 0 && annotation.senses?.length) group.senses = annotation.senses
    if (!group.manualDefinition && annotation.manualDefinition) group.manualDefinition = annotation.manualDefinition
    if (STATUS_RANK[annotation.lookupStatus ?? 'pending'] > STATUS_RANK[group.status]) {
      group.status = annotation.lookupStatus ?? 'pending'
    }
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => a.anchor.start - b.anchor.start)
  }

  // 按首次收藏的先后排，读起来跟阅读顺序一致
  return [...groups.values()].sort((a, b) => a.items[0].createdAt - b.items[0].createdAt)
}

/** 单词本里显示什么释义：优先词典，其次手写 */
export function groupDefinition(group: VocabGroup): string {
  if (group.senses.length > 0) {
    return group.senses
      .slice(0, 3)
      .map((sense) => (sense.pos ? `${sense.pos} ${sense.translation}` : sense.translation))
      .join('；')
  }
  return group.manualDefinition
}

/** 该分组是否需要用户补一条释义（只在词典确已查不到时才问） */
export function needsManualDefinition(group: VocabGroup): boolean {
  if (group.senses.length > 0) return false
  if (group.manualDefinition.trim() !== '') return false
  return group.status === 'missing'
}
