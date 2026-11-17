import type { ReactElement } from 'react'
import type { AppConfig, OpenerView, RuntimeInfo } from '@shared/types'
import type { PageKey } from '../store/ui'
import { CitrusMark } from '../components/Brand'
import { IconFolder, IconInfo, IconLaunch } from '../components/Icons'

/** 启动页：画图程序入口 + 打开器状态 + 联动配置引导 */
export function LaunchPage({
  runtime,
  config,
  goto,
  toast,
  openers,
  onLaunch
}: {
  runtime: RuntimeInfo
  config: AppConfig
  goto: (page: PageKey) => void
  toast: (message: string) => void
  openers: OpenerView[]
  onLaunch: (file?: string) => void
}): ReactElement {
  const ready = openers.filter((o) => o.ready)
  const current = openers.find((o) => o.current)
  const configured = ready.length > 0

  const launch = (): void => {
    if (!configured) {
      toast('还没填画图程序路径，先去设置里填一下')
      goto('settings')
      return
    }
    onLaunch()
  }

  return (
    <div className="page">
      <section className="launch-hero">
        <CitrusMark size={56} className="launch-logo" />
        <h1 className="launch-h1">把稿子摊开，一眼找到要画的那张</h1>
        <p className="launch-desc">
          文件夹里的新稿启动时会扫一遍，缩略图直接出；右键或双击就能交给画图程序。
          默认打开器可以在设置里换，侧栏按钮和双击行为会一起跟着变。
        </p>
        <div className="launch-actions">
          <button className="launch-main" onClick={launch}>
            <IconLaunch size={16} />
            {current ? `启动 ${current.label}` : '启动画图程序'}
          </button>
          <button className="btn" onClick={() => goto('settings')}>
            打开设置
          </button>
          <button className="btn" onClick={() => goto('logs')}>
            查看日志
          </button>
        </div>
      </section>

      <section className="tile-grid">
        {openers.length > 0 ? (
          openers.map((o) => (
            <div className="tile" key={o.id}>
              <div className="tile-title">
                <span className={`dot${o.ready ? ' is-on' : ' is-warn'}`} />
                {o.label}
                {o.current ? '（默认）' : ''}
              </div>
              <div className="tile-desc" style={{ wordBreak: 'break-all' }}>
                {o.ready ? o.path : o.path ? `路径不存在：${o.path}` : '未填路径，去设置里选程序'}
              </div>
            </div>
          ))
        ) : (
          <div className="tile">
            <div className="tile-title">
              <span className="dot is-warn" />
              画图程序
            </div>
            <div className="tile-desc">正在读取打开器插件…若一直不动，去插件中心确认 opener-* 已启用。</div>
          </div>
        )}

        <div className="tile">
          <div className="tile-title">
            <IconInfo size={14} />
            联动软件
          </div>
          <div className="tile-desc">
            {config.plugins.disabled.includes('sai2-companion')
              ? '联动插件已禁用。需要时去插件中心启用。'
              : 'sai2-companion 已就绪：启动画图程序时按配置的顺序和延迟拉起参考图 / 录屏软件。'}
          </div>
        </div>
      </section>

      <section className="tile">
        <div className="tile-title">
          <IconFolder size={14} />
          当前状态
        </div>
        <div className="tile-desc">
          已配置 {ready.length} 个打开器 · 监听 {config.watch.dirs.length} 个文件夹 ·{' '}
          {config.watch.mode === 'startup' ? '仅启动时扫描' : '实时监听'}
          <br />
          运行环境：{runtime.portable ? '便携模式（数据在程序同级）' : '数据在用户目录'} · build{' '}
          {runtime.windowsBuild}
        </div>
      </section>
    </div>
  )
}
