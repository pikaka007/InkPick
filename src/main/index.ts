import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { decodeText, describeEncoding } from '../core/decode'
import { normalizeContent } from '../core/text'
import type { ConfirmOptions, ImportedDocument, StoreReadResult } from '../core/api'
import { dictionaryStatus, lookupWord } from './dictionary'
import { isParsableJson, readBackupFile, readStoreFile, storeFilePath, writeStoreFile } from './storeFile'

const isDev = !app.isPackaged

/**
 * 把存档目录定死成小写的 `inkpick`。
 *
 * 为什么要显式定：Electron 的 userData 目录名取的是**应用名**，
 * 而应用名优先用 package.json 的 productName（打包后是 `InkPick`），
 * dev 下用的是 name（`inkpick`）。Windows 文件系统不分大小写，看不出问题；
 * macOS / Linux 会变成两个目录 —— 用户会以为「数据全没了」（其实在旧目录）。
 *
 * 例外：E2E 会传 `--user-data-dir` 做数据隔离，那种情况下**绝不能覆盖**，
 * 否则测试会写进真实存档。
 */
const hasCustomUserData = process.argv.some((arg) => arg.startsWith('--user-data-dir'))
if (!hasCustomUserData) {
  const pinned = join(app.getPath('appData'), 'inkpick')
  // setPath 要求目录已存在，不存在会直接抛错
  mkdirSync(pinned, { recursive: true })
  app.setPath('userData', pinned)
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#faf9f7',
    title: 'InkPick',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 安全基线：渲染进程拿不到 Node，一切能力经 preload 显式暴露
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // 关窗前先让渲染进程把防抖中的改动落盘，否则最后一次标注会丢。
  // 渲染进程不响应时也不能卡死退出，所以留 1s 兑底。
  let closed = false
  window.on('close', (event) => {
    if (closed) return
    event.preventDefault()

    const finish = (): void => {
      if (closed) return
      closed = true
      window.close()
    }

    ipcMain.once('app:flush-done', finish)
    window.webContents.send('app:before-close')
    setTimeout(finish, 1000)
  })

  // 站内链接一律用系统浏览器打开，不在应用内导航
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  /**
   * 读存档。主文件解析不了就用备份顶上，并把「用了备份」告诉渲染进程 ——
   * 静默恢复很危险：用户会以为自己丢了最后一次编辑却不知道为什么。
   */
  ipcMain.handle('store:read', async (): Promise<StoreReadResult> => {
    const raw = await readStoreFile()
    if (raw === null || isParsableJson(raw)) return { raw, recovered: false }

    const backup = await readBackupFile()
    if (isParsableJson(backup)) return { raw: backup, recovered: true }

    // 两个都坏了：把原样的内容交回去，让上层的容错退回空库（不崩）
    return { raw, recovered: false }
  })

  ipcMain.handle('store:write', async (_event, json: string) => {
    await writeStoreFile(json)
  })

  ipcMain.handle('doc:import', async (): Promise<ImportedDocument | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择要阅读的文本',
      properties: ['openFile'],
      filters: [
        { name: '纯文本', extensions: ['txt', 'md', 'markdown'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    // 读字节而不是直接 readFile(utf-8)：国内大量 TXT 是 GBK，硬按 UTF-8 读会全是乱码
    const bytes = await readFile(filePath)
    const decoded = decodeText(new Uint8Array(bytes))
    const extension = extname(filePath)
    return {
      title: basename(filePath, extension),
      // 必须在这里 normalize：全文偏移量基于归一化后的字符串
      content: normalizeContent(decoded.text),
      encoding: decoded.encoding,
      encodingInfo: describeEncoding(decoded)
    }
  })

  ipcMain.handle('store:reveal', async () => {
    shell.showItemInFolder(storeFilePath())
  })

  ipcMain.handle('dict:lookup', async (_event, word: string) => lookupWord(word))

  ipcMain.handle('dict:status', async () => dictionaryStatus())

  ipcMain.handle('dialog:confirm', async (_event, options: ConfirmOptions): Promise<boolean> => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: [options.confirmLabel ?? '确定', '取消'],
      // 默认与 Esc 都停在「取消」上 —— 随手回车不应该把数据删掉
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    return result.response === 0
  })

  ipcMain.handle(
    'file:save-text',
    async (_event, suggestedName: string, content: string): Promise<string | null> => {
      const extension = extname(suggestedName).replace(/^\./, '')
      const result = await dialog.showSaveDialog({
        title: '导出',
        defaultPath: suggestedName,
        filters: extension
          ? [
              { name: extension.toUpperCase(), extensions: [extension] },
              { name: '所有文件', extensions: ['*'] }
            ]
          : [{ name: '所有文件', extensions: ['*'] }]
      })

      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, content, 'utf-8')
      return result.filePath
    }
  )
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
