/**
 * 插件浮窗服务（T7.3a）。
 *
 * 设计边界：
 *  - 只有 manifest 声明了 capabilities:['window'] 的插件才能开浮窗；
 *  - 加载的 HTML 必须落在插件自己的目录内（禁止 ../ 穿越）；
 *  - 浮窗与插件之间用「消息通道」通信，浮窗拿不到 Node；
 *  - 窗口随插件停用 / 应用退出自动关闭（清理函数交给 ctx.effect）。
 *
 * 这里把「窗口注册表」的纯逻辑抽成可单测的类，Electron 的 BrowserWindow
 * 由外部 factory 注入 —— 单测用一个假 factory 就能覆盖全部行为。
 */
import { join, resolve, sep } from 'node:path'

export interface WindowFactory {
  create: (opts: {
    pluginId: string
    htmlPath: string
    title: string
    width: number
    height: number
    onMessage: (message: unknown) => void
    onClosed: () => void
  }) => WindowHandle
}

export interface WindowHandle {
  /** 向浮窗推一条消息（渲染端用 window.onPluginMessage 接收） */
  post: (message: unknown) => void
  close: () => void
  isClosed: () => boolean
}

export interface OpenWindowOptions {
  /** 相对插件目录的 HTML 路径 */
  entry: string
  title?: string
  width?: number
  height?: number
  /** 浮窗发消息过来时的回调；返回 void，异步处理由插件自己发起 post */
  onMessage: (message: unknown) => void
}

export interface PluginWindowServiceDeps {
  factory: WindowFactory
  /** 判断插件是否声明了浮窗能力；未声明直接拒绝 */
  canUse: (pluginId: string) => boolean
  /** 插件目录绝对路径，用于解析 entry 与做越界校验 */
  pluginDirOf: (pluginId: string) => string | undefined
  log: {
    warn: (scope: string, msg: string) => void
    error: (scope: string, msg: string) => void
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 相对路径校验：禁止绝对路径、盘符与 .. 穿越 */
function safeRelative(rel: string): boolean {
  if (!rel || !rel.trim()) return false
  if (/^[\\/]/.test(rel) || /^[A-Za-z]:/.test(rel)) return false
  return !rel.split(/[\\/]/).includes('..')
}

export class PluginWindowService {
  private readonly windows = new Map<string, WindowHandle>()
  /** pluginId → 浮窗消息处理器；在 open 时登记，close 时清除 */
  private readonly handlers = new Map<string, (message: unknown) => void>()

  constructor(private readonly deps: PluginWindowServiceDeps) {}

  /** IPC 入口：把浮窗消息路由给对应插件 */
  dispatch(pluginId: string, message: unknown): void {
    const handler = this.handlers.get(pluginId)
    if (!handler) return
    try {
      handler(message)
    } catch (err) {
      this.deps.log.error('plugin-window', `插件 ${pluginId} 处理浮窗消息失败：${messageOf(err)}`)
    }
  }

  /** 打开（或聚焦已打开的）某插件浮窗 */
  open(pluginId: string, opts: OpenWindowOptions): { ok: boolean; error?: string } {
    if (!this.deps.canUse(pluginId)) {
      return { ok: false, error: `插件 ${pluginId} 未声明浮窗能力` }
    }
    const existing = this.windows.get(pluginId)
    if (existing && !existing.isClosed()) {
      return { ok: true }
    }
    if (!safeRelative(opts.entry)) {
      return { ok: false, error: '浮窗入口必须是插件目录内的相对路径' }
    }
    const base = this.deps.pluginDirOf(pluginId)
    if (!base) return { ok: false, error: `插件 ${pluginId} 目录未知` }

    // 拼绝对路径并二次校验前缀，防止路径逃逸
    const htmlPath = resolve(join(base, opts.entry))
    const root = resolve(base)
    if (htmlPath !== root && !htmlPath.startsWith(root + sep)) {
      return { ok: false, error: '浮窗入口越出插件目录' }
    }

    try {
      const handle = this.deps.factory.create({
        pluginId,
        htmlPath,
        title: opts.title || '插件窗口',
        width: Math.max(320, Math.min(2000, opts.width ?? 900)),
        height: Math.max(240, Math.min(1600, opts.height ?? 640)),
        onMessage: (message) => this.dispatch(pluginId, message),
        onClosed: () => {
          this.windows.delete(pluginId)
          this.handlers.delete(pluginId)
        }
      })
      this.windows.set(pluginId, handle)
      this.handlers.set(pluginId, opts.onMessage)
      return { ok: true }
    } catch (err) {
      this.deps.log.error('plugin-window', `插件 ${pluginId} 打开浮窗失败：${messageOf(err)}`)
      return { ok: false, error: messageOf(err) }
    }
  }

  /** 向浮窗推消息；未打开时静默忽略（插件可能在浮窗还没开时就 post） */
  post(pluginId: string, message: unknown): void {
    const handle = this.windows.get(pluginId)
    if (!handle || handle.isClosed()) return
    try {
      handle.post(message)
    } catch (err) {
      this.deps.log.warn('plugin-window', `向插件 ${pluginId} 浮窗推消息失败：${messageOf(err)}`)
    }
  }

  isOpen(pluginId: string): boolean {
    const handle = this.windows.get(pluginId)
    return !!handle && !handle.isClosed()
  }

  /** 关闭单个浮窗 */
  close(pluginId: string): void {
    const handle = this.windows.get(pluginId)
    if (!handle) return
    try {
      handle.close()
    } catch (err) {
      this.deps.log.warn('plugin-window', `关闭插件 ${pluginId} 浮窗失败：${messageOf(err)}`)
    } finally {
      this.windows.delete(pluginId)
      this.handlers.delete(pluginId)
    }
  }

  /** 全部关闭，退出 / 插件重载时调用 */
  closeAll(): void {
    for (const id of [...this.windows.keys()]) this.close(id)
  }
}
