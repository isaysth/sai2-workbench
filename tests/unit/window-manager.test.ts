import { describe, expect, it } from 'vitest'
import { CH } from '../../src/shared/channels'
import {
  DEFAULT_FLOAT_OPTIONS,
  normalizeFloatOptions,
  WindowManager,
  type ManagedWindow
} from '../../src/main/window-manager'
import type { TrayHandle, TrayMenuItem } from '../../src/main/tray'

function fakeLogger() {
  return { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined }
}

function fakeWindow(init: { destroyed?: boolean } = {}) {
  const calls: string[] = []
  let closeHandler: ((e: { preventDefault: () => void }) => void) | null = null
  let bounds = { x: 100, y: 80, width: 1360, height: 860 }
  const win: ManagedWindow & {
    calls: string[]
    lastBounds: () => { x: number; y: number; width: number; height: number }
    fireClose: () => { prevented: boolean }
    setVisible: (v: boolean) => void
    visible: () => boolean
  } = {
    calls,
    isDestroyed: () => init.destroyed === true,
    isMinimized: () => false,
    isMaximized: () => false,
    getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...bounds }),
    getMinimumSize: () => [1040, 640],
    setBounds: (b) => {
      calls.push('bounds')
      bounds = {
        x: b.x ?? bounds.x,
        y: b.y ?? bounds.y,
        width: b.width ?? bounds.width,
        height: b.height ?? bounds.height
      }
    },
    setMinimumSize: (w, h) => calls.push(`min:${w}x${h}`),
    setAlwaysOnTop: (flag, level) => calls.push(`top:${flag}:${level ?? ''}`),
    setSkipTaskbar: (skip) => calls.push(`taskbar:${skip}`),
    show: () => calls.push('show'),
    hide: () => calls.push('hide'),
    focus: () => calls.push('focus'),
    minimize: () => calls.push('minimize'),
    restore: () => calls.push('restore'),
    maximize: () => calls.push('maximize'),
    on: (event, listener) => {
      if (event === 'close') closeHandler = listener
    },
    lastBounds: () => ({ ...bounds }),
    fireClose: () => {
      let prevented = false
      closeHandler?.({ preventDefault: () => { prevented = true } })
      return { prevented }
    },
    setVisible: () => undefined,
    visible: () => true
  }
  return win
}

function makeManager(init: { destroyed?: boolean } = {}) {
  const win = fakeWindow(init)
  let trayItems: TrayMenuItem[] = []
  let trayTooltip = ''
  let destroyed = 0
  const tray: TrayHandle = {
    setItems: (items, tooltip) => { trayItems = items; trayTooltip = tooltip ?? '' },
    destroy: () => { destroyed += 1 }
  }
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  let quits = 0
  let launches = 0
  let recreates = 0
  let ballVisible = false
  let ballShows = 0
  let ballHides = 0
  let trayHandlers: { onActivate: () => void; onCommand: (id: string) => void } | null = null
  const ball = {
    show: () => { ballVisible = true; ballShows += 1 },
    hide: () => { ballVisible = false; ballHides += 1 },
    isVisible: () => ballVisible,
    resetPosition: () => undefined,
    dispose: () => undefined
  }
  const wm = new WindowManager({
    log: fakeLogger(),
    createTray: (handlers) => {
      trayHandlers = handlers
      return tray
    },
    workArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    quit: () => { quits += 1 },
    recreateWindow: () => { recreates += 1 },
    ball
  })
  wm.setLaunchHandler(() => { launches += 1 })
  wm.attach(win)
  return {
    wm, win, tray, broadcasts, ball,
    getItems: () => trayItems,
    trayItemsTooltip: () => trayTooltip,
    getDestroyed: () => destroyed,
    getQuits: () => quits,
    getLaunches: () => launches,
    getRecreates: () => recreates,
    getBallShows: () => ballShows,
    getBallHides: () => ballHides,
    command: (id: string) => trayHandlers?.onCommand(id),
    activate: () => trayHandlers?.onActivate()
  }
}

describe('悬浮窗配置归一化', () => {
  it('缺字段用默认值，越界值被夹到安全范围', () => {
    expect(normalizeFloatOptions(undefined)).toEqual(DEFAULT_FLOAT_OPTIONS)
    const got = normalizeFloatOptions({
      autoFloatOnSai2: 0,
      minimizeToTray: true,
      closeToTray: 'yes',
      floatWidth: 9999,
      floatHeight: 1,
      alwaysOnTop: false
    })
    expect(got.autoFloatOnSai2).toBe(true)
    expect(got.closeToTray).toBe(false)
    expect(got.floatWidth).toBe(560)
    expect(got.floatHeight).toBe(100)
    expect(got.alwaysOnTop).toBe(false)
  })
})

