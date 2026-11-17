/**
 * 主窗口管理器：悬浮窗 + 托盘 + 最小化/关闭行为。
 *
 * 设计原则：
 * - 这里只做「窗口能做什么」，不做「什么时候做」——触发时机交给 launcher-float 插件。
 * - 不直接 import electron 的 Tray / Menu，注入 TrayHandle 工厂，方便纯逻辑单测。
 * - 配置项通过 getter 注入：插件 apply 时把 ctx.config 包成 getter 传进来，
 *   这样插件页保存配置后（保存会触发插件 reload）新值立刻生效。
 */
import { CH } from '@shared/channels'
import type { FloatModeState } from '@shared/types'
import type { Logger } from './logger'
import type { TrayHandle, TrayMenuItem } from './tray'

export interface FloatOptions {
  /** 启动 SAI2 后自动变悬浮窗（插件侧判断，这里只保存状态用） */
  autoFloatOnSai2: boolean
  /** 最小化按钮改为收进托盘 */
  minimizeToTray: boolean
  /** 关闭按钮改为收进托盘（不退出） */
  closeToTray: boolean
  /** 悬浮窗尺寸 */
  floatWidth: number
  floatHeight: number
  /** 悬浮窗置顶 */
  alwaysOnTop: boolean
}

export const DEFAULT_FLOAT_OPTIONS: FloatOptions = {
  autoFloatOnSai2: true,
  minimizeToTray: true,
  closeToTray: false,
  floatWidth: 336,
  floatHeight: 132,
  alwaysOnTop: true
}

/** 窗口需要的那部分 BrowserWindow 接口（单测里用假对象实现） */
export interface ManagedWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  isMaximized(): boolean
  getBounds(): { x: number; y: number; width: number; height: number }
  getNormalBounds(): { x: number; y: number; width: number; height: number }
  getMinimumSize(): number[]
  setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }): void
  setMinimumSize(width: number, height: number): void
  setAlwaysOnTop(flag: boolean, level?: string): void
  setSkipTaskbar(skip: boolean): void
  show(): void
  hide(): void
  focus(): void
  minimize(): void
  restore(): void
  maximize(): void
  on(event: 'close', listener: (e: { preventDefault: () => void }) => void): void
}

export interface WindowManagerDeps {
  log: Logger
  createTray: (handlers: {
    onActivate: () => void
    onCommand: (id: string) => void
  }) => TrayHandle | null
  workArea: () => { x: number; y: number; width: number; height: number }
  broadcast: (channel: string, payload: unknown) => void
  quit: () => void
}

const MARGIN = 24

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

/** 从插件配置里挑出需要的字段并夹到安全范围，避免坏配置把窗口缩成 1px */
export function normalizeFloatOptions(raw: unknown): FloatOptions {
  const o = (raw ?? {}) as Partial<FloatOptions>
  return {
    autoFloatOnSai2: o.autoFloatOnSai2 !== false,
    minimizeToTray: o.minimizeToTray !== false,
    closeToTray: o.closeToTray === true,
    floatWidth: clampInt(o.floatWidth, DEFAULT_FLOAT_OPTIONS.floatWidth, 240, 560),
    floatHeight: clampInt(o.floatHeight, DEFAULT_FLOAT_OPTIONS.floatHeight, 100, 260),
    alwaysOnTop: o.alwaysOnTop !== false
  }
}

export class WindowManager {
  private win: ManagedWindow | null = null
  private tray: TrayHandle | null = null
  private configured: (() => unknown) | null = null
  private floatMode = false
  private quitting = false
  private launchHandler: (() => void) | null = null

  private saved: {
    bounds: { x: number; y: number; width: number; height: number }
    min: [number, number]
    alwaysOnTop: boolean
    maximized: boolean
  } | null = null

  constructor(private readonly deps: WindowManagerDeps) {}

  /** 主窗口建好后调用一次；负责拦截「关闭」按钮 */
  attach(win: ManagedWindow): void {
    this.win = win
    win.on('close', (e) => {
      if (this.quitting || !this.options().closeToTray) return
      e.preventDefault()
      this.hideToTray()
    })
    this.refreshTray()
  }

  /** 托盘菜单里的「启动 SAI2」由主进程注入，避免管理器反向依赖打开器服务 */
  setLaunchHandler(fn: (() => void) | null): void {
    this.launchHandler = fn
    this.refreshTray()
  }

  /** 插件启用时传入配置 getter；停用时传 null 复位 */
  configure(getter: (() => unknown) | null): void {
    this.configured = getter
    if (!getter && this.floatMode) this.exitFloat()
    if (!getter) this.destroyTray()
    else this.ensureTray()
    this.refreshTray()
    this.broadcastState()
    const o = this.options()
    this.deps.log.info(
      'window-manager',
      `插件已接入：自动悬浮=${o.autoFloatOnSai2 ? '开' : '关'} 最小化到托盘=${o.minimizeToTray ? '开' : '关'} 关闭到托盘=${o.closeToTray ? '开' : '关'}`
    )
  }

  /** 插件配置在别处被改了（或需要刷新菜单标题）时调用 */
  refresh(): void {
    this.refreshTray()
    this.broadcastState()
  }

  options(): FloatOptions {
    if (!this.configured) return DEFAULT_FLOAT_OPTIONS
    try {
      return normalizeFloatOptions(this.configured())
    } catch {
      return DEFAULT_FLOAT_OPTIONS
    }
  }

