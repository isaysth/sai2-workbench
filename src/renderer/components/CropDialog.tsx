import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'

/**
 * 背景图取景框。
 *
 * 为什么不是"在整张图上拖一个矩形"：
 *   最后铺到窗口上的效果是 `background-size: cover`，也就是图会被裁成窗口比例。
 *   在整图上拖矩形的话，用户得自己心算"这个矩形是不是 1.58:1、裁完会不会切到脸"。
 *   反过来做 —— **框是窗口形状，动的是图** —— 用户在框里看到什么，落地就是什么，
 *   零换算、零心智负担。窗口缩放后 cover 会重新裁，这一点在设置页的说明里讲清楚了。
 *
 * 交互：拖动平移 / 滚轮缩放（以光标为锚点）/ Esc 取消 / 重置回到居中。
 * 坐标换算全部在 CSS 像素里做，最后除以 scale 换成源图像素。
 *
 * v1.19：裁剪与编码都搬到这里做（canvas → PNG 字节），主进程只负责落盘。
 * 原因是 Electron 的 nativeImage **只认 PNG / JPEG**，WebP 一律解成空图
 * （实测 `createFromPath` 对 webp 返回 isEmpty()=true），用户在取景框里明明
 * 看得到图，一点"用作背景"就报"解码失败"。渲染端是 Chromium，webp/bmp/avif
 * 全都解得开，顺手还能把长边降采样一起做掉。
 */

interface CropDialogProps {
  /** data/backgrounds 里的临时文件名 */
  pending: string
  busy: boolean
  onCancel: () => void
  /** 取景结果：已裁好、已编码的 PNG 字节 */
  onApply: (png: Uint8Array) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 5
/** 输出长边上限：窗口再大也用不到 4K 背景，压一压省内存也省 IO（与主进程一致） */
const MAX_OUTPUT_EDGE = 2560

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp'
}

/** 按扩展名给 Blob 带个 mime，省得浏览器靠嗅探猜（bmp 的嗅探尤其不靠谱） */
function mimeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? ''
}

/**
 * 把框里那块源图区域裁出来编码成 PNG。
 *
 * 用 `<img>` 元素而不是 createImageBitmap：`<img>` 已经按 EXIF 方向渲染过，
 * naturalWidth/naturalHeight 也是方向修正后的值，和取景框里的坐标系天然一致。
 */
