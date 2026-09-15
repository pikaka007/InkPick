import { contextBridge, ipcRenderer } from 'electron'
import type { ImportedDocument, InkPickApi } from '../core/api'

/** 暴露给渲染进程的全部能力 */
const api: InkPickApi = {
  readStore: () => ipcRenderer.invoke('store:read') as Promise<string | null>,
  writeStore: (json: string) => ipcRenderer.invoke('store:write', json) as Promise<void>,
  importDocument: () => ipcRenderer.invoke('doc:import') as Promise<ImportedDocument | null>,
  onBeforeClose: (handler: () => void) => {
    ipcRenderer.on('app:before-close', () => handler())
  },
  flushDone: () => {
    ipcRenderer.send('app:flush-done')
  }
}

contextBridge.exposeInMainWorld('api', api)
