import { Fragment, useState, type ReactElement } from 'react'
import type { AppConfig, OpenerKey, OpenerView } from '@shared/types'

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
  /** 多个候选时先列出来让用户选，避免同一台机器装了多版本 PS 时选错 */
  const [candidates, setCandidates] = useState<{
    key: OpenerKey
    paths: string[]
    selected: string
  } | null>(null)
  const [detecting, setDetecting] = useState<OpenerKey | null>(null)

  const save = (key: string, value: string, message?: string): void => {
    void updateConfig(key, value).then(() => {
      refreshOpeners?.()
      toast(message ?? (value ? '路径已保存' : '路径已清空'))
    })
  }

  /**
   * 自动查找：0 个提示手动选，1 个直接保存，多个渲染下拉框。
   * detecting 期间禁用所有「自动查找」按钮，避免并发结果互相覆盖候选列表。
   */
  const detect = (key: OpenerKey): void => {
    if (detecting) return
    setDetecting(key)
    setCandidates(null)
    void window.api.openers
      .detect(key)
      .then((res) => {
        if (!res.ok) {
          toast(res.error ?? '自动查找失败')
          return
        }
        if (res.paths.length === 0) {
          toast('没找到，请点「选择程序」手动指定')
          return
        }
        if (res.paths.length === 1) {
          const path = res.paths[0]!
          save(`openers.${key}.path`, path, `已自动填入 ${path}`)
          return
        }
        setCandidates({ key, paths: res.paths, selected: res.paths[0]! })
      })
      .finally(() => setDetecting(null))
  }

  const applyCandidate = (): void => {
    if (!candidates) return
    save(`openers.${candidates.key}.path`, candidates.selected, '已填入所选路径')
    setCandidates(null)
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
          <Fragment key={key}>
            <div className="setting-row">
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
              <button
                className="btn is-sm"
                disabled={detecting !== null}
                onClick={() => detect(key)}
              >
                {detecting === key ? '查找中…' : '自动查找'}
              </button>
              {path ? (
                <button className="btn is-sm is-ghost" onClick={() => save(`openers.${key}.path`, '')}>
                  清空
                </button>
              ) : null}
            </div>

            {candidates?.key === key ? (
              <div className="setting-row" style={{ gap: 8 }}>
                <select
                  className="select"
                  style={{ flex: '1 1 auto', minWidth: 0 }}
                  value={candidates.selected}
                  onChange={(e) =>
                    setCandidates((prev) => (prev ? { ...prev, selected: e.target.value } : prev))
                  }
                >
                  {candidates.paths.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <button className="btn is-sm is-primary" onClick={applyCandidate}>
                  填入
                </button>
              </div>
            ) : null}
          </Fragment>
        )
      })}
      <span className="setting-card-note">
        启动外部程序时不经过命令行解释器；关掉工作台不会连带关闭画图软件。
        联动软件在「sai2-companion」的配置里设置。
      </span>
    </section>
  )
}
