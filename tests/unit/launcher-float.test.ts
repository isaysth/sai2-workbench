import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const DIR = resolve('resources/builtin-plugins/launcher-float')
const plugin = require('../../resources/builtin-plugins/launcher-float/index.js')

function fakeCtx() {
  const out = {
    configured: null as null | (() => unknown),
    cleaned: 0,
    statuses: [] as Array<{ text: string; level: string }>,
    events: new Map<string, (payload?: unknown) => void>(),
    actions: [] as Array<{ id: string; label: string; run?: () => void }>,
    floats: 0
  }
  const wm = {
    configure: (getter: (() => unknown) | null) => {
      if (getter) out.configured = getter
      else out.configured = null
    },
    isFloat: () => out.floats > 0,
    enterFloat: () => { out.floats += 1 },
    toggleFloat: () => { out.floats += 1 }
  }
  const ctx = {
    id: 'launcher-float',
    log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    get: () => wm,
    effect: (fn: () => void) => {
      out.cleaned += 1
      // 保存清理函数，测试里显式调用验证停用时复位
      ;(out as unknown as { cleanup: Array<() => void> }).cleanup ??= []
      ;(out as unknown as { cleanup: Array<() => void> }).cleanup.push(fn)
    },
    setStatus: (text: string, level = 'ok') => out.statuses.push({ text, level }),
    on: (event: string, handler: (payload?: unknown) => void) => out.events.set(event, handler),
    addToolbarAction: (a: { id: string; label: string; run?: () => void }) => out.actions.push(a)
  }
  return { ctx, out, wm }
}

describe('launcher-float 官方插件', () => {
  it('plugin.json 清单合法，依赖 window-manager 服务', () => {
    const m = JSON.parse(readFileSync(resolve(DIR, 'plugin.json'), 'utf8'))
    expect(m.id).toBe('launcher-float')
    expect(m.apiVersion).toBe(1)
    expect(m.entry).toBe('index.js')
    expect(m.inject).toContain('window-manager')
    expect(m.system).toBe(false)
  })

  it('配置表单覆盖全部行为开关', () => {
    for (const key of ['autoFloatOnSai2', 'minimizeToTray', 'closeToTray', 'alwaysOnTop', 'floatWidth', 'floatHeight']) {
      expect(plugin.configSchema[key], key).toBeTruthy()
    }
    expect(plugin.configSchema.autoFloatOnSai2.default).toBe(true)
    expect(plugin.configSchema.closeToTray.default).toBe(false)
  })

  it('apply 注入配置 getter、订阅启动事件与手动动作', () => {
    const { ctx, out } = fakeCtx()
    const config = { autoFloatOnSai2: true, minimizeToTray: true, closeToTray: false, alwaysOnTop: true, floatWidth: 320, floatHeight: 120 }
    plugin.apply(ctx, config)
    expect(out.configured).toBeTypeOf('function')
    expect(out.configured!()).toMatchObject({ floatWidth: 320, autoFloatOnSai2: true })
    expect(out.events.has('opener_after_launch')).toBe(true)
    expect(out.actions[0]?.id).toBe('launcher-float.toggle')
    expect(out.statuses.length).toBeGreaterThan(0)
  })

  it('仅在 SAI2 启动时进入悬浮；关掉自动开关后不再触发', () => {
    const { ctx, out } = fakeCtx()
    const config = { autoFloatOnSai2: true, minimizeToTray: false, closeToTray: false, alwaysOnTop: true, floatWidth: 320, floatHeight: 120 }
    plugin.apply(ctx, config)
    const handler = out.events.get('opener_after_launch')!
    handler({ openerId: 'opener-ps' })
    expect(out.floats).toBe(0)
    handler({ openerId: 'opener-sai2' })
    expect(out.floats).toBe(1)
    config.autoFloatOnSai2 = false
    handler({ openerId: 'opener-sai2' })
    expect(out.floats).toBe(1)
  })

  it('停用时通过 effect 把窗口管理器复位', () => {
    const { ctx, out } = fakeCtx()
    plugin.apply(ctx, { autoFloatOnSai2: true })
    const cleanups = (out as unknown as { cleanup: Array<() => void> }).cleanup
    for (const fn of cleanups) fn()
    expect(out.configured).toBeNull()
  })
})
