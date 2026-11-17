import { describe, expect, it } from 'vitest'
import type { ConfigStore } from '../../src/main/config'
import type { Logger } from '../../src/main/logger'
import { OpenersService, type SpawnRequest } from '../../src/main/openers/service'

function fakeConfig(values: Record<string, unknown>): ConfigStore {
  return {
    get: (key: string) => values[key],
    set: (key: string, value: unknown) => { values[key] = value }
  } as unknown as ConfigStore
}

function fakeLog(): Logger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger
}

function harness() {
  const runs: SpawnRequest[] = []
  const events: Array<{ event: string; payload?: unknown }> = []
  const config = fakeConfig({
    'openers.default': 'opener-sai2',
    'openers.sai2': { path: '', args: '' },
    'openers.ps': { path: '', args: '' }
  })
  const service = new OpenersService({
    config,
    log: fakeLog(),
    runner: async (req) => { runs.push(req) },
    emit: (event, payload) => { events.push({ event, payload }) }
  })
  return { service, config, runs, events }
}

describe('OpenersService', () => {
  it('没有任何可用打开器时返回中文引导，不 spawn', async () => {
    const h = harness()
    h.service.register({ id: 'opener-sai2', label: 'SAI2', configKey: 'sai2', exts: ['.sai2'] })
    const res = await h.service.launch()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('填')
    expect(h.runs).toHaveLength(0)
  })

  it('按扩展名优先选打开器，否则回退全局默认', async () => {
    const h = harness()
    // 用当前进程可执行路径冒充已存在的程序，只为通过 existsSync
    const exe = process.execPath
    h.config.set('openers.sai2', { path: exe, args: '' })
    h.config.set('openers.ps', { path: exe, args: '-ps' })
    h.service.register({ id: 'opener-sai2', label: 'SAI2', configKey: 'sai2', exts: ['.sai2', '.sai'] })
    h.service.register({ id: 'opener-ps', label: 'PS', configKey: 'ps', exts: ['.psd'] })

    expect(h.service.resolve('a.psd')?.id).toBe('opener-ps')
    expect(h.service.resolve('a.sai2')?.id).toBe('opener-sai2')
    expect(h.service.resolve()?.id).toBe('opener-sai2')
  })

  it('spawn 时把文件作为最后一个参数，并派发 before/after + file_open', async () => {
    const h = harness()
    const exe = process.execPath
    h.config.set('openers.sai2', { path: exe, args: '-a -b' })
    h.service.register({ id: 'opener-sai2', label: 'SAI2', configKey: 'sai2', exts: ['.sai2'] })
    const res = await h.service.launch('C:\\稿子\\线稿.sai2')
    expect(res.ok).toBe(true)
    expect(h.runs[0]?.exe).toBe(exe)
    expect(h.runs[0]?.args).toEqual(['-a', '-b', 'C:\\稿子\\线稿.sai2'])
    expect(h.events.map((e) => e.event)).toEqual(['opener_before_launch', 'file_open', 'opener_after_launch'])
  })

  it('指定 openerId 时只用它；禁用后（注销）报不存在', async () => {
    const h = harness()
    const exe = process.execPath
    h.config.set('openers.ps', { path: exe, args: '' })
    const off = h.service.register({ id: 'opener-ps', label: 'PS', configKey: 'ps', exts: ['.psd'] })
    const ok = await h.service.launch('a.psd', 'opener-ps')
    expect(ok.ok).toBe(true)
    off()
    const fail = await h.service.launch('a.psd', 'opener-ps')
    expect(fail.ok).toBe(false)
    expect(fail.error).toContain('不存在')
  })

  it('自定义 launch 覆盖默认 spawn', async () => {
    const h = harness()
    const exe = process.execPath
    h.config.set('openers.sai2', { path: exe, args: '' })
    let custom = false
    h.service.register({
      id: 'opener-sai2', label: 'SAI2', configKey: 'sai2', exts: ['.sai2'],
      launch: async () => { custom = true; return { ok: true } }
    })
    await h.service.launch('a.sai2')
    expect(custom).toBe(true)
    expect(h.runs).toHaveLength(0)
  })
})
