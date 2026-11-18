import type { ReactElement } from 'react'
import { CitrusMark } from './Brand'
import { IconClose, IconMaximize, IconMinus, IconRefresh } from './Icons'
import { useUi } from '../store/ui'

/**
 * 自定义标题栏。
 * 拖拽区用 -webkit-app-region: drag（见 base.css .titlebar），
 * 按钮区必须 no-drag，否则点不到。
 */
export function TitleBar({ hint }: { hint?: string }): ReactElement {
  const showToast = useUi((s) => s.showToast)

  const act = (action: 'minimize' | 'toggle-maximize' | 'close'): void => {
    void window.api.windowAction(action)
  }

  /** 重启要用户确认一次：没保存的配置 / 正在跑的任务都会丢（原在插件中心，D-019 搬来） */
  const restart = async (): Promise<void> => {
    if (!window.confirm('重启工作台？未保存的改动会丢失。')) return
    const res = await window.api.app.restart()
    showToast(res.ok ? '正在重启工作台…' : (res.error ?? '重启失败'))
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
        <button
          className="win-btn is-restart"
          title="重启工作台"
          aria-label="重启工作台"
          onClick={() => void restart()}
        >
          <IconRefresh />
        </button>
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
