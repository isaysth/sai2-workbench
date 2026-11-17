import { ipcMain, shell } from 'electron'
import { CH } from '@shared/channels'
import type { LogEntry } from '@shared/types'
import type { Logger } from '../logger'
import { broadcast } from './broadcast'

/** 日志：历史回填、清屏、打开日志文件、实时推送 */
export function registerLogIpc(log: Logger): void {
  ipcMain.handle(CH.logHistory, (_event, limit?: number): LogEntry[] => {
    const n = typeof limit === 'number' && limit > 0 ? Math.min(2000, Math.floor(limit)) : 500
    return log.history(n)
  })

  ipcMain.handle(CH.logClear, () => {
    log.clearBuffer()
    return { ok: true }
  })

  ipcMain.handle(CH.logOpenFile, async () => {
    const err = await shell.openPath(log.file)
    return err ? { ok: false, error: err } : { ok: true }
  })

  log.subscribe((entry) => broadcast(CH.logAppend, entry))
}
