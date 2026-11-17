/**
 * 插件加载器：发现 → 校验 → 拓扑排序 → 激活 → 状态机。
 *
 * 加载器不认识 PluginContext 的实现，也不直接 require 插件文件 ——
 * 这两件事分别由 host.ts 通过 createContext / loadModule 注入，方便单测。
 */
import { existsSync, readdirSync, rmSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import type { ConfigSchema, PluginInfo, PluginResult, PluginStatus } from '@shared/plugins'
import type { ConfigStore } from '../config'
import type { Logger } from '../logger'
import { topologicalSort, type ServiceContainer } from './container'
import { readManifest, validateExportedSchema } from './manifest'

/** 插件模块导出形状。CJS 单文件，v1 只支持这一种 */
export interface PluginModule {
  configSchema?: ConfigSchema
  apply: (ctx: unknown, config: unknown) => void | Promise<void>
}

export interface LoadedPlugin {
  id: string
  dir: string
  source: 'builtin' | 'user'
  info: PluginInfo
  inject: string[]
  workerEntryPath?: string
  module?: PluginModule
  capabilities: string[]
}

export interface PluginLoaderDeps {
  log: Logger
  container: ServiceContainer
  builtinDir: string
  userDir: string
  pluginDataDir: string
  config: ConfigStore
  /** 由 host.ts 提供：清 require 缓存后加载 CJS 模块 */
  loadModule: (entryPath: string) => PluginModule
  /** 由 host.ts 提供：为插件构造 PluginContext，config 与传给 apply 的是同一个对象 */
  createContext: (plugin: LoadedPlugin, config: Record<string, unknown>) => unknown
  /** 状态发生变化时通知 IPC 广播 */
  onChanged: () => void
}

const ACTIVATE_TIMEOUT_MS = 3000
const MAX_REFRESH_ROUNDS = 8

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`插件激活超时（${ms}ms）`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 按 schema 给插件配置补默认值；没声明 schema 时原样透传用户存过的值 */
function mergedConfig(schema: ConfigSchema, stored: unknown): Record<string, unknown> {
  if (Object.keys(schema).length === 0) return isPlainObject(stored) ? { ...stored } : {}
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema)) {
    const raw = isPlainObject(stored) ? stored[key] : undefined
    if (raw !== undefined) {
      out[key] = raw
      continue
    }
    if (field.default !== undefined) out[key] = structuredClone(field.default)
    else if (field.type === 'list') out[key] = []
    else if (field.type === 'bool') out[key] = false
    else if (field.type === 'int' || field.type === 'float') out[key] = field.min ?? 0
    else out[key] = ''
  }
  return out
}

