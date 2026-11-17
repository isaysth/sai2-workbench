import { describe, expect, it } from 'vitest'
import type { Logger } from '../../src/main/logger'
import { ThemeService } from '../../src/main/theme/service'

function harness() {
  let changes = 0
  const warnings: string[] = []
  const log = {
    info: () => undefined,
    debug: () => undefined,
    warn: (_scope: string, msg: string) => { warnings.push(msg) },
    error: () => undefined
  } as unknown as Logger
  const service = new ThemeService({ log, onChange: () => { changes += 1 } })
  return { service, get changes() { return changes }, warnings }
}

describe('ThemeService', () => {
  it('只接受白名单变量，忽略未知与锁定变量', () => {
    const h = harness()
    const off = h.service.registerVars('theme-a', {
      '--accent': '#f60',
      '--glass-alpha': '0',       // 锁定：M1 透明参数
      '--evil': 'red',
      '--radius': '12px'
    })
    const vars = h.service.getVars()
    expect(vars['--accent']).toBe('#f60')
    expect(vars['--radius']).toBe('12px')
    expect(vars['--glass-alpha']).toBeUndefined()
    expect(vars['--evil']).toBeUndefined()
    expect(h.warnings.some((w) => w.includes('--evil'))).toBe(true)
    off()
  })

  it('拒绝含 CSS 注入的值', () => {
    const h = harness()
    const off = h.service.registerVars('theme-b', {
      '--accent': 'red; body{display:none}',
      '--radius': '8px'
    })
    const vars = h.service.getVars()
    expect(vars['--accent']).toBeUndefined()
    expect(h.warnings.some((w) => w.includes('不安全'))).toBe(true)
    off()
  })

  it('后注册者覆盖先注册者，注销后恢复', () => {
    const h = harness()
    const offA = h.service.registerVars('a', { '--accent': 'red' })
    const offB = h.service.registerVars('b', { '--accent': 'blue' })
    expect(h.service.getVars()['--accent']).toBe('blue')
    offB()
    expect(h.service.getVars()['--accent']).toBe('red')
    offA()
    expect(h.service.getVars()['--accent']).toBeUndefined()
  })

  it('重复注册同名插件覆盖旧值，且每次变化都通知', () => {
    const h = harness()
    h.service.registerVars('a', { '--accent': 'red' })
    h.service.registerVars('a', { '--accent': 'green' })
    expect(h.service.getVars()['--accent']).toBe('green')
    expect(h.changes).toBeGreaterThanOrEqual(2)
  })
})
