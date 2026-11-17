/**
 * 主题变量 IPC：读当前变量表 + 插件改动后的推送。
 * 变量表由 ThemeService 聚合，这里只做转发。
 */
import { ipcMain } from 'electron'
import { CH } from '@shared/channels'
import type { ThemeService } from '../theme/service'

export function registerThemeIpc(theme: ThemeService): void {
  ipcMain.handle(CH.themeGet, () => theme.getVars())
}
