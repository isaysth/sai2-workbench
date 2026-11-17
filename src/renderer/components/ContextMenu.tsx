import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ActionView } from '@shared/plugins'

/**
 * 通用右键菜单。
 *
 * 两种用法：
 *   1. 文件卡片：传 path + onOpen/onReveal/onCopyPath + 插件文件动作；
 *   2. 通用项（如插件中心列表）：只传 items，每个项一个 label + onClick。
 *
 * 菜单背景用固定的不透明底色，而不是 var(--sheet)：透明玻璃主题下 sheet 的 alpha
 * 可能接近 0，菜单会"弹出来了却看不见"，看起来像右键没反应。
 */

export interface MenuItem {
  id: string
  label: string
  /** 危险操作（删除等）用红色字 */
  danger?: boolean
  /** 置灰不可点 */
  disabled?: boolean
  onClick: () => void
}

/** 文件模式回调 */
export interface FileMenuHandlers {
  onOpen: (path: string) => void
  onReveal: (path: string) => void
  onCopyPath: (path: string) => void
  /** 当前文件扩展名（含点，小写），用于过滤插件动作 */
  ext: string
  pluginActions: ActionView[]
  onPluginAction: (id: string, path: string) => void
}

export interface ContextMenuProps {
  /** 非 null 时显示，坐标是相对视口的 clientX/clientY */
  at: { x: number; y: number; path?: string } | null
  onClose: () => void
  /** 通用菜单项（插件中心等）。给了它就走通用模式，忽略文件相关 props */
  items?: MenuItem[]
  /** 文件模式：给了这些回调就显示文件菜单 */
  file?: FileMenuHandlers
}

export function ContextMenu(props: ContextMenuProps): ReactElement | null {
  const { at, onClose, items, file } = props
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
    // 捕获阶段关闭：避免右键打开菜单时，同一次 mousedown 立刻把它关掉
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [at, onClose])

  if (!at) return null

  const run = (fn: () => void): void => {
    onClose()
    fn()
  }

  // ---- 通用菜单项模式 ----
  if (items) {
    return (
      <div
        ref={ref}
        className="context-menu"
        style={{ left: pos.x, top: pos.y }}
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item) =>
          item.id === 'sep' ? (
            <div className="context-sep" />
          ) : (
            <button
              key={item.id}
              className={`context-item${item.danger ? ' is-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => run(item.onClick)}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    )
  }

  // ---- 文件菜单模式 ----
  if (!file || !at.path) return null
  const path = at.path
  const { ext, pluginActions, onOpen, onReveal, onCopyPath, onPluginAction } = file
  const matching = pluginActions.filter(
    (a) => !a.exts || a.exts.some((e) => e.toLowerCase() === ext.toLowerCase())
  )

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button className="context-item" onClick={() => run(() => onOpen(path))}>
        用默认程序打开
      </button>
      <button className="context-item" onClick={() => run(() => onReveal(path))}>
        在文件夹中显示
      </button>
      <button className="context-item" onClick={() => run(() => onCopyPath(path))}>
        复制文件路径
      </button>
      {matching.length > 0 ? <div className="context-sep" /> : null}
      {matching.map((a) => (
        <button
          key={`${a.pluginId}:${a.id}`}
          className="context-item"
          title={`来自插件 ${a.pluginId}`}
          onClick={() => run(() => onPluginAction(a.id, path))}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
