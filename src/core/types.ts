/**
 * 领域模型 —— 纯数据，不依赖任何运行时环境（Node / 浏览器均可）。
 *
 * 设计铁律（见 docs/MVP.md）：
 * 词条与笔记是同一个东西 —— 「一段原文 + 一个位置」，只是负载不同。
 * 所以只有一张 Annotation 表，不要拆成三张。
 */
import type { ReaderPrefs } from './prefs'

/** 标注在原文中的位置。offset 之外冗余存 text/prefix/suffix，用于内容漂移后的重定位。 */
export interface Anchor {
  /** 选区起始字符偏移（相对文档全文） */
  start: number
  /** 选区结束字符偏移（不含） */
  end: number
  /** 选中的原文 */
  text: string
  /** 选区前若干字符，用于消歧与重定位 */
  prefix: string
  /** 选区后若干字符，用于消歧与重定位 */
  suffix: string
}

export type AnnotationType = 'vocab' | 'note'

/** 词典查询的三种结局。pending = 刚收藏、还没查；missing = 词典里没有 */
export type LookupStatus = 'pending' | 'found' | 'missing'

export interface Sense {
  /** 词性，如 `n.` `v.`，可能为空 */
  pos: string
  translation: string
}

export interface Annotation {
  id: string
  /**
   * 来自哪本书。**手动添加的词没有来源书**，这里是 undefined。
   * 所以不要直接拿去查表，要先判空。
   */
  docId?: string
  type: AnnotationType
  /**
   * 在原文中的位置。**手动添加的词没有位置**，这里是 undefined。
   * 「有没有 anchor」就是「这个词来自阅读还是手动加的」的判据（见 core/store.ts 的 isManual）。
   */
  anchor?: Anchor
  /** 选中文本所在的那句话（创建时快照，原文改动后依然可读）。手动词为空串 */
  contextText: string
  /** type === 'vocab' 时的词条（用户当时选中的原样） */
  term?: string
  /** 词形还原后的原形，单词本按它分组。没有特殊关系时等于 term */
  lemma?: string
  phonetic?: string
  senses?: Sense[]
  /** 词典查不到时用户手写的一句释义 */
  manualDefinition?: string
  lookupStatus?: LookupStatus
  /** type === 'note' 时的笔记正文 */
  content?: string
  createdAt: number
  updatedAt: number
}

export interface Doc {
  id: string
  title: string
  /** 全文，已 normalize（BOM 已去、CRLF 已转 LF），offset 即基于此字符串 */
  content: string
  createdAt: number
}

export interface Store {
  version: number
  docs: Doc[]
  annotations: Annotation[]
  /** docId -> 上次阅读位置 */
  progress: Record<string, Anchor>
  lastDocId?: string
  /** 阅读偏好。旧数据里没这个字段，反序列化时会补默认值 */
  prefs: ReaderPrefs
}
