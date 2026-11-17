import { useMemo } from 'react'
import type { ProjectFile } from '@shared/types'

/**
 * 瀑布流布局计算。
 *
 * 不用 CSS `columns` 的原因：它是"按列填充"的，滚动时无法只渲染可视区
 * （1000 条全在 DOM 里），而且列的分配顺序是竖着的 —— 最新的图会跑到左列最下面，
 * 用户直觉是"最新的在最上面一排"。
 *
 * 这里改成自己算坐标：按列累积最短列（经典瀑布流），卡片用 transform 绝对定位。
 * 好处是渲染层可以只挂可视区附近的卡片，1000 条也只有 20~40 个 DOM 节点。
 */

export interface Tile {
  file: ProjectFile
  x: number
  y: number
  w: number
  h: number
}

export interface MasonryLayout {
  tiles: Tile[]
  height: number
  columns: number
}

export interface MasonryParams {
  items: ProjectFile[]
  /** path → 高/宽 比。图还没加载时用 DEFAULT_RATIO 占位 */
  ratios: Map<string, number>
  width: number
  columnWidth: number
  gap: number
  footerHeight: number
}

/** 3:4 竖版。画师稿件绝大多数是竖的，比正方形占位更接近真实高度，回填时跳动更小 */
export const DEFAULT_RATIO = 4 / 3

export function computeMasonry(p: MasonryParams): MasonryLayout {
  const colW = Math.max(96, Math.round(p.columnWidth))
  const gap = p.gap
  const columns = Math.max(1, Math.floor((p.width + gap) / (colW + gap)))
  const used = columns * colW + (columns - 1) * gap
  // 列宽固定、剩余宽度均分到两侧，视觉上居中而不是贴左
  const padLeft = Math.max(0, Math.round((p.width - used) / 2))

  const heights = new Array<number>(columns).fill(0)
  const tiles: Tile[] = []

  for (const file of p.items) {
    let col = 0
    for (let i = 1; i < columns; i++) {
      if (heights[i]! < heights[col]!) col = i
    }
    // 量到真实比例就用真实比例；没缩略图的文件（信息卡）用画布比例，
    // 这样 256×256 的小画布不会占一个 3:4 的大白块
    const ratio =
      p.ratios.get(file.path) ??
      (file.canvas ? file.canvas.height / file.canvas.width : DEFAULT_RATIO)
    const thumbH = Math.round(colW * Math.min(4, Math.max(0.3, ratio)))
    const h = thumbH + p.footerHeight
    tiles.push({ file, x: padLeft + col * (colW + gap), y: heights[col]!, w: colW, h })
    heights[col] = heights[col]! + h + gap
  }

  return { tiles, height: Math.max(0, Math.max(...heights, 0) - gap), columns }
}

/** 布局本身只在尺寸/数据变化时重算；滚动只做过滤，避免每帧都重新排 1000 条 */
export function useMasonryLayout(p: MasonryParams): MasonryLayout {
  return useMemo(
    () => computeMasonry(p),
    // ratios 是 Map，调用方每次变更都会换新引用
    [p.items, p.ratios, p.width, p.columnWidth, p.gap, p.footerHeight]
  )
}

export function visibleTiles(
  layout: MasonryLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number
): Tile[] {
  const from = scrollTop - overscan
  const to = scrollTop + viewportHeight + overscan
  // tiles 是按 y 递增插入的，但不是全局有序（列之间交错），直接过滤最简单
  return layout.tiles.filter((t) => t.y + t.h >= from && t.y <= to)
}
