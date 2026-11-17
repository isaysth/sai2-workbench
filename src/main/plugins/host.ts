/**
 * PluginContext 的实现与插件贡献点收集。
 *
 * v1 插件在主进程用 CommonJS 加载，属于「可信的本地代码」——
 * 这里提供能力，但不做进程隔离；插件页会把这一点明说给用户。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dialog, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { PluginPageContribution } from '@shared/plugins'
import type { ConfigStore } from '../config'
import type { Logger } from '../logger'
import type { ServiceContainer } from './container'
import { PluginEvents, type PluginEventName } from './events'
import type { LoadedPlugin, PluginModule } from './loader'
import type { PluginWindowService } from './windows'

const pluginRequire = createRequire(join(process.cwd(), '__plugin_loader__.cjs'))

/** 插件往文件卡右键菜单加的动作。when 只能在主进程判断，不传给渲染端 */
export interface FileAction {
  id: string
  label: string
  pluginId: string
  /** 给渲染端决定是否显示菜单项；不填则所有文件都显示 */
  exts?: string[]
  when?: (file: unknown) => boolean
  run?: (payload: unknown) => void | Promise<void>
}

export interface ToolbarAction {
  id: string
  label: string
  pluginId: string
  run?: (payload: unknown) => void | Promise<void>
}

/** 插件上报的运行状态，显示在侧栏 / 启动页（如联动路径失效） */
export interface PluginStatusView {
  pluginId: string
  text: string
  level: 'ok' | 'warn' | 'error'
}

export interface PluginContributions {
  fileActions: FileAction[]
  toolbarActions: ToolbarAction[]
  pages: PluginPageContribution[]
  statuses: PluginStatusView[]
}

export interface HostDeps {
  log: Logger
  config: ConfigStore
  container: ServiceContainer
  events: PluginEvents
  /** 插件私有数据根目录，通常是 data/plugin-data */
  pluginDataDir: string
  /** 贡献点变化（渲染端要重画菜单 / 侧栏） */
  onContributionsChanged: () => void
  /** 浮窗能力；未提供时插件 ctx.windows 不可用 */
  windows?: PluginWindowService
}

type Mutable = Record<string, unknown>

