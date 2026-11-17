import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const PLUGIN_DIR = resolve('contrib/sai2-fx-studio')
const plugin = require('../../contrib/sai2-fx-studio/index.js')

/** 造一个最小 PluginContext mock，记录贡献点 */
function fakeCtx() {
  const out = { fileActions: [], toolbarActions: [], statuses: [], opened: null, effects: [], posts: [] }
  const ctx = {
    id: 'sai2-fx-studio',
    log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    config: { suiteDir: '', autoInject: false, previewMaxDim: 900 },
    setStatus: (text, level) => out.statuses.push({ text, level }),
    addToolbarAction: (a) => out.toolbarActions.push(a),
    addFileAction: (a) => out.fileActions.push(a),
    addPage: () => undefined,
    effect: (fn) => out.effects.push(fn),
    dialog: { error: () => undefined, info: () => undefined, confirm: () => true },
    windows: {
      open: (opts) => { out.opened = opts; return { ok: true } },
      post: (m) => out.posts.push(m),
      close: () => undefined,
      isOpen: () => true
    }
  }
  return { ctx, out }
}

describe('FX Studio 插件装配', () => {
  it('plugin.json 清单字段合法', () => {
    const m = JSON.parse(readFileSync(resolve(PLUGIN_DIR, 'plugin.json'), 'utf8'))
    expect(m.id).toBe('sai2-fx-studio')
    expect(m.apiVersion).toBe(1)
    expect(m.entry).toBe('index.js')
    expect(m.capabilities).toContain('window')
    expect(Array.isArray(m.permissions)).toBe(true)
  })

  it('configSchema 全部字段合法（type 在支持集内）', () => {
    const allowed = new Set(['string', 'bool', 'int', 'float', 'enum', 'path', 'list'])
    for (const [key, field] of Object.entries(plugin.configSchema)) {
      expect(allowed.has(field.type), `${key}.type`).toBe(true)
      expect(typeof field.label).toBe('string')
    }
  })

  it('apply 注册工具栏 + 右键动作并上报状态', () => {
    const { ctx, out } = fakeCtx()
    plugin.apply(ctx, ctx.config)
    expect(out.toolbarActions).toHaveLength(1)
    expect(out.toolbarActions[0].label).toBe('FX Studio')
    expect(out.fileActions).toHaveLength(1)
    expect(out.fileActions[0].exts).toContain('.sai2')
    expect(out.statuses.length).toBeGreaterThan(0)
  })

  it('未配置套件时状态为 warn', () => {
    const { ctx, out } = fakeCtx()
    plugin.apply(ctx, ctx.config)
    expect(out.statuses.some((s) => s.level === 'warn')).toBe(true)
  })

  it('工具栏动作能打开浮窗（声明了 window 能力）', () => {
    const { ctx, out } = fakeCtx()
    plugin.apply(ctx, ctx.config)
    out.toolbarActions[0].run()
    expect(out.opened).not.toBeNull()
    expect(out.opened.entry).toBe('ui/panel.html')
    expect(typeof out.opened.onMessage).toBe('function')
  })

  it('浮窗消息路由：refreshLayers 不抛错（agent 离线）', async () => {
    const { ctx, out } = fakeCtx()
    plugin.apply(ctx, ctx.config)
    out.toolbarActions[0].run()
    // agent 离线时 refreshLayers 会走 catch，不应抛出
    await expect(Promise.resolve(out.opened.onMessage({ type: 'refreshLayers' }))).resolves.toBeUndefined()
  })
})
