/**
 * 渲染进程与主进程之间的契约。
 * 放在 core 里是为了让两侧共享同一份类型，同时不牵连 electron 依赖。
 */
import type { LookupResult } from './dictionary'
import type { TextEncoding } from './decode'

export interface ImportedDocument {
  title: string
  /** 已 normalize 的全文 */
  content: string
  /** 实际读出来的编码 */
  encoding: TextEncoding
  /** 给用户看的编码说明。UTF-8 时是空串（默认情况，不打扰） */
  encodingInfo: string
}

/** 读存档的结果。recovered 表示主文件坏了、用的是备份 */
export interface StoreReadResult {
  raw: string | null
  recovered: boolean
}

export interface DictionaryStatus {
  source: 'bundled-mini'
  entries: number
  lemmaMappings: number
}

export interface ConfirmOptions {
  title: string
  message: string
  /** 写清楚代价，例如「会同时删除 23 条标注」 */
  detail?: string
  /** 确认按钮的文字，默认「确定」。建议写具体动作，如「删除」 */
  confirmLabel?: string
}

export interface InkPickApi {
  /** 读取持久化数据；首次运行 raw 为 null */
  readStore(): Promise<StoreReadResult>
  /** 覆盖写入持久化数据 */
  writeStore(json: string): Promise<void>
  /** 弹文件选择框导入 txt；用户取消返回 null */
  importDocument(): Promise<ImportedDocument | null>
  /** 查词：返回音标、释义与词形还原结果 */
  lookupWord(word: string): Promise<LookupResult>
  /** 当前词库信息 */
  dictionaryStatus(): Promise<DictionaryStatus>
  /** 弹保存框写文本文件；用户取消返回 null，否则返回保存路径 */
  saveTextFile(suggestedName: string, content: string): Promise<string | null>
  /**
   * 原生确认框，返回用户是否确认。
   * 只用在**不可逆且代价大**的操作上（删文档、清空数据）。
   * 能被撤销的操作请用撤销，不要用确认框打断用户。
   */
  confirmAction(options: ConfirmOptions): Promise<boolean>
  /** 主进程在关窗前询问一次，渲染进程必须落盘后调 flushDone() */
  onBeforeClose(handler: () => void): void
  flushDone(): void
}
