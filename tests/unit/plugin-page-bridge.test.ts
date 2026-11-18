import { describe, expect, it } from 'vitest'
import { buildResultMessage, parsePageMessage, PAGE_BRIDGE_KEY } from '@shared/plugin-page-bridge'

describe('parsePageMessage', () => {
  it('合法 action 消息解析出 id', () => {
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'action', id: 'fx-launch-pair' })).toEqual({
      __sai2Page: 'action',
      id: 'fx-launch-pair'
    })
  })

  it('__sai2Page 不是 action 的一律忽略', () => {
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'result', id: 'fx-launch-pair' })).toBeNull()
    expect(parsePageMessage({ id: 'fx-launch-pair' })).toBeNull()
  })

  it('id 为空 / 非字符串 / 含怪字符时拒绝', () => {
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'action', id: '' })).toBeNull()
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'action', id: 123 })).toBeNull()
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'action', id: '<script>' })).toBeNull()
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'action', id: 'fx launch' })).toBeNull()
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'action', id: '启动一对' })).toBeNull()
    // 非对象、null、字符串消息也不该抛错
    expect(parsePageMessage(null)).toBeNull()
    expect(parsePageMessage('action')).toBeNull()
  })

  it('id 超过 200 字符时拒绝，buildResultMessage 产出约定结构', () => {
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'action', id: 'a'.repeat(201) })).toBeNull()
    expect(parsePageMessage({ [PAGE_BRIDGE_KEY]: 'action', id: 'a'.repeat(200) })).not.toBeNull()

    expect(buildResultMessage('fx-launch-pair', true)).toEqual({
      __sai2Page: 'result',
      id: 'fx-launch-pair',
      ok: true
    })
    expect(buildResultMessage('fx-launch-pair', false, '启动失败')).toEqual({
      __sai2Page: 'result',
      id: 'fx-launch-pair',
      ok: false,
      error: '启动失败'
    })
  })
})
