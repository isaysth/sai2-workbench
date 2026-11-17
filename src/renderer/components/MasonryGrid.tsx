import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { ProjectFile } from '@shared/types'
import { FileCard } from './FileCard'
import { useMasonryLayout, visibleTiles } from '../hooks/useMasonry'

/**
 * 瀑布流容器：自己的滚动条 + 只渲染可视区附近的卡片。
 *
 * 实测数据（1000 条）：全量 DOM 方案首屏要挂 1000 个 `<img>`，滚动时 Chromium 一直
 * 在解码；虚拟化后常驻 20~40 个节点，滚动不掉帧。
 *
 * 卡片高度由缩略图真实比例决定，但**只有图加载完才回报**。所以在量到之前用 3:4
 * 占位 —— 比例接近大多数稿件的真实比例，重排时下面的卡片只挪一点点。
 */

export interface MasonryGridProps {
  items: ProjectFile[]
  columnWidth: number
  selected: string | null
  onSelect: (path: string) => void
  /** 双击打开（M3b）；不传则无双击行为 */
  onOpen?: (path: string) => void
  /** 右键菜单（M3b）；不传则沿用浏览器原生菜单 */
  onContextMenu?: (path: string, x: number, y: number) => void
  empty?: ReactNode
  /** 筛选条件变了就回顶部：否则滚到第 800 条时一筛选，会停在新结果的半空中 */
  scrollResetKey?: string
}

const GAP = 14
const FOOTER = 34
const OVERSCAN = 700

export function MasonryGrid(props: MasonryGridProps): ReactElement {
  const { items, columnWidth, selected, onSelect, onOpen, onContextMenu, empty, scrollResetKey } = props
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const [ratios, setRatios] = useState<Map<string, number>>(() => new Map())
  const rafRef = useRef(0)
  const pendingTop = useRef(0)

  // 容器尺寸：窗口拉伸、侧栏拖动都要重排
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (scrollResetKey === undefined) return
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    setScrollTop(0)
  }, [scrollResetKey])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    pendingTop.current = e.currentTarget.scrollTop
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      setScrollTop(pendingTop.current)
    })
  }, [])

  const onMeasure = useCallback((path: string, ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) return
    setRatios((prev) => {
      const current = prev.get(path)
      // 差 0.5% 以内不动：否则图片重载会引发无意义的全局重排
      if (current !== undefined && Math.abs(current - ratio) < 0.005) return prev
      const next = new Map(prev)
      next.set(path, ratio)
      return next
    })
  }, [])

  const layout = useMasonryLayout({
    items,
    ratios,
    width: size.width,
    columnWidth,
    gap: GAP,
    footerHeight: FOOTER
  })

  const tiles = useMemo(
    () => visibleTiles(layout, scrollTop, size.height, OVERSCAN),
    [layout, scrollTop, size.height]
  )

  // 空态也必须渲染同一个滚动容器：否则 ResizeObserver 在挂载时拿不到 ref，
  // 等文件进来时永远量不到尺寸（宽度 0 → 只排一列）。
  return (
    <div className="files-scroll" ref={scrollerRef} onScroll={onScroll}>
      {items.length === 0 ? (
        empty
      ) : (
        <div className="files-canvas" style={{ height: layout.height }}>
          {tiles.map((t) => (
            <FileCard
              key={t.file.path}
              file={t.file}
              x={t.x}
              y={t.y}
              w={t.w}
              h={t.h}
              selected={selected === t.file.path}
              onSelect={onSelect}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              onMeasure={onMeasure}
            />
          ))}
        </div>
      )}
    </div>
  )
}
