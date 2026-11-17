/**
 * 打开器注册表：插件声明「我叫什么、支持哪些后缀、用配置里哪把路径」，
 * 内核负责读路径、检查存在性、spawn 外部程序并派发联动事件。
 *
 * 独立成服务是为了可单测：这里不 import electron，spawn 通过 inject 的 runner 注入。
 */
import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import type { ConfigStore } from '../config'
import type { OpenerView } from '@shared/types'

/** 插件注册一个打开器。launch 可选：第三方插件可覆盖默认 spawn 行为 */
export interface OpenerRegistration {
  id: string
  label: string
  exts: string[]
  /** config.openers 下的字段名，如 'ps' */
  configKey: string
  /** 自定义启动；不填则内核 spawn(path, [...args, file]) */
  launch?: (file: string | undefined, exe: string, args: string[]) => Promise<LaunchResult>
}

export interface LaunchResult {
  ok: boolean
  error?: string
  openerId?: string
}

export interface SpawnRequest {
  exe: string
  args: string[]
}

export interface OpenersDeps {
  config: ConfigStore
  /** 注入 spawn，单测里换成假函数；真实实现用 child_process.spawn + detached + unref */
  runner: (req: SpawnRequest) => Promise<void>
  /** 派发插件事件（before / after launch） */
  emit: (
    event: 'opener_before_launch' | 'opener_after_launch' | 'file_open',
    payload?: unknown
  ) => void
  log: { info: (scope: string, msg: string) => void; warn: (scope: string, msg: string) => void; error: (scope: string, msg: string) => void }
}

function argsOf(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw.trim().length === 0 ? [] : raw.trim().split(/\s+/)
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class OpenersService {
  private readonly entries = new Map<string, OpenerRegistration>()

  constructor(private readonly deps: OpenersDeps) {}

  /** 插件注册；返回的注销函数交给 ctx.effect，插件禁用时自动摘除 */
  register(reg: OpenerRegistration): () => void {
    this.entries.set(reg.id, reg)
    return () => {
      if (this.entries.get(reg.id) === reg) this.entries.delete(reg.id)
    }
  }

  list(): OpenerView[] {
    const defaultId = String(this.deps.config.get<string>('openers.default') ?? 'opener-sai2')
    return [...this.entries.values()]
      .map((reg) => {
        const cfg = this.deps.config.get<{ path?: string; args?: string }>(`openers.${reg.configKey}`)
        const path = typeof cfg?.path === 'string' ? cfg.path.trim() : ''
        return {
          id: reg.id,
          label: reg.label,
          configKey: reg.configKey,
          exts: [...reg.exts],
          path,
          ready: path.length > 0 && existsSync(path),
          current: reg.id === defaultId
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  /** 解析用哪个打开器：扩展名优先（已配置且可用），否则回退全局默认 */
  resolve(file?: string): OpenerView | null {
    const views = this.list()
    const readyViews = views.filter((v) => v.ready)
    if (readyViews.length === 0) return null

    if (file) {
      const ext = extname(file).toLowerCase()
      const byExt = readyViews.find((v) => v.exts.some((e) => e.toLowerCase() === ext))
      if (byExt) return byExt
    }
    const defaultView = readyViews.find((v) => v.current)
    return defaultView ?? readyViews[0] ?? null
  }

  /**
   * 启动。没有任何可用打开器时给中文引导，不抛异常。
   * before 事件在 spawn 之前发，联动插件据此按序拉起外部程序。
   */
  async launch(file?: string, openerId?: string): Promise<LaunchResult> {
    let view: OpenerView | null
    if (openerId) {
      view = this.list().find((v) => v.id === openerId && v.ready) ?? null
      if (!view) {
        const all = this.list().find((v) => v.id === openerId)
        return {
          ok: false,
          openerId,
          error: all ? `打开器「${all.label}」还没填路径或路径不存在，去设置里填一下` : `打开器 ${openerId} 不存在`
        }
      }
    } else {
      view = this.resolve(file)
      if (!view) {
        return { ok: false, error: '还没配置任何可用的画图程序路径，去设置里填一下 SAI2 / PS / CSP' }
      }
    }

    const reg = this.entries.get(view.id)
    if (!reg) return { ok: false, openerId: view.id, error: `打开器 ${view.id} 已卸载` }

    const cfg = this.deps.config.get<{ path?: string; args?: string }>(`openers.${reg.configKey}`)
    const exe = typeof cfg?.path === 'string' ? cfg.path.trim() : ''
    const args = [...argsOf(cfg?.args), ...(file ? [file] : [])]

    this.deps.emit('opener_before_launch', { openerId: view.id, file: file ?? null, exe })
    try {
      if (reg.launch) await reg.launch(file, exe, argsOf(cfg?.args))
      else await this.deps.runner({ exe, args })
      if (file) this.deps.emit('file_open', { path: file, openerId: view.id })
      this.deps.emit('opener_after_launch', { openerId: view.id, file: file ?? null, exe })
      this.deps.log.info('opener', `已启动 ${view.label}${file ? ` 并打开 ${file}` : ''}`)
      return { ok: true, openerId: view.id }
    } catch (err) {
      const reason = `启动 ${view.label} 失败：${messageOf(err)}`
      this.deps.log.error('opener', reason)
      return { ok: false, openerId: view.id, error: reason }
    }
  }
}
