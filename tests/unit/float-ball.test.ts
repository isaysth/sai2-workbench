import { describe, expect, it } from 'vitest'
import {
  BALL_HTML,
  ORANGE_BALL_SVG,
  buildOrangeSliceSvg,
  clampBallSize,
  defaultBallPosition,
  resolveBallPosition
} from '../../src/main/float-ball'

const AREA = { x: 0, y: 0, width: 1920, height: 1040 }

describe('悬浮球 · 尺寸与位置纯逻辑', () => {
  it('尺寸夹到 48~160，坏值回默认 88', () => {
    expect(clampBallSize(96)).toBe(96)
    expect(clampBallSize(12)).toBe(48)
    expect(clampBallSize(999)).toBe(160)
    expect(clampBallSize('abc')).toBe(88)
    expect(clampBallSize(undefined)).toBe(88)
    expect(clampBallSize(72.6)).toBe(73)
  })

  it('默认落位在右上角，且不会贴边或负坐标', () => {
    expect(defaultBallPosition(AREA, 88)).toEqual({ x: 1920 - 88 - 24, y: 24 })
    // 极小工作区时 x 不能为负
    expect(defaultBallPosition({ x: 0, y: 0, width: 40, height: 40 }, 88).x).toBeGreaterThanOrEqual(8)
  })

  it('恢复上次位置：在多屏之一的可见区内原样保留', () => {
    const displays = [AREA, { x: 1920, y: 0, width: 1280, height: 1024 }]
    expect(resolveBallPosition({ x: 200, y: 300 }, 88, AREA, displays)).toEqual({ x: 200, y: 300 })
    expect(resolveBallPosition({ x: 2000, y: 300 }, 88, AREA, displays)).toEqual({ x: 2000, y: 300 })
  })

  it('恢复上次位置：越界（显示器拔掉）回右上角，坏值也回退', () => {
    expect(resolveBallPosition({ x: 9999, y: 9999 }, 88, AREA, [AREA])).toEqual({ x: 1808, y: 24 })
    expect(resolveBallPosition(null, 88, AREA, [AREA])).toEqual({ x: 1808, y: 24 })
    expect(resolveBallPosition({ x: 'bad', y: 3 }, 88, AREA, [AREA])).toEqual({ x: 1808, y: 24 })
  })

  it('显示器列表为空时退化用主屏，不崩', () => {
    expect(resolveBallPosition({ x: 10, y: 10 }, 88, AREA, [])).toEqual({ x: 10, y: 10 })
  })
})

describe('悬浮球 · 橙子切片皮肤', () => {
  it('生成 8 瓣果肉、白络环、中心白芯，且无外链资源', () => {
    const svg = buildOrangeSliceSvg()
    expect(svg).toBe(ORANGE_BALL_SVG)
    expect((svg.match(/class="petal"/g) ?? []).length).toBe(8)
    expect(svg).toContain('url(#peel)')
    expect(svg).toContain('#fff6e8')
    expect(svg).toContain('r="5.5"')
    expect(svg).not.toMatch(/https?:\/\//)
    expect(svg).not.toContain('<image')
  })

  it('重复调用结果稳定（无随机、无时间戳）', () => {
    expect(buildOrangeSliceSvg()).toBe(buildOrangeSliceSvg())
  })
})

describe('悬浮球 · 页面自包含与交互', () => {
  it('BALL_HTML 无外链、无 drag 区域，单击/双击/右键/拖动四类事件齐全', () => {
    expect(BALL_HTML).not.toMatch(/https?:\/\//)
    expect(BALL_HTML).not.toContain('-webkit-app-region')
    expect(BALL_HTML).not.toContain('<img src=')
    for (const token of ['230', 'dblclick', 'contextmenu', 'pointerdown', 'pointermove', "api.action('expand')", "api.action('reset')", "api.action('menu')", 'api.drag(']) {
      expect(BALL_HTML).toContain(token)
    }
  })

  it('内联皮肤默认就是橙子切片（无需等待 IPC）', () => {
    expect(BALL_HTML).toContain(ORANGE_BALL_SVG)
  })
})
