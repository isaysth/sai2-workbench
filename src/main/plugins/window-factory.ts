/**
 * 插件浮窗的 Electron 实现。
 *
 * 只被主进程引用（import electron），与 windows.ts 的纯逻辑分离。
 * 浮窗 transparent + 无边框，沿用工作台的玻璃观感；主题色通过 CSS 变量注入。
 */
import { BrowserWindow, ipcMain } from 'electron'
// setParentWindow 需要 BrowserWindow 类型，已包含在上行
import { join } from 'node:path'
import { CH } from '@shared/channels'
import type { Logger } from '../logger'
import type { PluginWindowService, WindowFactory, WindowHandle } from './windows'

export interface ElectronWindowFactoryDeps {
  log: Logger
  /** 读取当前主题变量表，注入到浮窗 */
  themeVars: () => Record<string, string>
  /** 是否开发模式（决定 preload 路径来源） */
  isDev: boolean
}

/** 把主题变量表变成一段 style 注入脚本 */
function themeStyle(vars: Record<string, string>): string {
  const decl = Object.entries(vars)
    .filter(([k, v]) => /^--[\w-]+$/.test(k) && /^[\w\s#,.%+/-]+$/.test(v))
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
  return decl ? `:root{${decl}}` : ''
}

export function createElectronWindowFactory(deps: ElectronWindowFactoryDeps): WindowFactory {
  return {
    create(opts): WindowHandle {
      const parent = BrowserWindow.getAllWindows()[0]
      const win = new BrowserWindow({
        ...(parent ? { parent } : {}),
        title: opts.title,
        width: opts.width,
        height: opts.height,
        minWidth: 320,
        minHeight: 240,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: false,
        show: false,
        webPreferences: {
          preload: join(__dirname, '../preload/plugin-window.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          spellcheck: false
        }
      })

      let closed = false
      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) win.show()
      })
      win.once('closed', () => {
        closed = true
        opts.onClosed()
      })

      win.webContents.on('did-finish-load', () => {
        deps.log.info('plugin-window', `浮窗页面已加载：${opts.pluginId}`)
        const css = themeStyle(deps.themeVars())
        if (css) {
          void win.webContents
            .insertCSS(css)
            .catch((err: unknown) => deps.log.warn('plugin-window', `注入主题变量失败：${String(err)}`))
        }
      })
      win.webContents.on('did-fail-load', (_e, code, desc, url) => {
        deps.log.error('plugin-window', `浮窗 did-fail-load code=${code} desc=${desc} url=${url}`)
      })
      win.webContents.on('render-process-gone', (_e, details) => {
        deps.log.error('plugin-window', `插件 ${opts.pluginId} 浮窗渲染进程退出：${details.reason}`)
      })

      // Electron 45 在本机的 loadFile 对含中文的路径会拼出未编码的
      // file:///C:\...（实测 ERR_FAILED），且转义无解。
      // 浮窗 HTML 完全自包含（CSS/JS 内联，无相对资源），因此复制到
      // 纯 ASCII 的 temp 目录再加载 —— 这是最稳的绕法。
      try {
        const { readFileSync, writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
        const { tmpdir } = require('node:os') as typeof import('node:os')
        const tmpDir = join(tmpdir(), 'sai2-fx-windows')
        mkdirSync(tmpDir, { recursive: true })
        const safePath = join(tmpDir, `${opts.pluginId.replace(/[^a-z0-9-]/gi, '_')}-panel.html`)
        writeFileSync(safePath, readFileSync(opts.htmlPath))
        // 延后一 tick 再加载：IPC handler 调用栈里同步建窗时，webContents 的
        // 导航有时会在初始化完成前发出而报 ERR_FAILED(-2)。
        setTimeout(() => {
          if (win.isDestroyed()) return
          void win
            .loadFile(safePath, { query: { pluginId: opts.pluginId } })
            .catch((err: unknown) => {
              deps.log.error('plugin-window', `插件 ${opts.pluginId} 浮窗加载失败：${String(err)}`)
            })
        }, 50)
      } catch (err) {
        deps.log.error('plugin-window', `插件 ${opts.pluginId} 准备浮窗页面失败：${String(err)}`)
      }

      return {
        post: (message) => {
          if (!win.isDestroyed()) win.webContents.send('plugin-window:message', message)
        },
        close: () => {
          if (!win.isDestroyed()) win.close()
        },
        isClosed: () => closed || win.isDestroyed()
      }
    }
  }
}

/** 浮窗 → 插件的消息路由。一个进程只注册一次 */
export function registerPluginWindowIpc(service: PluginWindowService, log: Logger): void {
  ipcMain.handle(CH.pluginWindowMessage, (_e, payload: { pluginId?: unknown; message?: unknown }) => {
    const pluginId = payload?.pluginId
    if (typeof pluginId !== 'string' || !pluginId) {
      log.warn('plugin-window', '浮窗消息被拒绝：pluginId 非法')
      return { ok: false, error: 'pluginId 非法' }
    }
    service.dispatch(pluginId, payload?.message)
    return { ok: true }
  })
}