export class PluginLoader {
  private readonly plugins = new Map<string, LoadedPlugin>()
  private readonly active = new Set<string>()
  /** 入口路径不进跨进程的 PluginInfo，按插件对象存在这里 */
  private readonly entryPaths = new WeakMap<LoadedPlugin, string>()
  private readonly activating = new Set<string>()
  private refreshChain: Promise<void> = Promise.resolve()
  private changedTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: PluginLoaderDeps) {}

  /** 当前全部插件（含状态），按 id 排序，返回副本供 IPC 序列化 */
  list(): PluginInfo[] {
    return [...this.plugins.values()]
      .map((p) => ({ ...p.info, configSchema: structuredClone(p.info.configSchema) }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id)
  }

  private disabled(): string[] {
    const raw = this.deps.config.get<unknown>('plugins.disabled')
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  }

  private setDisabled(ids: string[]): void {
    const before = this.disabled().slice().sort().join('|')
    if (before === ids.slice().sort().join('|')) return
    this.deps.config.set('plugins.disabled', ids)
  }

  private mark(id: string, status: PluginStatus, error?: string): void {
    const p = this.plugins.get(id)
    if (!p) return
    p.info.status = status
    if (error !== undefined) p.info.error = error
    else delete p.info.error
  }

  /** 变更合并到下一次事件循环，避免一轮 refresh 广播十几次 */
  private notify(): void {
    if (this.changedTimer) return
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null
      this.deps.onChanged()
    }, 0)
  }

  // ---------------------------------------------------------------- 发现

  /** 扫描内置目录与用户目录；同 id 时用户安装的版本覆盖内置 */
  discover(): void {
    this.plugins.clear()
    this.readDir(this.deps.builtinDir, 'builtin')
    this.readDir(this.deps.userDir, 'user')
    this.rejectCycles()
  }

  private readDir(dir: string, source: 'builtin' | 'user'): void {
    if (!existsSync(dir)) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      this.deps.log.warn('plugin', `读取插件目录失败 ${dir}：${messageOf(err)}`)
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pluginDir = join(dir, entry.name)
      const result = readManifest(pluginDir)
      if (!result.ok) {
        // 目录名不一定等于 id，但仍要让列表里能看到「这里有个坏插件」
        const id = entry.name
        const plugin: LoadedPlugin = {
          id,
          dir: pluginDir,
          source,
          inject: [],
          capabilities: [],
          info: {
            id,
            name: id,
            version: '0.0.0',
            author: '',
            description: '',
            system: false,
            source,
            status: 'failed',
            error: result.error,
            inject: [],
            permissions: [],
            configSchema: {},
            dir: pluginDir
          }
        }
        this.plugins.set(id, plugin)
        this.deps.log.error('plugin', `插件 ${id} 加载失败：${result.error}`)
        continue
      }

      const { manifest, entryPath, workerEntryPath } = result.value
      const plugin: LoadedPlugin = {
        id: manifest.id,
        dir: pluginDir,
        source,
        inject: manifest.inject,
        workerEntryPath,
        capabilities: manifest.capabilities ?? [],
        info: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          author: manifest.author,
          description: manifest.description,
          system: manifest.system,
          source,
          status: 'waiting',
          inject: manifest.inject,
          permissions: manifest.permissions,
          configSchema: {},
          dir: pluginDir
        }
      }
      // entryPath 不进 PluginInfo（跨进程类型不带本机绝对路径），存在闭包里等激活用
      this.entryPaths.set(plugin, entryPath)
      this.plugins.set(manifest.id, plugin)
    }
  }

  private rejectCycles(): void {
    const result = topologicalSort([...this.plugins.values()].map((p) => ({ id: p.id, dependencies: p.inject })))
    for (const cyclic of result.cyclic) {
      const path = result.cyclePaths.find((p) => p.includes(cyclic.id))?.join(' → ')
      const error = `循环依赖：${path ?? cyclic.id}`
      this.mark(cyclic.id, 'failed', error)
      this.deps.log.error('plugin', `插件 ${cyclic.id}：${error}`)
      this.autoDisable(cyclic.id)
    }
  }

  // ---------------------------------------------------------------- 激活

  /** 初始化：发现 + 反复刷新直到没有新插件可激活 */
  async initialize(): Promise<void> {
    this.discover()
    await this.refresh()
  }

  /**
   * 刷新入口。所有调用方（provide / 启停 / 初始化）都排到同一条链上，
   * 避免两轮 refresh 同时看到「未激活」而把同一个插件 apply 两遍。
   */
  refresh(): Promise<void> {
    const next = this.refreshChain.then(() => this.doRefresh())
    this.refreshChain = next.catch(() => undefined)
    return next
  }

  /**
   * 重新计算所有插件状态。
   * 缺依赖的标 waiting；满足依赖的激活；被禁用或失败的先清理干净。
   * 循环执行是因为 A 激活后可能 provide 出 B 需要的服务。
   */
  private async doRefresh(): Promise<void> {
    for (let round = 0; round < MAX_REFRESH_ROUNDS; round += 1) {
      let progressed = false
      const disabled = this.disabled()

      for (const plugin of this.plugins.values()) {
        if (plugin.info.status === 'failed' && plugin.info.error?.startsWith('循环依赖')) continue

        if (disabled.includes(plugin.id)) {
          if (this.active.has(plugin.id)) {
            await this.deactivate(plugin)
            progressed = true
          }
          // 加载失败被自动禁用时保留 failed 和原因，让用户能在列表里看到出了什么事；
          // 只有用户主动禁用的健康插件才显示 disabled。
          if (plugin.info.status !== 'disabled' && plugin.info.status !== 'failed') {
            this.mark(plugin.id, 'disabled')
            this.notify()
          }
          continue
        }

        if (plugin.info.status === 'failed') continue

        const missing = plugin.inject.filter((name) => !this.deps.container.has(name))
        if (missing.length > 0) {
          if (this.active.has(plugin.id)) {
            await this.deactivate(plugin)
            progressed = true
          }
          const error = `等待依赖：${missing.join('、')}`
          if (plugin.info.status !== 'waiting' || plugin.info.error !== error) {
            this.mark(plugin.id, 'waiting', error)
            this.notify()
          }
          continue
        }

        if (this.active.has(plugin.id)) continue
        await this.activate(plugin)
        progressed = true
      }

      if (!progressed) break
    }
  }

  private async activate(plugin: LoadedPlugin): Promise<void> {
    // 双重保险：即便将来有调用方绕过 refresh 链，同一个插件也不会被 apply 两遍
    if (this.activating.has(plugin.id)) return
    this.activating.add(plugin.id)
    try {
      await this.activateInner(plugin)
    } finally {
      this.activating.delete(plugin.id)
    }
  }

  private async activateInner(plugin: LoadedPlugin): Promise<void> {
    const entryPath = this.entryPaths.get(plugin)
    if (!entryPath) {
      this.fail(plugin, '插件入口未记录')
      return
    }
    try {
      const mod = this.deps.loadModule(entryPath)
      if (!mod || typeof mod.apply !== 'function') throw new Error('插件没有导出 apply 函数')
      const schemaError = validateExportedSchema(mod.configSchema ?? {})
      if (schemaError) throw new Error(`configSchema 非法：${schemaError}`)

      plugin.module = mod
      plugin.info.configSchema = mod.configSchema ?? {}

      const cfg = mergedConfig(
        plugin.info.configSchema,
        this.deps.config.get<unknown>(`plugins.config.${plugin.id}`)
      )
      const ctx = this.deps.createContext(plugin, cfg)
      await withTimeout(Promise.resolve().then(() => mod.apply(ctx, cfg)), ACTIVATE_TIMEOUT_MS)
      this.active.add(plugin.id)
      this.mark(plugin.id, 'running')
      this.deps.log.info('plugin', `${plugin.id} 已启用（${plugin.info.version}）`)
    } catch (err) {
      await this.deps.container.disposeScope(plugin.id).catch(() => undefined)
      this.active.delete(plugin.id)
      this.fail(plugin, messageOf(err))
    }
    this.notify()
  }

  private fail(plugin: LoadedPlugin, error: string): void {
    this.mark(plugin.id, 'failed', error)
    this.deps.log.error('plugin', `插件 ${plugin.id} 加载失败：${error}`)
    this.autoDisable(plugin.id)
  }

  /** 加载失败自动禁用：下次启动不再反复尝试，但列表里仍显示原因 */
  private autoDisable(id: string): void {
    const disabled = this.disabled()
    if (!disabled.includes(id)) this.setDisabled([...disabled, id])
  }

  private async deactivate(plugin: LoadedPlugin): Promise<void> {
    if (!this.active.has(plugin.id)) return
    this.active.delete(plugin.id)
    const errors = await this.deps.container.disposeScope(plugin.id)
    for (const err of errors) {
      this.deps.log.warn('plugin', `插件 ${plugin.id} 清理失败：${messageOf(err)}`)
    }
    this.deps.log.info('plugin', `${plugin.id} 已停用`)
    this.notify()
  }

  // ---------------------------------------------------------------- 用户操作

  setEnabled(id: string, enabled: boolean): PluginResult {
    const plugin = this.plugins.get(id)
    if (!plugin) return { ok: false, error: `插件 ${id} 不存在` }
    if (!enabled && plugin.info.system) return { ok: false, error: '系统插件不能禁用' }

    const disabled = this.disabled().filter((v) => v !== id)
    if (!enabled) disabled.push(id)
    this.setDisabled(disabled)

    if (enabled && plugin.info.status === 'failed' && !plugin.info.error?.startsWith('循环依赖')) {
      // 用户手动重试一个曾经失败的插件：先抹掉 failed，refresh 才会再试
      this.mark(id, 'waiting')
    }
    void this.refresh()
    return { ok: true }
  }

  async reload(id: string): Promise<PluginResult> {
    const plugin = this.plugins.get(id)
    if (!plugin) return { ok: false, error: `插件 ${id} 不存在` }
    await this.deactivate(plugin)
    plugin.module = undefined
    plugin.info.configSchema = {}
    this.setDisabled(this.disabled().filter((v) => v !== id))
    this.mark(id, 'waiting')
    await this.refresh()
    return { ok: true }
  }

  async uninstall(id: string): Promise<PluginResult> {
    const plugin = this.plugins.get(id)
    if (!plugin) return { ok: false, error: `插件 ${id} 不存在` }
    if (plugin.source === 'builtin') return { ok: false, error: '内置插件不能卸载' }
    await this.deactivate(plugin)
    this.setDisabled(this.disabled().filter((v) => v !== id))
    try {
      rmSync(plugin.dir, { recursive: true, force: true })
    } catch (err) {
      return { ok: false, error: `删除插件目录失败：${messageOf(err)}` }
    }
    this.plugins.delete(id)
    this.entryPaths.delete(plugin)
    this.deps.log.info('plugin', `已卸载插件 ${id}`)
    this.notify()
    return { ok: true }
  }

  /** 退出前逆序清理全部插件；调用方 await 后再关库 */
  async disposeAll(): Promise<void> {
    await this.refreshChain
    const ids = [...this.active].reverse()
    for (const id of ids) {
      const plugin = this.plugins.get(id)
      if (plugin) await this.deactivate(plugin)
    }
    const errors = await this.deps.container.disposeScope('app')
    for (const err of errors) this.deps.log.warn('plugin', `全局清理失败：${messageOf(err)}`)
    if (this.changedTimer) clearTimeout(this.changedTimer)
  }
}
