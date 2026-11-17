import type { ReactElement } from 'react'
import type { AppConfig, OpenerView } from '@shared/types'

interface OpenerSettingsProps {
  config: AppConfig
  openers: OpenerView[]
  updateConfig: (key: string, value: unknown) => Promise<void>
  refreshOpeners?: () => void
  toast: (msg: string) => void
}

/**
 * 打开器（SAI2 / PS / CSP）的配置。
 * 这些路径由 opener-* 插件提供，所以界面放在插件中心；
 * 内核只保留这一个小组件，避免和设置页各写一份。
 */
export function OpenerSettings({
  config,
  openers,
  updateConfig,
  refreshOpeners,
  toast
}: OpenerSettingsProps): ReactElement {
  const save = (key: string, value: string): void => {
    void updateConfig(key, value).then(() => {
      refreshOpeners?.()
      toast(value ? '路径已保存' : '路径已清空')
    })
  }

  return (
    <section className="setting-card">
      <div className="setting-card-head">
        <span className="setting-card-title">打开器插件</span>
        <span className="setting-card-note">决定侧栏按钮和双击行为</span>
      </div>

      <div className="setting-row">
        <span className="setting-label">默认打开器</span>
        <select
          className="select"
          value={config.openers.default}
          onChange={(e) => void updateConfig('openers.default', e.target.value)}
          title="只有填了路径的打开器才能设为默认"
        >
          {openers.length > 0
            ? openers.map((o) => (
                <option key={o.id} value={o.id} disabled={!o.ready}>
                  {o.label}{o.ready ? '' : '（未配置路径）'}
                </option>
              ))
            : <option value={config.openers.default}>读取中…</option>}
        </select>
      </div>

      {(['sai2', 'ps', 'csp'] as const).map((key) => {
        const found = openers.find((o) => o.configKey === key)
        const path = found?.path ?? config.openers[key].path
        const ready = found?.ready ?? false
        return (
          <div className="setting-row" key={key}>
            <span className="setting-label">
              <span className={`dot${ready ? ' is-on' : ' is-warn'}`} />{' '}
              {key === 'sai2' ? 'SAI2' : key === 'ps' ? 'Photoshop' : 'Clip Studio'}
            </span>
            <span className="setting-value" title={path || undefined}>
              {path || '未填写'}
            </span>
            <button
              className="btn is-sm"
              onClick={() => {
                void window.api.pickFile('exe').then((res) => {
                  if (res.canceled) return
                  if (!res.ok || res.paths.length === 0) {
                    toast(res.ok ? '没选到程序' : '选择失败')
                    return
                  }
                  save(`openers.${key}.path`, res.paths[0]!)
                })
              }}
            >
              选择程序
            </button>
            {path ? (
              <button className="btn is-sm is-ghost" onClick={() => save(`openers.${key}.path`, '')}>
                清空
              </button>
            ) : null}
          </div>
        )
      })}
      <span className="setting-card-note">
        启动外部程序时不经过命令行解释器；关掉工作台不会连带关闭画图软件。
        联动软件在「sai2-companion」的配置里设置。
      </span>
    </section>
  )
}
