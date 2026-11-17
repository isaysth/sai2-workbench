import { describe, expect, it } from 'vitest'
import { readPluginId } from '@shared/plugin-window'

describe('readPluginId', () => {
  it('从 loadFile 的 query 中读取 pluginId', () => {
    expect(readPluginId('?pluginId=sai2-fx-studio')).toBe('sai2-fx-studio')
  })

  it('query 缺失时回退到 --plugin-id 启动参数', () => {
    expect(readPluginId('', ['--type=renderer', '--plugin-id=hello-world'])).toBe('hello-world')
  })

  it('query 优先于启动参数', () => {
    expect(readPluginId('?pluginId=from-query', ['--plugin-id=from-argv'])).toBe('from-query')
  })

  it('都没有时返回空串，交给主进程校验拒绝', () => {
    expect(readPluginId('?foo=bar', ['--type=renderer'])).toBe('')
  })

  it('空 query 值不会遮蔽 argv', () => {
    expect(readPluginId('?pluginId=', ['--plugin-id=fallback'])).toBe('fallback')
  })
})
