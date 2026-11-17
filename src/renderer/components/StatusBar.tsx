import type { ReactElement } from 'react'
import type { ColorScheme, RuntimeInfo, ThemeName, WatchMode } from '@shared/types'

const THEME_LABEL: Record<ThemeName, string> = {
  glass: '玻璃',
  minimal: '简约'
}

const SCHEME_LABEL: Record<ColorScheme, string> = {
  light: '浅色',
  dark: '深色'
}

/** 底部状态栏：左边状态、右边环境信息（需求 N6，M1 只做静态部分） */
export function StatusBar({
  runtime,
  theme,
  scheme,
  watchMode,
  watchCount,
  fileCount
}: {
  runtime: RuntimeInfo
  theme: ThemeName
  scheme: ColorScheme
  watchMode: WatchMode
  watchCount: number
  fileCount: number
}): ReactElement {
  const watching = watchCount > 0
  const watchLabel = !watching
    ? '未设置监听目录'
    : watchMode === 'realtime'
      ? `实时监听 · ${watchCount} 个目录`
      : `启动时扫描 · ${watchCount} 个目录`
  return (
    <footer className="statusbar">
      <div className="statusbar-item">
        <span className={`dot${watching ? ' is-on' : ' is-warn'}`} />
        <span title={watching ? (watchMode === 'realtime' ? '丢文件约 2 秒内自动更新' : '更新请点文件页的「刷新」') : ''}>
          {watchLabel}
        </span>
      </div>
      <div className="statusbar-item">文件 {fileCount}</div>
      <div className="statusbar-item is-grow">
        <span className="statusbar-mono" title={runtime.dataDir}>
          {runtime.dataDir}
        </span>
      </div>
      <div className="statusbar-item">
        {THEME_LABEL[theme]} · {SCHEME_LABEL[scheme]}
      </div>
      <div className="statusbar-item">{runtime.isDev ? '开发模式' : '正式版'}</div>
      <div className="statusbar-item">v{runtime.version}</div>
    </footer>
  )
}
