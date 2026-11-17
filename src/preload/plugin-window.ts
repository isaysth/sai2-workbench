/**
 * 插件浮窗专用 preload。
 * 只暴露一条消息桥，浮窗页面拿不到工作台 api、拿不到 Node。
 * 消息带 pluginId，主进程据此路由到对应插件的 onMessage。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '@shared/channels'
import { readPluginId } from '@shared/plugin-window'

interface WindowBridgeInit {
  pluginId: string
}

// 主进程在 loadFile 时通过 query 把 pluginId 传进来；
// process.argv 仅作为旧版 additionalArguments 的兼容回退。
const locationLike = globalThis as unknown as { location?: { search?: string } }
const init: WindowBridgeInit = {
  pluginId: readPluginId(locationLike.location?.search ?? '', process.argv)
}

contextBridge.exposeInMainWorld('pluginBridge', {
  pluginId: init.pluginId,
  /** 浮窗 → 插件 */
  send: (message: unknown): void => {
    void ipcRenderer.invoke(CH.pluginWindowMessage, { pluginId: init.pluginId, message })
  },
  /** 插件 → 浮窗 */
  onMessage: (cb: (message: unknown) => void): (() => void) => {
    const handler = (_e: unknown, message: unknown): void => cb(message)
    ipcRenderer.on('plugin-window:message', handler)
    return () => ipcRenderer.off('plugin-window:message', handler)
  }
})
