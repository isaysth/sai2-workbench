import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ActionView } from '@shared/plugins'

/**
 * 通用右键菜单。
 *
 * 插件动作来自主进程贡献点：label 可以跨进程传，run 是函数只能留在主进程，
 * 所以点击时把 action.id 回传，由主进程查表执行。
 */
export interface MenuItem {
  id: string
  label: string
  /** 危险操作（删除等）用红色字 */
  danger?: boolean
}

export interface ContextMenuProps {
  /** 非 null 时显示，坐标是相对视口的 clientX/clientY */
  at: { x: number; y: number; path: string } | null
  onClose: () => void
  onOpen: (path: string) => void
  onReveal: (path: string) => void
  onCopyPath: (path: string) => void
  /** 当前文件扩展名（含点，小写），用于过滤插件动作 */
  ext: string
  pluginActions: ActionView[]
  onPluginAction: (id: string, path: string) => void
}

export function ContextMenu(props: ContextMenuProps): ReactElement | null {
  const { at, onClose, onOpen, onReveal, onCopyPath, ext, pluginActions, onPluginAction } = props
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // 贴边翻转：菜单不能画出屏幕外
  useEffect(() => {
    if (!at || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = Math.min(at.x, window.innerWidth - rect.width - 8)
    const y = Math.min(at.y, window.innerHeight - rect.height - 8)
    setPos({ x: Math.max(4, x), y: Math.max(4, y) })
  }, [at])

  useEffect(() => {
    if (!at) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [at, onClose])

  if (!at) return null

  const matching = pluginActions.filter(
    (a) => !a.exts || a.exts.some((e) => e.toLowerCase() === ext.toLowerCase())
  )

  const run = (fn: (path: string) => void): void => {
    const path = at.path
    onClose()
    fn(path)
  }

  return (
    <div
      ref={ref}
      className="context-menu glass-edge"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button className="context-item" onClick={() => run(onOpen)}>
        用默认程序打开
      </button>
      <button className="context-item" onClick={() => run(onReveal)}>
        在文件夹中显示
      </button>
      <button className="context-item" onClick={() => run(onCopyPath)}>
        复制文件路径
      </button>
      {matching.length > 0 ? <div className="context-sep" /> : null}
      {matching.map((a) => (
        <button
          key={`${a.pluginId}:${a.id}`}
          className="context-item"
          title={`来自插件 ${a.pluginId}`}
          onClick={() => run((path) => onPluginAction(a.id, path))}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
