import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { normalizeContent } from '../core/text'
import type { ImportedDocument } from '../core/api'
import { dictionaryStatus, lookupWord } from './dictionary'
import { readStoreFile, storeFilePath, writeStoreFile } from './storeFile'

const isDev = !app.isPackaged

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
  ipcMain.handle('store:read', async () => readStoreFile())

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
    const raw = await readFile(filePath, 'utf-8')
    const extension = extname(filePath)
    return {
      title: basename(filePath, extension),
      // 必须在这里 normalize：全文偏移量基于归一化后的字符串
      content: normalizeContent(raw)
    }
  })

  ipcMain.handle('store:reveal', async () => {
    shell.showItemInFolder(storeFilePath())
  })

  ipcMain.handle('dict:lookup', async (_event, word: string) => lookupWord(word))

  ipcMain.handle('dict:status', async () => dictionaryStatus())
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
