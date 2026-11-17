import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConfigStore } from '../../src/main/config'
import type { Logger } from '../../src/main/logger'
import { ServiceContainer } from '../../src/main/plugins/container'
import { PluginLoader, type PluginLoaderDeps, type PluginModule } from '../../src/main/plugins/loader'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fakeConfig(): ConfigStore & { values: Record<string, unknown> } {
  const values: Record<string, unknown> = { 'plugins.disabled': [], 'plugins.config': {} }
  return {
    values,
    get(key: string): unknown {
      return values[key]
    },
    set(key: string, value: unknown): void {
      values[key] = value
    }
  } as unknown as ConfigStore & { values: Record<string, unknown> }
}

function fakeLog(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined
  } as unknown as Logger
}

interface Harness {
  loader: PluginLoader
  container: ServiceContainer
  config: ConfigStore & { values: Record<string, unknown> }
  modules: Map<string, PluginModule>
  builtinDir: string
  userDir: string
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'sai2-plugin-'))
  tempRoots.push(root)
  const builtinDir = join(root, 'builtin')
  const userDir = join(root, 'user')
  mkdirSync(builtinDir)
  mkdirSync(userDir)
  const container = new ServiceContainer()
  const config = fakeConfig()
  const modules = new Map<string, PluginModule>()
  const deps: PluginLoaderDeps = {
    log: fakeLog(),
    container,
    builtinDir,
    userDir,
    pluginDataDir: join(root, 'data'),
    config,
    loadModule: (entry) => modules.get(entry) ?? { apply: () => undefined },
    createContext: () => ({}),
    onChanged: () => undefined
  }
  return { loader: new PluginLoader(deps), container, config, modules, builtinDir, userDir }
}

function plugin(
  parent: string,
  folder: string,
  manifest: Record<string, unknown>,
  file = true
): string {
  const dir = join(parent, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ apiVersion: 1, entry: 'index.js', ...manifest }))
  if (file) writeFileSync(join(dir, 'index.js'), 'module.exports = { apply() {} }')
  return dir
}

const base = (id: string) => ({ id, name: id, version: '1.0.0' })

describe('PluginLoader', () => {
  it('坏插件标 failed 并给出可读原因，不影响其它插件', async () => {
    const h = harness()
    plugin(h.builtinDir, 'broken', base('broken'), false)
    plugin(h.builtinDir, 'good', base('good'))
    await h.loader.initialize()
    const broken = h.loader.list().find((p) => p.id === 'broken')
    const good = h.loader.list().find((p) => p.id === 'good')
    expect(broken?.status).toBe('failed')
    expect(broken?.error).toContain('入口文件不存在')
    expect(good?.status).toBe('running')
  })

  it('缺依赖标 waiting，服务提供后自动变 running', async () => {
    const h = harness()
    plugin(h.builtinDir, 'needs', { ...base('needs'), inject: ['launcher'] })
    await h.loader.initialize()
    expect(h.loader.list()[0]?.status).toBe('waiting')
    expect(h.loader.list()[0]?.error).toContain('等待依赖：launcher')

    h.container.provide('launcher', { launch: () => undefined })
    await h.loader.refresh()
    expect(h.loader.list()[0]?.status).toBe('running')
  })

  it('apply 抛错的插件标 failed 并自动禁用', async () => {
    const h = harness()
    const dir = plugin(h.builtinDir, 'boom', base('boom'))
    h.modules.set(join(dir, 'index.js'), {
      apply() {
        throw new Error('故意炸')
      }
    })
    await h.loader.initialize()
    expect(h.loader.list()[0]?.status).toBe('failed')
    expect(h.loader.list()[0]?.error).toBe('故意炸')
    expect(h.config.values['plugins.disabled']).toEqual(['boom'])
  })

  it('循环依赖的插件全部 failed，错误文案带具体路径', async () => {
    const h = harness()
    plugin(h.builtinDir, 'a', { ...base('a'), inject: ['b'] })
    plugin(h.builtinDir, 'b', { ...base('b'), inject: ['a'] })
    await h.loader.initialize()
    const statuses = h.loader.list().map((p) => ({ status: p.status, error: p.error ?? '' }))
    expect(statuses.every((s) => s.status === 'failed')).toBe(true)
    expect(statuses.some((s) => s.error.includes('循环依赖'))).toBe(true)
  })

  it('用户目录里同 id 的插件覆盖内置版本', async () => {
    const h = harness()
    plugin(h.builtinDir, 'dup', { ...base('dup'), description: '内置' })
    plugin(h.userDir, 'dup', { ...base('dup'), description: '用户' })
    await h.loader.initialize()
    const found = h.loader.list().filter((p) => p.id === 'dup')
    expect(found).toHaveLength(1)
    expect(found[0]?.description).toBe('用户')
    expect(found[0]?.source).toBe('user')
  })

  it('系统插件不能通过正常接口禁用', async () => {
    const h = harness()
    plugin(h.builtinDir, 'core', { ...base('core'), system: true })
    await h.loader.initialize()
    expect(h.loader.setEnabled('core', false).ok).toBe(false)
    expect(h.loader.list()[0]?.status).toBe('running')
  })
})
