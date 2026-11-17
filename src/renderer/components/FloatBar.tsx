import type { ReactElement } from 'react'
import type { FloatModeState, WindowAction } from '@shared/types'
import { CitrusMark } from './Brand'
import { IconClose, IconMaximize, IconMinus } from './Icons'

/**
 * 悬浮模式下的极简界面：SAI2 在前面画画，这个条贴在角落，
 * 需要的时候点「展开」回到工作台，不想看就收进托盘。
 */
export function FloatBar({ state }: { state: FloatModeState }): ReactElement {
  const act = (action: WindowAction): void => {
    void window.api.windowAction(action)
  }

  return (
    <div className="float-bar">
      <div className="float-bar-drag">
        <span className="float-bar-mark">
          <CitrusMark size={20} />
        </span>
        <div className="float-bar-text">
          <b>sai2工作台 · 小窗模式</b>
          <span>SAI2 已启动，稿件索引在后台待命</span>
        </div>
      </div>
      <div className="float-bar-actions">
        <button className="float-btn" title="展开主界面" onClick={() => act('toggle-float')}>
          <IconMaximize />
          <span>展开</span>
        </button>
        <button className="float-btn" title="收进托盘" onClick={() => act('tray')}>
          <IconMinus />
          <span>托盘</span>
        </button>
        <button className="float-btn is-close" title="退出工作台" onClick={() => act('quit')}>
          <IconClose />
        </button>
      </div>
      <div className="float-bar-foot">拖拽这里移动 · {state.width}×{state.height}</div>
    </div>
  )
}
