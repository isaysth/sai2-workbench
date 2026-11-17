import type { ReactElement } from 'react'
import { CitrusMark } from './Brand'
import { IconClose, IconMaximize, IconMinus } from './Icons'

/**
 * 自定义标题栏。
 * 拖拽区用 -webkit-app-region: drag（见 base.css .titlebar），
 * 按钮区必须 no-drag，否则点不到。
 */
export function TitleBar({ hint }: { hint?: string }): ReactElement {
  const act = (action: 'minimize' | 'toggle-maximize' | 'close'): void => {
    void window.api.windowAction(action)
  }

  return (
    <header className="titlebar glass-edge">
      <div className="titlebar-drag">
        <span className="titlebar-mark">
          <CitrusMark size={20} />
        </span>
        <span className="titlebar-title">sai2工作台</span>
        <span className="titlebar-badge">M1 预览</span>
        {hint ? <span className="titlebar-path">{hint}</span> : null}
      </div>
      <div className="titlebar-actions">
        <button className="win-btn" title="最小化" onClick={() => act('minimize')}>
          <IconMinus />
        </button>
        <button className="win-btn" title="最大化 / 还原" onClick={() => act('toggle-maximize')}>
          <IconMaximize />
        </button>
        <button className="win-btn is-close" title="关闭" onClick={() => act('close')}>
          <IconClose />
        </button>
      </div>
    </header>
  )
}
