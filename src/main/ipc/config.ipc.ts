import { ipcMain } from 'electron'
import { CH } from '@shared/channels'
import type { AppConfig } from '@shared/types'
import type { ConfigStore } from '../config'
import type { Logger } from '../logger'
import { broadcast } from './broadcast'

/** 配置读写：渲染端改任何设置都走这里，主进程负责落盘与广播 */
export function registerConfigIpc(config: ConfigStore, log: Logger): void {
  ipcMain.handle(CH.configGet, (): AppConfig => config.all())

  ipcMain.handle(CH.configSet, (_event, payload: { key?: unknown; value?: unknown }) => {
    const key = payload?.key
    if (typeof key !== 'string' || key.length === 0 || key.length > 120) {
      log.warn('ipc', '配置写入被拒绝：key 非法')
      return { ok: false, error: '配置项名称非法' }
    }
    config.set(key, payload.value)
    return { ok: true }
  })

  config.onDidChange((key, value) => broadcast(CH.configChanged, { key, value }))
}
