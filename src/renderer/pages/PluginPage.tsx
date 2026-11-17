import { useEffect, useState, type ReactElement } from 'react'
import { SchemaForm } from '../components/SchemaForm'
import { usePlugins } from '../store/plugins'

const STATUS_TEXT: Record<string, string> = {
  running: '运行中',
  waiting: '等待依赖',
  failed: '加载失败',
  disabled: '已禁用'
}

interface PluginPageProps {
  onToast: (message: string) => void
}

/** 插件中心：列表 / 状态 / 装卸 / 自动生成的配置表单 */
export function PluginPage({ onToast }: PluginPageProps): ReactElement {
  const items = usePlugins((s) => s.items)
  const pages = usePlugins((s) => s.pages)
  const selectedId = usePlugins((s) => s.selectedId)
  const loading = usePlugins((s) => s.loading)
  const revision = usePlugins((s) => s.configRevision)
  const select = usePlugins((s) => s.select)
  const setEnabled = usePlugins((s) => s.setEnabled)
  const reload = usePlugins((s) => s.reload)
  const uninstall = usePlugins((s) => s.uninstall)
  const install = usePlugins((s) => s.install)

  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [dirty, setDirty] = useState(false)
  const selected = items.find((p) => p.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId) {
      setDraft({})
      return
    }
    let alive = true
    void window.api.plugins.getConfig(selectedId).then((cfg) => {
      if (alive) {
        setDraft(cfg)
        setDirty(false)
      }
    })
    return () => {
      alive = false
    }
  }, [selectedId, revision])

  const doInstall = async (mode: 'folder' | 'zip'): Promise<void> => {
    await install(mode)
    onToast(mode === 'zip' ? '已处理 zip 安装包' : '已处理插件目录')
  }

  const save = async (): Promise<void> => {
    if (!selectedId) return
    const res = await window.api.plugins.setConfig(selectedId, draft)
    if (res.ok) {
      setDirty(false)
      onToast('插件配置已保存')
    } else {
      onToast(res.error ?? '保存失败')
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">插件中心</h1>
          <p className="page-sub">
            共 {items.length} 个插件 · 运行中 {items.filter((p) => p.status === 'running').length} 个
            {pages.length > 0 ? ` · 插件页面 ${pages.length} 个` : ''}
          </p>
        </div>
        <div className="plugin-head-actions">
          <button className="btn is-sm" onClick={() => void doInstall('folder')}>从文件夹安装</button>
          <button className="btn is-sm" onClick={() => void doInstall('zip')}>从 zip 安装</button>
          <button className="btn is-sm is-ghost" onClick={() => void usePlugins.getState().load()}>刷新</button>
        </div>
      </div>

      <div className="plugin-notice">
        插件是本地可信代码，主进程直接加载 —— 安装即授权。请只安装你信任的插件；写坏的插件会被隔离到「加载失败」，但无法做到进程级隔离。
      </div>

      {loading && items.length === 0 ? <div className="empty-desc">正在读取插件…</div> : null}
      {!loading && items.length === 0 ? (
        <div className="empty">
          <div className="empty-title">还没有插件</div>
          <div className="empty-desc">用右上角按钮安装一个，或把插件目录放进插件目录后点「刷新」。</div>
        </div>
      ) : null}

      <div className="plugin-layout">
        <div className="plugin-list">
          {items.map((p) => (
            <button
              key={p.id}
              className={`plugin-item${p.id === selectedId ? ' is-active' : ''}`}
              onClick={() => select(p.id)}
            >
              <span className={`plugin-status plugin-status--${p.status}`}>{STATUS_TEXT[p.status] ?? p.status}</span>
              <span className="plugin-item-name">{p.name}</span>
              <span className="plugin-item-id">{p.id} · v{p.version}{p.source === 'builtin' ? ' · 内置' : ''}</span>
              {p.error ? <span className="plugin-item-error">{p.error}</span> : null}
            </button>
          ))}
        </div>

        {selected ? (
          <div className="plugin-detail">
            <div className="plugin-detail-head">
              <div>
                <h2 className="plugin-detail-title">{selected.name}</h2>
                <div className="plugin-detail-meta">
                  {selected.id} · v{selected.version}
                  {selected.author ? ` · ${selected.author}` : ''}
                  {selected.system ? ' · 系统插件' : ''}
                </div>
              </div>
              <div className="plugin-detail-actions">
                <button
                  className="btn is-sm"
                  disabled={selected.system}
                  onClick={() => void setEnabled(selected.id, selected.status !== 'running')}
                >
                  {selected.status === 'running' ? '禁用' : '启用'}
                </button>
                <button className="btn is-sm is-ghost" onClick={() => void reload(selected.id)}>重载</button>
                <button
                  className="btn is-sm is-ghost"
                  disabled={selected.source === 'builtin'}
                  onClick={() => void uninstall(selected.id)}
                >
                  卸载
                </button>
              </div>
            </div>

            {selected.description ? <p className="plugin-detail-desc">{selected.description}</p> : null}
            {selected.error ? <div className="plugin-error-box">加载器报告：{selected.error}</div> : null}
            {selected.inject.length > 0 ? (
              <div className="plugin-detail-meta">依赖服务：{selected.inject.join('、')}</div>
            ) : null}
            {selected.permissions.length > 0 ? (
              <div className="plugin-permissions">
                权限声明：<b>{selected.permissions.join('、')}</b>
              </div>
            ) : null}
            <div className="plugin-detail-meta">插件目录：{selected.dir}</div>

            <h3 className="plugin-section-title">配置</h3>
            <SchemaForm
              schema={selected.configSchema}
              value={draft}
              onPatch={(next) => {
                setDraft(next)
                setDirty(true)
              }}
            />
            <button className="btn is-primary is-sm" disabled={!dirty} onClick={() => void save()}>
              保存配置
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
