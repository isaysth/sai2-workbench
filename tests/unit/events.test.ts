import { describe, expect, it } from 'vitest'
import type { Logger } from '../../src/main/logger'
import { PluginEvents } from '../../src/main/plugins/events'

function fakeLog(): Logger & { errors: string[] } {
  const errors: string[] = []
  return {
    errors,
    error: (_scope: string, message: string) => void errors.push(message),
    info: () => undefined,
    warn: () => undefined,
    debug: () => undefined
  } as unknown as Logger & { errors: string[] }
}

describe('PluginEvents', () => {
  it('按事件名派发 payload，未知事件不构成合法订阅', () => {
    const log = fakeLog()
    const events = new PluginEvents(log)
    expect(events.isKnown('app_ready')).toBe(true)
    expect(events.isKnown('app_ready_typo')).toBe(false)

    const seen: unknown[] = []
    events.on('a', 'app_ready', (p) => void seen.push(p))
    events.emit('app_ready', { ok: true })
    expect(seen).toEqual([{ ok: true }])
  })

  it('监听器抛错不影响同事件的其它监听器', () => {
    const log = fakeLog()
    const events = new PluginEvents(log)
    const seen: string[] = []
    events.on('bad', 'file_added', () => {
      throw new Error('故意炸')
    })
    events.on('good', 'file_added', () => void seen.push('ok'))
    events.emit('file_added')
    expect(seen).toEqual(['ok'])
    expect(log.errors.some((e) => e.includes('故意炸'))).toBe(true)
  })

  it('clearScope 只清掉该插件的订阅', () => {
    const log = fakeLog()
    const events = new PluginEvents(log)
    const seen: string[] = []
    events.on('a', 'theme_changed', () => void seen.push('a'))
    events.on('b', 'theme_changed', () => void seen.push('b'))
    events.clearScope('a')
    events.emit('theme_changed')
    expect(seen).toEqual(['b'])
  })
})