/** 递归代理配置对象：任何一层赋值 / 增删都要触发落盘 */
function wrapConfig<T>(value: T, markDirty: () => void): T {
  if (Array.isArray(value)) {
    return new Proxy(value, {
      get(target, prop, receiver) {
        return wrapConfig(Reflect.get(target, prop, receiver), markDirty)
      },
      set(target, prop, next, receiver) {
        const ok = Reflect.set(target, prop, next, receiver)
        markDirty()
        return ok
      },
      deleteProperty(target, prop) {
        const ok = Reflect.deleteProperty(target, prop)
        markDirty()
        return ok
      }
    }) as T
  }
  if (typeof value === 'object' && value !== null) {
    return new Proxy(value as Mutable, {
      get(target, prop, receiver) {
        return wrapConfig(Reflect.get(target, prop, receiver), markDirty)
      },
      set(target, prop, next, receiver) {
        const ok = Reflect.set(target, prop, next, receiver)
        markDirty()
        return ok
      },
      deleteProperty(target, prop) {
        const ok = Reflect.deleteProperty(target, prop)
        markDirty()
        return ok
      }
    }) as T
  }
  return value
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class PluginHost {
  readonly contributions: PluginContributions = {
    fileActions: [],
    toolbarActions: [],
    pages: [],
    statuses: []
  }

  constructor(private readonly deps: HostDeps) {}

  /** 清 require 缓存后加载 CJS；重载插件时拿到的是新代码 */
  loadModule(entryPath: string): PluginModule {
    const resolved = pluginRequire.resolve(entryPath)
    const cached = require.cache[resolved]
    if (cached) delete require.cache[resolved]
    const exported = pluginRequire(resolved) as PluginModule & { default?: PluginModule }
    return exported.default ?? exported
  }

  /** 插件被停用时移除它注册过的全部贡献点 */
  clearContributions(pluginId: string): void {
    this.deps.windows?.close(pluginId)
    this.contributions.fileActions = this.contributions.fileActions.filter((a) => a.pluginId !== pluginId)
    this.contributions.toolbarActions = this.contributions.toolbarActions.filter((a) => a.pluginId !== pluginId)
    this.contributions.pages = this.contributions.pages.filter((p) => p.pluginId !== pluginId)
    this.contributions.statuses = this.contributions.statuses.filter((s) => s.pluginId !== pluginId)
    this.deps.onContributionsChanged()
  }

  createContext(plugin: LoadedPlugin, rawConfig: Record<string, unknown>): Record<string, unknown> {
    const id = plugin.id
    const log = this.deps.log
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const saveNow = (): void => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = null
      try {
        this.deps.config.set(`plugins.config.${id}`, JSON.parse(JSON.stringify(rawConfig)) as unknown)
      } catch (err) {
        log.error('plugin', `插件 ${id} 的配置保存失败：${messageOf(err)}`)
      }
    }
    const markDirty = (): void => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(saveNow, 150)
    }

    const container = this.deps.container
    const events = this.deps.events
    const windows = this.deps.windows
    const canWindow = plugin.capabilities.includes('window') && !!windows
    const dataDir = join(this.deps.pluginDataDir, id)
    try {
      mkdirSync(dataDir, { recursive: true })
    } catch (err) {
      log.warn('plugin', `插件 ${id} 的数据目录创建失败：${messageOf(err)}`)
    }

    const ctx: Record<string, unknown> = {
      id,
      dataDir,

      log: {
        debug: (m: string) => log.debug(`plugin:${id}`, m),
        info: (m: string) => log.info(`plugin:${id}`, m),
        warn: (m: string) => log.warn(`plugin:${id}`, m),
        error: (m: string) => log.error(`plugin:${id}`, m)
      },

      /** 递归代理，插件写 ctx.config.xxx = y 会在 150ms 后自动落盘 */
      config: wrapConfig(rawConfig, markDirty),

      get: <T>(name: string): T => container.get<T>(name),
      getAll: <T>(name: string): T[] => container.getAll<T>(name),

      effect: (fn: () => void | Promise<void>) => container.effect(id, fn),

      on: (event: string, handler: (payload?: unknown) => void | Promise<void>) => {
        if (!events.isKnown(event)) throw new Error(`未知事件：${event}`)
        const off = events.on(id, event as PluginEventName, handler)
        container.effect(id, off)
        return off
      },

      runLater: (ms: number, fn: () => void) => {
        const timer = setTimeout(() => {
          try {
            fn()
          } catch (err) {
            log.error('plugin', `插件 ${id} 的定时任务失败：${messageOf(err)}`)
          }
        }, Math.max(0, ms))
        container.effect(id, () => clearTimeout(timer))
        return timer
      },

      setInterval: (fn: () => void, ms: number) => {
        const timer = setInterval(() => {
          try {
            fn()
          } catch (err) {
            log.error('plugin', `插件 ${id} 的周期任务失败：${messageOf(err)}`)
          }
        }, Math.max(16, ms))
        container.effect(id, () => clearInterval(timer))
        return timer
      },

      addFileAction: (action: { id: string; label: string; exts?: string[]; when?: (file: unknown) => boolean; run?: (payload: unknown) => void | Promise<void> }) => {
        const entry: FileAction = { ...action, pluginId: id }
        this.contributions.fileActions.push(entry)
        container.effect(id, () => this.clearContributions(id))
        this.deps.onContributionsChanged()
        return entry.id
      },

      addToolbarAction: (action: { id: string; label: string; run?: (payload: unknown) => void | Promise<void> }) => {
        const entry: ToolbarAction = { ...action, pluginId: id }
        this.contributions.toolbarActions.push(entry)
        container.effect(id, () => this.clearContributions(id))
        this.deps.onContributionsChanged()
        return entry.id
      },

      addPage: (page: { id: string; title: string; html?: string }) => {
        const entry: PluginPageContribution = { ...page, pluginId: id }
        this.contributions.pages.push(entry)
        container.effect(id, () => this.clearContributions(id))
        this.deps.onContributionsChanged()
        return `plugin:${id}:${page.id}`
      },

      /** 上报一行状态（侧栏 / 启动页展示）；同名插件重复调用覆盖上一行 */
      setStatus: (text: string, level: 'ok' | 'warn' | 'error' = 'ok') => {
        const list = this.contributions.statuses
        const idx = list.findIndex((s) => s.pluginId === id)
        const entry: PluginStatusView = { pluginId: id, text, level }
        if (idx >= 0) list[idx] = entry
        else list.push(entry)
        this.deps.onContributionsChanged()
      },

      /**
       * 独立浮窗能力（需在 manifest 声明 capabilities:['window']）。
       * open 的 entry 是相对插件目录的 HTML 路径；post 在未开窗时静默忽略。
       * 窗口在插件停用时由内核统一关闭。
       */
      windows: canWindow
        ? {
            open: (opts: { entry: string; title?: string; width?: number; height?: number; onMessage?: (message: unknown) => void }) =>
              windows!.open(id, {
                entry: opts.entry,
                title: opts.title,
                width: opts.width,
                height: opts.height,
                onMessage: opts.onMessage ?? (() => undefined)
              }),
            post: (message: unknown) => windows!.post(id, message),
            close: () => windows!.close(id),
            isOpen: () => windows!.isOpen(id)
          }
        : undefined,

      /** 贡献主题变量；注销交给 ctx.effect（插件自己调），内核只做白名单过滤 */
      addThemeVars: (vars: Record<string, unknown>) => {
        const theme = container.get<{ registerVars: (id: string, vars: Record<string, unknown>) => () => void }>('theme')
        return theme.registerVars(id, vars)
      },

      dialog: {
        info: (message: string, title = '提示') => {
          dialog.showMessageBoxSync({ type: 'info', buttons: ['好的'], message, title })
        },
        error: (message: string, title = '出错了') => {
          dialog.showMessageBoxSync({ type: 'error', buttons: ['好的'], message, title })
        },
        confirm: (message: string, title = '请确认') => {
          return (
            dialog.showMessageBoxSync({
              type: 'question',
              buttons: ['取消', '确定'],
              defaultId: 1,
              cancelId: 0,
              message,
              title
            }) === 1
          )
        }
      },

      shell: {
        openPath: (path: string) => shell.openPath(path),
        openFolder: (path: string) => shell.openPath(path),
        exists: (path: string) => existsSync(path),
        /**
         * 启动外部程序。detached + unref，工作台退出不连带关闭。
         * 不做 shell:true —— 参数数组直传 spawn，不经过命令行解释器，避免注入。
         */
        launch: (exe: string, args: string[] = []) =>
          new Promise<{ ok: boolean; error?: string }>((resolve) => {
            if (!existsSync(exe)) {
              resolve({ ok: false, error: `程序不存在：${exe}` })
              return
            }
            try {
              const child = spawn(exe, Array.isArray(args) ? args : [], {
                detached: true,
                windowsHide: false,
                stdio: 'ignore'
              })
              child.once('error', (err: Error) => {
                log.error('plugin', `插件 ${id} 启动外部程序失败：${err.message}`)
                resolve({ ok: false, error: err.message })
              })
              child.once('spawn', () => {
                child.unref()
                resolve({ ok: true })
              })
            } catch (err) {
              resolve({ ok: false, error: messageOf(err) })
            }
          })
      }
    }

    // 卸载时把还没落盘的配置写掉，否则用户最后一笔修改会丢
    container.effect(id, () => {
      if (saveTimer) saveNow()
    })
    return ctx
  }

  /** 发事件给所有插件 */
  emit(event: PluginEventName, payload?: unknown): void {
    this.deps.events.emit(event, payload)
  }
}
