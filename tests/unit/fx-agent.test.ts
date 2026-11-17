import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const agent = require('../../contrib/sai2-fx-studio/core/agent.js')

/** 造一个假命名管道 socket：connect 后回一行 JSON */
function fakeSocket(response, { failConnect = false } = {}) {
  const s = new EventEmitter()
  s.setEncoding = () => undefined
  s.write = (data, cb) => {
    expect(String(data).endsWith('\n')).toBe(true)
    if (cb) cb(null)
    setTimeout(() => {
      s.emit('data', response + '\n')
      s.emit('close')
    }, 0)
  }
  s.destroy = () => undefined
  if (failConnect) {
    setTimeout(() => {
      const err = new Error('pipe busy')
      err.code = 'EBUSY'
      s.emit('error', err)
    }, 0)
  } else {
    setTimeout(() => s.emit('connect'), 0)
  }
  return s
}

describe('agent 命名管道客户端', () => {
  it('ping 解析 ok 与 pid', async () => {
    const s = fakeSocket('{"ok":true,"agent":"sai2_agent/1.0","pid":1234}')
    const r = await agent.ping({ connect: () => s, budgetMs: 100 })
    expect(r).toEqual({ ok: true, pid: 1234 })
  })

  it('query 发出的命令带命令行换行', async () => {
    let sent = ''
    const s = fakeSocket('{"ok":true}')
    const origWrite = s.write
    s.write = (data, cb) => { sent = String(data); origWrite(data, cb) }
    await agent.query('{"cmd":"layers"}', { connect: () => s, budgetMs: 100 })
    expect(sent).toBe('{"cmd":"layers"}\n')
  })

  it('可对 ENOENT/EBUSY 做限时重试', async () => {
    let attempts = 0
    const sleep = vi.fn(async () => undefined)
    const r = await agent.query('{"cmd":"ping"}', {
      connect: () => {
        attempts += 1
        return attempts < 3 ? fakeSocket('', { failConnect: true }) : fakeSocket('{"ok":true}')
      },
      budgetMs: 500,
      sleep
    })
    expect(r).toContain('"ok":true')
    expect(attempts).toBe(3)
    expect(sleep).toHaveBeenCalled()
  })

  it('不可重试错误直接抛出', async () => {
    const s = new EventEmitter()
    s.setEncoding = () => undefined
    s.write = () => {
      const err = new Error('denied')
      err.code = 'EACCES'
      s.emit('error', err)
    }
    s.destroy = () => undefined
    setTimeout(() => s.emit('connect'), 0)
    await expect(agent.query('{"cmd":"ping"}', { connect: () => s, budgetMs: 500 })).rejects.toThrow('denied')
  })

  it('parseLayerRows 解析图层行并按 tick 过滤跨文档残留', () => {
    const raw = JSON.stringify({
      ok: true,
      groups: [{
        rows: [
          { y: 10, screenX: 100, screenY: 200, tick: 10000, text: '图层1' },
          { y: 20, screenX: 100, screenY: 255, tick: 9999, text: '图层2' },
          { y: 30, screenX: 100, screenY: 310, tick: 1000, text: '旧文档残留' }
        ]
      }]
    })
    const rows = agent.parseLayerRows(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0].text).toBe('图层1')
    expect(rows[1].screenY).toBe(255)
  })

  it('takeCategoryRequest 无请求返回 null，有请求返回索引', async () => {
    const none = await agent.takeCategoryRequest({ connect: () => fakeSocket('{"request":null}'), budgetMs: 100 })
    expect(none).toBeNull()
    const one = await agent.takeCategoryRequest({ connect: () => fakeSocket('{"request":{"index":3}}'), budgetMs: 100 })
    expect(one).toBe(3)
  })

  it('pushCategories 生成正确 JSON 并读取 ok', async () => {
    let sent = ''
    const s = fakeSocket('{"ok":true}')
    const origWrite = s.write
    s.write = (data, cb) => { sent = String(data); origWrite(data, cb) }
    const ok = await agent.pushCategories([{ id: 1, name: '模糊' }], { connect: () => s, budgetMs: 100 })
    expect(ok).toBe(true)
    expect(sent).toContain('"cmd":"set.plugins"')
    expect(sent).toContain('"i":1')
  })
})
