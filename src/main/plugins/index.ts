/**
 * 插件系统门面：把容器、事件、宿主与加载器装配成一个对象给主进程用。
 * 启动顺序：new → provide 内核服务 → initialize → 窗口创建。
 */
import { join } from 'node:path'
import type { ConfigStore } from '../config'
import type { Logger } from '../logger'
import type { AppPaths } from '../paths'
import { ServiceContainer } from './container'
import { PluginEvents, type PluginEventName } from './events'
import { PluginHost } from './host'
import { PluginLoader } from './loader'
import { PluginWindowService } from './windows'
import type { WindowFactory } from './windows'
import type { ActionView, PluginInfo, PluginResult } from '@shared/plugins'

export interface PluginSystemDeps {
  log: Logger
  config: ConfigStore
  paths: AppPaths
  /** 插件状态或贡献点变化时通知渲染端 */
  onChanged: () => void
  /** 浮窗工厂；不传则插件无法开浮窗（如单测场景） */
  windowFactory?: WindowFactory
  /** 开发模式：允许禁用系统插件（见 loader 的 isDevMode） */
  isDev?: boolean
}

export class PluginSystem {
  readonly container = new ServiceContainer()
  readonly events: PluginEvents
  readonly host: PluginHost
  readonly loader: PluginLoader
  readonly windows: PluginWindowService

  private refreshChain: Promise<void> = Promise.resolve()

  constructor(private readonly deps: PluginSystemDeps) {
    const pluginDataDir = join(deps.paths.dataDir, 'plugin-data')

    this.events = new PluginEvents(deps.log)

    this.windows = new PluginWindowService({
      factory: deps.windowFactory ?? {
        create: () => ({
          post: () => undefined,
          close: () => undefined,
          isClosed: () => true
        })
      },
      canUse: (pluginId) => {
        const p = this.loader.get(pluginId)
        return !!p?.capabilities.includes('window')
      },
      pluginDirOf: (pluginId) => this.loader.get(pluginId)?.dir,
      log: deps.log
    })

    this.host = new PluginHost({
      log: deps.log,
      config: deps.config,
      container: this.container,
      events: this.events,
      pluginDataDir,
      onContributionsChanged: deps.onChanged,
      windows: this.windows
    })
    this.loader = new PluginLoader({
      log: deps.log,
      container: this.container,
      builtinDir: deps.paths.builtinPluginDir,
      userDir: deps.paths.pluginDir,
      pluginDataDir,
      config: deps.config,
      loadModule: (entry) => this.host.loadModule(entry),
      createContext: (plugin, cfg) => this.host.createContext(plugin, cfg),
      onChanged: deps.onChanged,
      isDevMode: () => deps.isDev === true
    })

    // 这两个服务每个插件都能拿，剩下的由主进程在初始化前逐个 provide
    this.container.provide('config', deps.config)
    this.container.provide('log', deps.log)
  }

  /** 发现并激活插件。必须在内核服务全部 provide 之后调用 */
  async initialize(): Promise<void> {
    await this.loader.initialize()
    this.events.emit('app_ready')
  }

  /** 注册内核服务；waiting 中的插件会自动重试激活 */
  provide<T>(name: string, service: T): void {
    this.container.provide(name, service)
    this.queueRefresh()
  }

  /** 外部改了 config.plugins.disabled 时也要重算状态（手工改配置文件的场景） */
  refresh(): void {
    this.queueRefresh()
  }

  /** 把多次 provide 合并成一条刷新链，避免启动时的并发 refresh 互相踩状态 */
  private queueRefresh(): void {
    this.refreshChain = this.refreshChain
      .then(() => this.loader.refresh())
      .catch((err: unknown) => this.deps.log.warn('plugin', `刷新插件状态失败：${String(err)}`))
  }

  list(): PluginInfo[] {
    return this.loader.list()
  }

  /** 右键菜单 / 工具栏的可序列化动作描述（函数留在主进程，不跨 IPC） */
  actions(): { fileActions: ActionView[]; toolbarActions: ActionView[] } {
    const view = (a: { id: string; label: string; pluginId: string; exts?: string[] }): ActionView => ({
      id: a.id,
      label: a.label,
      pluginId: a.pluginId,
      ...(a.exts ? { exts: [...a.exts] } : {})
    })
    return {
      fileActions: this.host.contributions.fileActions.map(view),
      toolbarActions: this.host.contributions.toolbarActions.map(view)
    }
  }

  /** 插件状态上报（联动路径失效等），随 contributions 一起下发 */
  statuses(): Array<{ pluginId: string; text: string; level: 'ok' | 'warn' | 'error' }> {
    return this.host.contributions.statuses.map((s) => ({ ...s }))
  }

  /** 执行插件动作。payload 原样转给插件，插件自己决定要不要用 */
  async runAction(kind: 'file' | 'toolbar', id: string, payload?: unknown): Promise<PluginResult> {
    const list = kind === 'file' ? this.host.contributions.fileActions : this.host.contributions.toolbarActions
    const action = list.find((a) => a.id === id)
    if (!action) return { ok: false, error: `动作 ${id} 不存在或插件已禁用` }
    if (!action.run) return { ok: false, error: '这个动作没有实现' }
    try {
      await action.run(payload)
      return { ok: true }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.deps.log.error('plugin', `执行插件动作 ${id} 失败：${reason}`)
      return { ok: false, error: reason }
    }
  }

  setEnabled(id: string, enabled: boolean): PluginResult {
    const result = this.loader.setEnabled(id, enabled)
    if (result.ok) this.queueRefresh()
    return result
  }

  async reload(id: string): Promise<PluginResult> {
    return this.loader.reload(id)
  }

  async uninstall(id: string): Promise<PluginResult> {
    return this.loader.uninstall(id)
  }

  /** 安装 / 卸载后重新发现并激活，让插件页立刻反映磁盘变化 */
  async rescan(): Promise<void> {
    await this.loader.disposeAll()
    await this.loader.initialize()
  }

  /** 插件配置读写都走 config:set，这里只给渲染端一个稳定的入口 */
  getConfig(id: string): Record<string, unknown> {
    const value = this.deps.config.get<unknown>(`plugins.config.${id}`)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  setConfig(id: string, value: Record<string, unknown>): PluginResult {
    if (!this.loader.get(id)) return { ok: false, error: `插件 ${id} 不存在` }
    this.deps.config.set(`plugins.config.${id}`, value)
    return { ok: true }
  }

  emit(event: PluginEventName, payload?: unknown): void {
    this.events.emit(event, payload)
  }

  /** 退出前发 app_quit 并逆序清理，主进程 await 完再关库 */
  async disposeAll(): Promise<void> {
    this.events.emit('app_quit')
    this.windows.closeAll()
    await this.loader.disposeAll()
  }
}
