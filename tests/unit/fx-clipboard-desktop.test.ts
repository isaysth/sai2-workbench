import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { ImageBuffer } = require('../../contrib/sai2-fx-studio/core/image.js')
const clip = require('../../contrib/sai2-fx-studio/core/clipboard.js')
const win = require('../../contrib/sai2-fx-studio/core/clipboard-win.js')
const desktop = require('../../contrib/sai2-fx-studio/core/desktop.js')

describe('CF_DIBV5 编解码', () => {
  it('头部布局：124 头 + 12 掩码，起点 136', () => {
    const img = ImageBuffer.create(2, 2)
    const buf = clip.encodeDIBV5(img)
    expect(buf.readUInt32LE(0)).toBe(124)
    expect(buf.readUInt32LE(16)).toBe(3) // BI_BITFIELDS
    expect(buf.readUInt32LE(52)).toBe(0xFF000000) // alphaMask
    expect(buf.length).toBe(136 + 2 * 2 * 4)
    expect(clip.PIXEL_OFFSET).toBe(136)
  })

  it('encode → decode 往返保持像素（含 alpha）', () => {
    const img = ImageBuffer.create(3, 2)
    img.setPixel(0, 0, 255, 128, 0, 200)
    img.setPixel(2, 1, 10, 20, 30, 40)
    const buf = clip.encodeDIBV5(img)
    const back = clip.decodeDIBV5(buf)
    expect(back).not.toBeNull()
    expect(back.width).toBe(3)
    expect(back.height).toBe(2)
    expect(back.pixel(0, 0)).toEqual([255, 128, 0, 200])
    expect(back.pixel(2, 1)).toEqual([10, 20, 30, 40])
  })

  it('非法头部返回 null', () => {
    expect(clip.decodeDIBV5(Buffer.alloc(8))).toBeNull()
    const bad = Buffer.alloc(136)
    bad.writeUInt32LE(40, 0)
    expect(clip.decodeDIBV5(bad)).toBeNull()
  })
})

describe('clipboard-win（mock PowerShell）', () => {
  it('writeDIBV5 传入 base64 并确认 OK', async () => {
    let gotInput = ''
    const ok = await win.writeDIBV5(Buffer.from([1, 2, 3]), {
      exec: (_script, input, resolve) => { gotInput = input; resolve('OK\n') }
    })
    expect(ok).toBe(true)
    expect(gotInput).toBe(Buffer.from([1, 2, 3]).toString('base64'))
  })

  it('无 OK 确认时抛错', async () => {
    await expect(win.writeDIBV5(Buffer.from([1]), {
      exec: (_s, _i, resolve) => resolve('weird')
    })).rejects.toThrow()
  })

  it('readDIBV5 解 base64；空返回 null', async () => {
    const b64 = Buffer.from([9, 8, 7]).toString('base64')
    const bytes = await win.readDIBV5({ exec: (_s, _i, resolve) => resolve(b64 + '\n') })
    expect([...bytes]).toEqual([9, 8, 7])
    const none = await win.readDIBV5({ exec: (_s, _i, resolve) => resolve('\n') })
    expect(none).toBeNull()
  })

  it('写脚本必须 EmptyClipboard 且只设 CF_DIBV5(17)', () => {
    expect(win.WRITE_PS).toContain('EmptyClipboard')
    expect(win.WRITE_PS).toContain('CF_DIBV5 = 17')
    expect(win.WRITE_PS).not.toContain('CF_DIB =') // 不能写 CF_DIB
  })
})

describe('desktop 自动化（mock PowerShell）', () => {
  it('ctrl 映射 A/C/V 的 scancode', async () => {
    const calls = []
    const exec = (_script, args, resolve) => { calls.push(args[0]); resolve('OK') }
    expect(await desktop.ctrl('a', { exec })).toBe(true)
    expect(await desktop.ctrl('c', { exec })).toBe(true)
    expect(await desktop.ctrl('v', { exec })).toBe(true)
    expect(calls).toEqual(['1E', '2E', '2F'])
  })

  it('聚焦失败时 grabLayer 抛错', async () => {
    await expect(desktop.grabLayer({
      exec: (script, _args, resolve) => resolve(script === desktop.FOCUS_PS ? 'FAILED' : 'OK')
    })).rejects.toThrow('前台')
  })

  it('聚焦成功时 grabLayer 依次发 A、C', async () => {
    const keys = []
    await desktop.grabLayer({
      exec: (script, args, resolve) => {
        if (script === desktop.FOCUS_PS) resolve('OK')
        else { keys.push(args[0]); resolve('OK') }
      }
    })
    expect(keys).toEqual(['1E', '2E'])
  })
})
