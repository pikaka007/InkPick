/**
 * 渲染进程与主进程之间的契约。
 * 放在 core 里是为了让两侧共享同一份类型，同时不牵连 electron 依赖。
 */
export interface ImportedDocument {
  title: string
  /** 已 normalize 的全文 */
  content: string
}

export interface InkPickApi {
  /** 读取持久化数据；首次运行返回 null */
  readStore(): Promise<string | null>
  /** 覆盖写入持久化数据 */
  writeStore(json: string): Promise<void>
  /** 弹文件选择框导入 txt；用户取消返回 null */
  importDocument(): Promise<ImportedDocument | null>
  /** 主进程在关窗前询问一次，渲染进程必须落盘后调 flushDone() */
  onBeforeClose(handler: () => void): void
  flushDone(): void
}
