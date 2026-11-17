import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { PluginWindowService, type WindowFactory, type WindowHandle } from '../../src/main/plugins/windows'

function fakeLog() {
  return { warn: () => undefined, error: () => undefined }
}

function harness(canUse = true) {
  const created: Array<{ pluginId: string; htmlPath: string; width: number; height: number }> = []
  const posted: unknown[] = []
  let closed = 0
  let handleClosed = false
  const factory: WindowFactory = {
    create(opts) {
      created.push({ pluginId: opts.pluginId, htmlPath: opts.htmlPath, width: opts.width, height: opts.height })
      return {
        post: (m) => posted.push(m),
        close: () => { closed += 1; handleClosed = true; opts.onClosed() },
        isClosed: () => handleClosed
      } as WindowHandle
    }
  }
  const pluginDir = resolve('C:/plugins/demo')
  const service = new PluginWindowService({
    factory,
    canUse: () => canUse,
    pluginDirOf: (id) => (id === 'demo' ? pluginDir : undefined),
    log: fakeLog()
  })
  return { service, created, posted, pluginDir, getClosed: () => closed }
}

describe('PluginWindowService', () => {
  it('未声明浮窗能力的插件被拒绝', () => {
    const h = harness(false)
    const r = h.service.open('demo', { entry: 'ui/panel.html', onMessage: () => undefined })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未声明')
    expect(h.created).toHaveLength(0)
  })

  it('正确解析插件目录内的 HTML，clamp 尺寸', () => {
    const h = harness()
    const r = h.service.open('demo', { entry: 'ui/panel.html', width: 99999, onMessage: () => undefined })
    expect(r.ok).toBe(true)
    expect(h.created[0]?.htmlPath).toBe(join(h.pluginDir, 'ui/panel.html'))
    expect(h.created[0]?.width).toBe(2000)
    expect(h.created[0]?.height).toBe(640)
  })

  it('拒绝 ../ 穿越与绝对路径', () => {
    const h = harness()
    expect(h.service.open('demo', { entry: '../secret.html', onMessage: () => undefined }).ok).toBe(false)
    expect(h.service.open('demo', { entry: 'C:/secret.html', onMessage: () => undefined }).ok).toBe(false)
    expect(h.created).toHaveLength(0)
  })

  it('重复 open 不重复建窗', () => {
    const h = harness()
    expect(h.service.open('demo', { entry: 'a.html', onMessage: () => undefined }).ok).toBe(true)
    expect(h.service.open('demo', { entry: 'a.html', onMessage: () => undefined }).ok).toBe(true)
    expect(h.created).toHaveLength(1)
  })

  it('浮窗消息路由到插件 handler；close 后不再路由', () => {
    const h = harness()
    const got: unknown[] = []
    h.service.open('demo', { entry: 'a.html', onMessage: (m) => got.push(m) })
    h.service.dispatch('demo', { type: 'grab' })
    expect(got).toEqual([{ type: 'grab' }])
    h.service.close('demo')
    h.service.dispatch('demo', { type: 'after-close' })
    expect(got).toHaveLength(1)
    expect(h.getClosed()).toBe(1)
  })

  it('post 推给浮窗；未开窗时静默忽略', () => {
    const h = harness()
    h.service.post('demo', { a: 1 }) // 未开，不抛
    h.service.open('demo', { entry: 'a.html', onMessage: () => undefined })
    h.service.post('demo', { a: 2 })
    expect(h.posted).toEqual([{ a: 2 }])
  })

  it('closeAll 关闭全部浮窗', () => {
    const h = harness()
    h.service.open('demo', { entry: 'a.html', onMessage: () => undefined })
    h.service.closeAll()
    expect(h.getClosed()).toBe(1)
    expect(h.service.isOpen('demo')).toBe(false)
  })
})
