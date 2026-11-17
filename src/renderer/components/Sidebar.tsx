import type { ReactElement } from 'react'
import type { PluginPageContribution } from '@shared/plugins'
import type { PageKey } from '../store/ui'
import { IconGrid, IconLaunch, IconPlug, IconSettings, IconTerminal } from './Icons'

interface NavItem {
  key: PageKey
  label: string
  icon: (p: { size?: number; className?: string }) => ReactElement
}

const NAV: NavItem[] = [
  { key: 'launch', label: '启动', icon: IconLaunch },
  { key: 'files', label: '文件管理', icon: IconGrid },
  { key: 'logs', label: '运行日志', icon: IconTerminal },
  { key: 'plugins', label: '插件中心', icon: IconPlug },
  { key: 'settings', label: '设置', icon: IconSettings }
]

interface SidebarProps {
  page: PageKey
  onPage: (page: PageKey) => void
  /** 主按钮文案跟随当前默认打开器（需求 F1） */
  launchLabel: string
  onLaunch: () => void
  /** 打开器是否已配置路径 */
  ready: boolean
  /** 联动插件状态提示 */
  companionHint: string
  /** 插件注册的动态页面 */
  extraPages: PluginPageContribution[]
}

export function Sidebar({
  page,
  onPage,
  launchLabel,
  onLaunch,
  ready,
  companionHint,
  extraPages
}: SidebarProps): ReactElement {
  return (
    <nav className="sidebar glass-edge">
      <div className="nav-group-label">工作台</div>
      {NAV.map((item) => {
        const Icon = item.icon
        const active = page === item.key
        return (
          <button
            key={item.key}
            className={`nav-item${active ? ' is-active' : ''}`}
            onClick={() => onPage(item.key)}
          >
            <Icon className="nav-icon" />
            <span>{item.label}</span>
          </button>
        )
      })}

      {extraPages.length > 0 ? <div className="nav-group-label">插件</div> : null}
      {extraPages.map((item) => {
        const key: PageKey = `plugin:${item.pluginId}:${item.id}`
        return (
          <button
            key={key}
            className={`nav-item${page === key ? ' is-active' : ''}`}
            onClick={() => onPage(key)}
            title={`来自插件 ${item.pluginId}`}
          >
            <IconPlug className="nav-icon" />
            <span>{item.title}</span>
          </button>
        )
      })}

      <div className="sidebar-footer">
        <button className="launch-btn" onClick={onLaunch} title={launchLabel}>
          <IconLaunch size={16} />
          <span>{launchLabel}</span>
        </button>
        <div className="sidebar-hint">
          <span className={`dot${ready ? ' is-on' : ' is-warn'}`} />
          <span>{companionHint}</span>
        </div>
      </div>
    </nav>
  )
}
