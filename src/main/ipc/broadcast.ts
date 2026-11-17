import { BrowserWindow } from 'electron'

/** 向所有存活窗口推送事件。任一窗口发送失败不影响其他窗口。 */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(channel, payload)
    } catch {
      /* 窗口正在销毁时忽略 */
    }
  }
}
