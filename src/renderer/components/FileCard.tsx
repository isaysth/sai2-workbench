import { useState, type ReactElement } from 'react'
import type { ProjectFile } from '@shared/types'

/**
 * 单张卡片。
 *
 * 三种长相：
 *   1. 正常：缩略图 + 文件名条
 *   2. 加载中：同尺寸的占位块（**尺寸必须和最终一致**，否则瀑布流会抖）
 *   3. 出不了图：信息卡（后缀大字 + 画布尺寸 + 修改时间）
 *
 * 高度是父组件给的（`h`），卡片自己不改变尺寸 —— 图加载完只把真实比例回报给父级，
 * 由父级重排。这样滚动中不会出现"卡片一加载就把下面的内容挤下去"的跳动。
 */

export interface FileCardProps {
  file: ProjectFile
  x: number
  y: number
  w: number
  h: number
  selected: boolean
  onSelect: (path: string) => void
  onOpen?: (path: string) => void
  onContextMenu?: (path: string, x: number, y: number) => void
  onMeasure: (path: string, ratio: number) => void
}

const EXT_LABEL: Record<string, string> = {
  '.sai2': 'SAI2',
  '.sai': 'SAI',
  '.psd': 'PSD',
  '.psb': 'PSB',
  '.clip': 'CLIP',
  '.kra': 'KRA',
  '.png': 'PNG',
  '.jpg': 'JPG',
  '.jpeg': 'JPG',
  '.webp': 'WEBP'
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function FileCard(props: FileCardProps): ReactElement {
  const { file, x, y, w, h, selected, onSelect, onOpen, onContextMenu, onMeasure } = props
  const [state, setState] = useState<'loading' | 'ready' | 'fail'>('loading')
  const extLabel = EXT_LABEL[file.ext] ?? file.ext.replace('.', '').toUpperCase()
  const cover = file.thumb?.cover === true
  const tags = file.tags ?? []

  // 请求一律用 .jpg：真实缓存文件可能是 png，协议层按 key 反查、忽略这个后缀
  const src = file.thumbKey ? `sai2img://thumb/${file.thumbKey}.jpg` : ''

  return (
    <article
      className={`file-card${selected ? ' is-selected' : ''}`}
      style={{ width: w, height: h, transform: `translate3d(${x}px, ${y}px, 0)` }}
      onClick={() => onSelect(file.path)}
      onDoubleClick={onOpen ? () => onOpen(file.path) : undefined}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault()
              onSelect(file.path)
              onContextMenu(file.path, e.clientX, e.clientY)
            }
          : undefined
      }
      title={`${file.path}\n双击打开 · 右键更多`}
    >
      <div className="file-card-media" style={{ height: h - 34 }}>
        {state === 'fail' || !src ? (
          <div className="file-card-info">
            <span className="file-card-ext">{extLabel}</span>
            {file.canvas ? (
              <span className="file-card-meta">
                {file.canvas.width} × {file.canvas.height}
              </span>
            ) : null}
            <span className="file-card-meta">{formatSize(file.size)}</span>
            <span className="file-card-meta">{formatDate(file.mtimeMs)}</span>
          </div>
        ) : (
          <>
            {state === 'loading' ? <div className="file-card-skeleton" /> : null}
            <img
              className={`file-card-img${state === 'ready' ? ' is-ready' : ''}`}
              src={src}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              onLoad={(e) => {
                const el = e.currentTarget
                if (el.naturalWidth > 0) onMeasure(file.path, el.naturalHeight / el.naturalWidth)
                setState('ready')
              }}
              onError={() => setState('fail')}
            />
          </>
        )}
        <span className="file-card-badge">{extLabel}</span>
        {cover ? <span className="file-card-cover">封面</span> : null}
        {tags.length > 0 && state !== 'fail' ? (
          <span className="file-card-tags">
            {tags.slice(0, 2).map((t) => (
              <span className="file-card-tag" key={t.id} title={t.name}>
                {t.name}
              </span>
            ))}
            {tags.length > 2 ? <span className="file-card-tag is-more">+{tags.length - 2}</span> : null}
          </span>
        ) : null}
      </div>

      <div className="file-card-foot">
        <span className="file-card-name">{file.name}</span>
      </div>
    </article>
  )
}