  isEnabled(): boolean {
    return this.configured !== null
  }

  isFloat(): boolean {
    return this.floatMode
  }

  /** 给渲染端首次查询用（插件可能早于页面加载就切了模式） */
  state(): FloatModeState {
    const o = this.options()
    return {
      active: this.floatMode,
      width: this.configured ? o.floatWidth : DEFAULT_FLOAT_OPTIONS.floatWidth,
      height: this.configured ? o.floatHeight : DEFAULT_FLOAT_OPTIONS.floatHeight
    }
  }

  /** 最小化按钮的实际行为由插件配置决定 */
  minimizeAction(): 'tray' | 'window' {
    return this.configured && this.options().minimizeToTray ? 'tray' : 'window'
  }

  handleMinimize(): void {
    if (this.minimizeAction() === 'tray') this.hideToTray()
    else this.win?.minimize()
  }

  enterFloat(): void {
    const win = this.win
    if (!win || win.isDestroyed() || this.floatMode) return
    const o = this.options()
    const bounds = win.getNormalBounds()
    const [minW = 0, minH = 0] = win.getMinimumSize()
    this.saved = {
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      min: [minW, minH],
      // BrowserWindow 没有 getter 读 alwaysOnTop 状态，按内核默认（false）复位
      alwaysOnTop: false,
      maximized: win.isMaximized()
    }
    const area = this.deps.workArea()
    const w = Math.min(o.floatWidth, Math.max(240, area.width - 32))
    const h = Math.min(o.floatHeight, Math.max(100, area.height - 32))
    const x = Math.max(area.x + 8, area.x + area.width - w - MARGIN)
    const y = Math.max(area.y + 8, area.y + MARGIN)

    try {
      win.setMinimumSize(0, 0)
      win.setBounds({ x, y, width: w, height: h })
      win.setAlwaysOnTop(o.alwaysOnTop, 'floating')
      this.floatMode = true
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      this.deps.log.info('window-manager', `已进入悬浮窗 ${w}×${h}`)
      this.refreshTray()
      this.broadcastState()
    } catch (err) {
      // 半途失败要恢复原状，别把用户主窗口弄成一条缝
      this.restoreSaved()
      this.deps.log.warn('window-manager', `进入悬浮窗失败：${String(err)}`)
    }
  }

  exitFloat(): void {
    if (!this.floatMode) return
    this.floatMode = false
    this.restoreSaved()
    this.deps.log.info('window-manager', '已还原主窗口')
    this.refreshTray()
    this.broadcastState()
  }

  toggleFloat(): void {
    if (this.floatMode) this.exitFloat()
    else this.enterFloat()
  }

  hideToTray(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (!this.tray) this.ensureTray()
    win.setSkipTaskbar(true)
    win.hide()
    this.deps.log.info('window-manager', '窗口已收进托盘')
    this.refreshTray()
  }

  showFromTray(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.setSkipTaskbar(false)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    this.refreshTray()
  }

  /** 退出流程开始（app.before-quit）：此后关闭窗口不再被托盘拦截 */
  beginQuit(): void {
    this.quitting = true
  }

  /** 托盘存在时，关掉最后一个窗口不应退出进程 */
  shouldKeepAlive(): boolean {
    return !this.quitting && this.tray !== null
  }

  quit(): void {
    this.beginQuit()
    this.destroyTray()
    this.deps.quit()
  }

  dispose(): void {
    this.destroyTray()
    this.win = null
    this.configured = null
  }

  // ------------------------------------------------------------------ 内部

  private restoreSaved(): void {
    const win = this.win
    if (!win || win.isDestroyed() || !this.saved) return
    const s = this.saved
    this.saved = null
    try {
      win.setAlwaysOnTop(s.alwaysOnTop)
      win.setBounds(s.bounds)
      win.setMinimumSize(s.min[0], s.min[1])
      if (s.maximized && !win.isMaximized()) win.maximize()
    } catch (err) {
      this.deps.log.warn('window-manager', `还原窗口几何失败：${String(err)}`)
    }
  }

  private ensureTray(): void {
    if (this.tray) return
    this.tray = this.deps.createTray({
      onActivate: () => this.showFromTray(),
      onCommand: (id) => this.onTrayCommand(id)
    })
    if (this.tray) this.deps.log.info('window-manager', '托盘图标已创建')
    else this.deps.log.warn('window-manager', '托盘图标创建失败，相关选项不可用')
  }

  private destroyTray(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private onTrayCommand(id: string): void {
    switch (id) {
      case 'show':
        this.showFromTray()
        break
      case 'float':
        this.toggleFloat()
        break
      case 'launch':
        this.launchHandler?.()
        break
      case 'quit':
        this.quit()
        break
      default:
        break
    }
  }

  private refreshTray(): void {
    if (!this.tray) return
    const items: TrayMenuItem[] = [
      { id: 'show', label: '显示主窗口' },
      { id: 'float', label: this.floatMode ? '展开主界面' : '切换为悬浮窗' }
    ]
    if (this.launchHandler) items.push({ id: 'launch', label: '启动 SAI2' })
    items.push({ id: 'sep', label: '', separator: true }, { id: 'quit', label: '退出工作台' })
    this.tray.setItems(items, this.floatMode ? 'sai2工作台 · 悬浮中' : 'sai2工作台')
  }

  private broadcastState(): void {
    this.deps.broadcast(CH.windowFloatChanged, this.state())
  }
}
