/**
 * 持久化：单个 JSON 文件，放在 userData 下。
 *
 * MVP 用 JSON 而非 SQLite 的理由：零原生依赖（不用 electron-rebuild），
 * 数据量在几千条标注以内完全够用。写入是「整体覆盖 + 防抖」。
 * 真要换 SQLite 时，只需替换本文件与 src/core/store.ts 里的状态操作，不动上层。
 *
 * 覆盖写之前会先把上一版留成 `.bak`：整个书库都在这一个文件里，
 * 一旦它被外部改坏，没有备份就等于标注全丢（见 readStoreFile 的恢复逻辑）。
 */
import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function storeFilePath(): string {
  return join(app.getPath('userData'), 'inkpick-store.json')
}

export function backupFilePath(): string {
  return `${storeFilePath()}.bak`
}

/**
 * 磁盘上那份存档是不是「我们知道的、内容合法的」。
 *
 * 为什么记这个标志而不是每次备份前重新 JSON.parse 一遍：
 * 存档包含全书正文，大书 10MB，保存却可能一分钟好几次，
 * 为了备份再解析一次纯属浪费。而**我们自己写下的内容必然是合法的**，
 * 启动时读过一次也知道它合不合法 —— 两处各维护一次就够了。
 *
 * 初值 false：启动读完之前我们什么也不知道，宁可不备份，
 * 也不要把一份内容不明的东西拷成 .bak。
 */
let currentIsKnownGood = false

/** 读不到文件（首次运行）返回 null，其他错误也返回 null —— 启动时不能因为读文件失败就崩 */
export async function readStoreFile(): Promise<string | null> {
  const raw = await readOrNull(storeFilePath())
  currentIsKnownGood = isParsableJson(raw)
  return raw
}

export async function readBackupFile(): Promise<string | null> {
  return readOrNull(backupFilePath())
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

/** 内容是不是能解析的 JSON。用来判断存档有没有被写坏 */
export function isParsableJson(raw: string | null): boolean {
  if (raw === null) return false
  try {
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

/** 先写临时文件再 rename，避免写一半崩掉导致数据损坏 */
export async function writeStoreFile(json: string): Promise<void> {
  const target = storeFilePath()
  const tmp = `${target}.tmp`
  await mkdir(dirname(target), { recursive: true })
  await writeFile(tmp, json, 'utf-8')
  await backupCurrent(target)
  await rename(tmp, target)
  // 刚写下的内容必然合法，下次保存就可以放心把它备份起来
  currentIsKnownGood = true
}

/**
 * 覆盖前留一份上一版。
 *
 * 备份是**尽力而为**：没有旧文件（首次运行）或备份本身失败，都不该让保存失败 ——
 * 保存用户的标注是主线，备份是保险。但失败要说出来，不能装作备份成功。
 *
 * **只备份内容已知合法的那一份。** 主文件被外部程序改坏时（比如被截断），
 * 如果照样拷成 .bak，就会把唯一一份好备份覆盖掉 ——
 * 恰恰在最需要它的时候把它毁掉。
 */
async function backupCurrent(target: string): Promise<void> {
  if (!currentIsKnownGood) {
    console.warn('[inkpick] 当前存档内容不明（启动时就不是合法 JSON），跳过备份以免覆盖上一份好备份')
    return
  }
  try {
    await copyFile(target, backupFilePath())
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') console.warn('[inkpick] 备份存档失败，本次仍然照常保存：', error)
  }
}