describe('WindowManager 悬浮与托盘', () => {
  it('未接入插件时最小化走系统任务栏，托盘不存在', () => {
    const m = makeManager()
    expect(m.wm.isEnabled()).toBe(false)
    expect(m.wm.minimizeAction()).toBe('window')
    m.wm.handleMinimize()
    expect(m.win.calls).toContain('minimize')
    expect(m.getItems()).toEqual([])
  })

  it('接入插件后按配置收进托盘，托盘菜单可用', () => {
    const m = makeManager()
    m.wm.configure(() => ({ minimizeToTray: true, closeToTray: true, floatWidth: 300, floatHeight: 120 }))
    expect(m.wm.minimizeAction()).toBe('tray')
    m.wm.handleMinimize()
    expect(m.win.calls).toContain('hide')
    expect(m.getItems().map((i) => i.id)).toContain('launch')
    expect(m.wm.shouldKeepAlive()).toBe(true)
  })

  it('进入球模式隐藏主窗口并显示球；退出后完整还原主窗口', () => {
    const m = makeManager()
    m.wm.configure(() => ({ ballSize: 96, alwaysOnTop: true }))
    const before = m.win.lastBounds()

    m.wm.enterFloat()
    // 球模式不再缩主窗口，而是整窗隐藏 + 任务栏收起 + 球显示
    expect(m.win.lastBounds()).toMatchObject(before)
    expect(m.win.calls).toContain('hide')
    expect(m.win.calls).toContain('taskbar:true')
    expect(m.getBallShows()).toBe(1)
    expect(m.ball.isVisible()).toBe(true)
    expect(m.wm.isFloat()).toBe(true)
    expect(m.broadcasts.at(-1)?.channel).toBe(CH.windowFloatChanged)
    expect((m.broadcasts.at(-1)?.payload as { active: boolean }).active).toBe(true)
    expect(m.getItems().find((i) => i.id === 'float')?.label).toBe('展开主界面')
    expect(m.trayItemsTooltip()).toBe('sai2工作台 · 球已浮起')

    m.wm.exitFloat()
    expect(m.getBallHides()).toBe(1)
    expect(m.ball.isVisible()).toBe(false)
    expect(m.win.calls).toContain('taskbar:false')
    expect(m.win.calls).toContain('show')
    expect(m.win.lastBounds()).toMatchObject({ x: 100, y: 80, width: 1360, height: 860 })
    expect(m.wm.isFloat()).toBe(false)
    expect(m.getItems().find((i) => i.id === 'float')?.label).toBe('收成悬浮球')
  })

  it('窗口已销毁时点「收成悬浮球」：重建后自动进球，而不是停在普通窗口（N-027）', () => {
    const m = makeManager({ destroyed: true })
    m.wm.configure(() => ({}))
    expect(m.getItems().find((i) => i.id === 'float')?.label).toBe('收成悬浮球')

    m.command('float')
    expect(m.getRecreates()).toBe(1)
    // pendingBall 要等 attach 后消费；此时还没建新窗，球不会提前出现
    expect(m.getBallShows()).toBe(0)

    // 模拟主进程重建并 attach（真实链路里由 openMainWindow 完成）
    const fresh = fakeWindow()
    m.wm.attach(fresh)
    expect(m.getBallShows()).toBe(1)
    expect(m.ball.isVisible()).toBe(true)
    expect(m.wm.isFloat()).toBe(true)
    expect(fresh.calls).toContain('hide')
  })

  it('球浮着时点托盘「显示主窗口」= 展开，不会留下球+窗口两套界面', () => {
    const m = makeManager()
    m.wm.configure(() => ({}))
    m.wm.enterFloat()
    expect(m.ball.isVisible()).toBe(true)

    m.activate()
    expect(m.wm.isFloat()).toBe(false)
    expect(m.getBallHides()).toBe(1)
    expect(m.ball.isVisible()).toBe(false)
  })

  it('关闭按钮在 closeToTray 下被拦截，quit 时放行', () => {
    const m = makeManager()
    m.wm.configure(() => ({ closeToTray: false }))
    expect(m.win.fireClose().prevented).toBe(false)
    m.wm.configure(() => ({ closeToTray: true }))
    expect(m.win.fireClose().prevented).toBe(true)
    expect(m.win.calls).toContain('hide')
    m.wm.quit()
    expect(m.getQuits()).toBe(1)
    expect(m.wm.shouldKeepAlive()).toBe(false)
  })

  it('托盘命令可以切悬浮、启动 SAI2、退出', () => {
    const m = makeManager()
    m.wm.configure(() => ({}))
    expect(m.getItems().map((i) => i.id)).toEqual(['show', 'float', 'launch', 'sep', 'quit'])
    m.command('float')
    expect(m.wm.isFloat()).toBe(true)
    m.command('launch')
    expect(m.getLaunches()).toBe(1)
    m.activate()
    expect(m.win.calls).toContain('show')
    m.command('quit')
    expect(m.getQuits()).toBe(1)
    m.wm.dispose()
    expect(m.getDestroyed()).toBe(1)
  })

  it('窗口已销毁时托盘「打开」改为重建主窗口，不再静默失效', () => {
    const m = makeManager({ destroyed: true })
    m.wm.configure(() => ({}))
    // 窗口没了，首项文案要明说「重新打开」，否则用户不知道还能点
    expect(m.getItems()[0]).toMatchObject({ id: 'show', label: '重新打开主窗口' })

    expect(() => m.activate()).not.toThrow()
    expect(m.getRecreates()).toBe(1)
    // 已销毁的窗口不该再被 show / focus
    expect(m.win.calls).not.toContain('show')
    expect(m.win.calls).not.toContain('focus')
  })

  it('窗口存活时托盘「打开」直接显示，不触发重建', () => {
    const m = makeManager()
    m.wm.configure(() => ({}))
    expect(m.getItems()[0]).toMatchObject({ id: 'show', label: '显示主窗口' })

    m.activate()
    expect(m.getRecreates()).toBe(0)
    expect(m.win.calls).toContain('show')
    expect(m.win.calls).toContain('focus')
  })
})
