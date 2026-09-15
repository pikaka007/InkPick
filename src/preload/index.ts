import { contextBridge, ipcRenderer } from 'electron'
import type { DictionaryStatus, ImportedDocument, InkPickApi } from '../core/api'
import type { LookupResult } from '../core/dictionary'

/** 暴露给渲染进程的全部能力 */
const api: InkPickApi = {
  readStore: () => ipcRenderer.invoke('store:read') as Promise<string | null>,
  writeStore: (json: string) => ipcRenderer.invoke('store:write', json) as Promise<void>,
  importDocument: () => ipcRenderer.invoke('doc:import') as Promise<ImportedDocument | null>,
  lookupWord: (word: string) => ipcRenderer.invoke('dict:lookup', word) as Promise<LookupResult>,
  dictionaryStatus: () => ipcRenderer.invoke('dict:status') as Promise<DictionaryStatus>,
  saveTextFile: (suggestedName: string, content: string) =>
    ipcRenderer.invoke('file:save-text', suggestedName, content) as Promise<string | null>,
  onBeforeClose: (handler: () => void) => {
    ipcRenderer.on('app:before-close', () => handler())
  },
  flushDone: () => {
    ipcRenderer.send('app:flush-done')
  }
}

contextBridge.exposeInMainWorld('api', api)
