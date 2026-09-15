/**
 * 持久化：单个 JSON 文件，放在 userData 下。
 *
 * MVP 用 JSON 而非 SQLite 的理由：零原生依赖（不用 electron-rebuild），
 * 数据量在几千条标注以内完全够用。写入是「整体覆盖 + 防抖」。
 * 真要换 SQLite 时，只需替换本文件与 src/core/store.ts 里的状态操作，不动上层。
 */
import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function storeFilePath(): string {
  return join(app.getPath('userData'), 'inkpick-store.json')
}

export async function readStoreFile(): Promise<string | null> {
  try {
    return await readFile(storeFilePath(), 'utf-8')
  } catch {
    // 首次运行文件不存在，属于正常情况
    return null
  }
}

/** 先写临时文件再 rename，避免写一半崩掉导致数据损坏 */
export async function writeStoreFile(json: string): Promise<void> {
  const target = storeFilePath()
  const tmp = `${target}.tmp`
  await mkdir(dirname(target), { recursive: true })
  await writeFile(tmp, json, 'utf-8')
  await rename(tmp, target)
}