async function renderCrop(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): Promise<Uint8Array | null> {
  try {
    await img.decode()
  } catch {
    // 已经解码完成过的图再 decode 会 reject，直接继续
  }
  const ratio = Math.min(1, MAX_OUTPUT_EDGE / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * ratio))
  const h = Math.max(1, Math.round(sh * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** 取景框：跟当前窗口同比例，宽度让到视口 2/3，别把整个界面糊住 */
function frameSize(): { w: number; h: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const aspect = vw / Math.max(1, vh)
  let w = Math.min(780, vw * 0.66)
  let h = w / aspect
  const maxH = vh - 240
  if (h > maxH) {
    h = Math.max(160, maxH)
    w = h * aspect
  }
  return { w: Math.round(w), h: Math.round(h) }
}

export function CropDialog({ pending, busy, onCancel, onApply }: CropDialogProps): ReactElement {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState(frameSize)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [src, setSrc] = useState('')
  /** 图片读不出来时的具体原因（空串 = 正常），比一个 bool 更能说清「太大」和「坏了」的区别 */
  const [failMsg, setFailMsg] = useState('')
  const [encoding, setEncoding] = useState(false)
  const [encodeError, setEncodeError] = useState('')

  const frameRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  /**
   * 图从 IPC 拿字节再转 blob: URL，而不是直接 `<img src="sai2img://...">`。
   * 自定义协议在 Chromium 眼里是跨源，加载出来的 canvas 会被标记为 tainted，
   * 点"用作背景"时 `toBlob` 直接抛 SecurityError —— 那正是之前"解码失败"的真相。
   */
  useEffect(() => {
    let dead = false
    let url = ''
    void (async () => {
      const res = await window.api.readBackground(pending)
      if (dead) return
      if (!res.ok || !res.bytes) {
        setFailMsg(res.error ?? '图片读不出来，换一张试试')
        return
      }
      const bytes = new Uint8Array(res.bytes)
      url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(pending) }))
      setSrc(url)
    })()
    return () => {
      dead = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [pending])

  // 窗口大小变了（用户拖动窗口 / 最大化），框也要跟着变，否则取出来的比例就不对
  useEffect(() => {
    const onResize = (): void => setView(frameSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** cover 基准比例：让图刚好盖满框的最小缩放 */
  const baseScale = useMemo(() => {
    if (!natural || !view.w || !view.h) return 0
    return Math.max(view.w / natural.w, view.h / natural.h)
  }, [natural, view.w, view.h])

  const scale = baseScale * zoom
  const dw = natural ? natural.w * scale : 0
  const dh = natural ? natural.h * scale : 0
  // 越界钳制放在渲染期算，不写回 state：缩放变小时老偏移会自动被拉回合法区间
  const ox = Math.min(0, Math.max(view.w - dw, off.x))
  const oy = Math.min(0, Math.max(view.h - dh, off.y))

  // 图读到了 / 框尺寸变了：回到居中，缩放归 1
  useEffect(() => {
    if (!natural || !view.w || !view.h) return
    const s = Math.max(view.w / natural.w, view.h / natural.h)
    setZoom(1)
    setOff({ x: (view.w - natural.w * s) / 2, y: (view.h - natural.h * s) / 2 })
  }, [natural, view.w, view.h])

  const reset = useCallback(() => {
    if (!natural) return
    const s = Math.max(view.w / natural.w, view.h / natural.h)
    setZoom(1)
    setOff({ x: (view.w - natural.w * s) / 2, y: (view.h - natural.h * s) / 2 })
  }, [natural, view.w, view.h])

  // 滚轮缩放必须用非 passive 的原生监听：React 的 onWheel 是 passive 的，preventDefault 无效
  useEffect(() => {
    const el = frameRef.current
    if (!el || !natural || !baseScale) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const next = clamp(zoom * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
      if (next === zoom) return
      // 以光标下的那个像素为锚点：缩放前后它停在屏幕同一位置
      const ix = (px - ox) / scale
      const iy = (py - oy) / scale
      const s2 = baseScale * next
      setZoom(next)
      setOff({ x: px - ix * s2, y: py - iy * s2 })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [natural, baseScale, zoom, ox, oy, scale])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!natural) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, ox, oy }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    if (!d) return
    setOff({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) })
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const apply = async (): Promise<void> => {
    const el = imgRef.current
    if (!natural || !scale || !el || encoding || busy) return
    // 框内可见区域 → 源图像素。先钳进原图范围：四舍五入可能让矩形尾巴越界 1px，
    // 越界那部分 canvas 会画成透明，落地后就是一条边色差。
    const sx = clamp(Math.round(-ox / scale), 0, Math.max(0, natural.w - 1))
    const sy = clamp(Math.round(-oy / scale), 0, Math.max(0, natural.h - 1))
    const sw = clamp(Math.round(view.w / scale), 1, natural.w - sx)
    const sh = clamp(Math.round(view.h / scale), 1, natural.h - sy)

    setEncoding(true)
    setEncodeError('')
    // 先把"正在生成…"画出来，再干同步的 drawImage（2560 那一下要几十毫秒）
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      const png = await renderCrop(el, sx, sy, sw, sh)
      if (!png) {
        setEncodeError('生成失败，换一张图片试试')
        return
      }
      onApply(png)
    } catch (err) {
      setEncodeError('生成失败：' + String(err))
    } finally {
      setEncoding(false)
    }
  }

  return (
    <div className="crop-scrim" onPointerDown={busy ? undefined : onCancel}>
      <div
        className="crop-panel"
        role="dialog"
        aria-modal="true"
        aria-label="背景取景"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="crop-head">
          <div className="crop-title">取景</div>
          <div className="crop-sub">框里看到的，就是窗口最后铺满的样子 · 拖动构图，滚轮缩放</div>
        </div>

        <div
          className="crop-frame"
          ref={frameRef}
          style={{ width: view.w, height: view.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            className="crop-image"
            ref={imgRef}
            src={src || undefined}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget
              // 只管第一次：后面缩放不会改 naturalWidth，重复 setState 会触发居中重置
              setNatural((prev) => prev ?? { w: el.naturalWidth, h: el.naturalHeight })
            }}
            onError={() => setFailMsg('图片读不出来，换一张试试')}
            style={
              natural
                ? { width: dw, height: dh, left: ox, top: oy }
                : { width: 0, height: 0, left: 0, top: 0 }
            }
          />
          {!natural && !failMsg ? <div className="crop-hint">正在读取图片…</div> : null}
          {failMsg ? <div className="crop-hint">{failMsg}</div> : null}
          <div className="crop-grid" />
          <div className="crop-corner is-tl" />
          <div className="crop-corner is-tr" />
          <div className="crop-corner is-bl" />
          <div className="crop-corner is-br" />
        </div>

        <div className="crop-foot">
          <span className="crop-zoom">缩放 {Math.round(zoom * 100)}%</span>
          {encodeError ? <span className="crop-err">{encodeError}</span> : null}
          <button className="btn is-sm is-ghost" onClick={reset} disabled={!natural || busy}>
            重置
          </button>
          <div className="crop-spacer" />
          <button className="btn is-sm is-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="btn is-sm is-primary"
            onClick={() => void apply()}
            disabled={!natural || busy || encoding}
          >
            {busy || encoding ? '正在生成…' : '用作背景'}
          </button>
        </div>
      </div>
    </div>
  )
}
