import { useEffect, useState, type MouseEvent, type ReactElement } from 'react'
import type { AppConfig, OpenerView, RuntimeInfo } from '@shared/types'
import { SchemaForm } from '../components/SchemaForm'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { OpenerSettings } from '../components/OpenerSettings'
import { usePlugins } from '../store/plugins'
import type { PluginInfo } from '@shared/plugins'

const STATUS_TEXT: Record<string, string> = {
  running: '运行中',
  waiting: '等待依赖',
  failed: '加载失败',
  disabled: '已禁用'
}

interface PluginPageProps {
  onToast: (message: string) => void
  runtime: RuntimeInfo
  config: AppConfig
  updateConfig: (key: string, value: unknown) => Promise<void>
  openers: OpenerView[]
  refreshOpeners: () => void
}

/** 插件中心：列表 / 状态 / 装卸 / 自动生成的配置表单 */
export function PluginPage({ onToast, runtime, config, updateConfig, openers, refreshOpeners }: PluginPageProps): ReactElement {
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
  const openDir = usePlugins((s) => s.openDir)
  const installZipPath = usePlugins((s) => s.installZipPath)
  const load = usePlugins((s) => s.load)

  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [dirty, setDirty] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; plugin: PluginInfo } | null>(null)
  const selected = items.find((p) => p.id === selectedId) ?? null

  // 目录里发现新 zip → 询问是否安装；确定后逐个装，结果用 toast 汇总
  useEffect(() => {
    return window.api.plugins.onZipFound((paths: string[]) => {
      if (!Array.isArray(paths) || paths.length === 0) return
      const names = paths.map((p) => p.split(/[\\/]/).pop() ?? p)
      const label = names.length === 1 ? names[0] : names.join('、')
      const yes = window.confirm(`发现插件安装包：${label}\n\n是否立即安装？`)
      if (!yes) return // 本次会话不再提示（主进程已记入 seen）
      void (async () => {
        for (const path of paths) {
          const res = await installZipPath(path)
          if (res.ok) onToast(`已安装插件 ${res.id ?? ''}`.trim())
          else onToast(`安装失败：${res.error ?? '未知原因'}`)
        }
        await load()
      })()
    })
  }, [installZipPath, load, onToast])

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

  const onItemContext = (p: PluginInfo, e: MouseEvent): void => {
    e.preventDefault()
    select(p.id)
    setMenu({ x: e.clientX, y: e.clientY, plugin: p })
  }

  const closeMenu = (): void => setMenu(null)

  const menuItems: MenuItem[] = menu
    ? (() => {
        const p = menu.plugin
        const running = p.status === 'running'
        const list: MenuItem[] = [
          {
            id: 'toggle',
            label: running ? '禁用此插件' : '启用此插件',
            disabled: p.system,
            onClick: () => void setEnabled(p.id, !running)
          },
          { id: 'reload', label: '重新加载', onClick: () => void reload(p.id) },
          {
            id: 'copy-id',
            label: '复制插件 ID',
            onClick: () => void navigator.clipboard.writeText(p.id).then(() => onToast('插件 ID 已复制'))
          },
          { id: 'sep', label: '', onClick: () => {} },
          {
            id: 'uninstall',
            label: '卸载插件',
            danger: true,
            disabled: p.source === 'builtin',
            onClick: () => void uninstall(p.id)
          }
        ]
        return list
      })()
    : []

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
          <button
            className="btn is-sm is-primary"
            onClick={() => void openDir().then((ok) => onToast(ok ? '已打开插件目录，把 zip 放进去即可' : '打开插件目录失败'))}
          >
            打开插件目录
          </button>
          <button className="btn is-sm" onClick={() => void doInstall('folder')}>从文件夹安装</button>
          <button className="btn is-sm" onClick={() => void doInstall('zip')}>从 zip 安装</button>
          <button className="btn is-sm is-ghost" onClick={() => void load()}>刷新</button>
        </div>
      </div>

      <div className="plugin-notice">
        <b>使用说明</b>
        <br />
        ① 推荐：点右上角「打开插件目录」，把插件 zip 丢进去，工作台会自动发现并询问是否安装（确定即装）；也可点「刷新」重新扫描。
        <br />
        ② 传统方式：「从 zip 安装」/「从文件夹安装」手动选择；安装后自动启用。已安装插件的同名 zip 不再重复询问。
        <br />
        ③ 在左侧列表点选一个插件查看状态、说明与配置；右键列表项可快速启用/禁用、重载、复制 ID 或卸载。
        <br />
        ④ 改完配置记得点「保存配置」；FX Studio 这类插件保存后会自动重载生效。
        <br />
        ⑤ 内置插件不能卸载，系统插件不能禁用。写坏的插件会被隔离到「加载失败」，不会影响主程序。
        <br />
        <span className="plugin-notice-warn">
          安全提示：插件是本地可信代码，主进程直接加载 —— 安装即授权。请只安装你信任的插件，本程序无法做到进程级隔离。
        </span>
        <div className="plugin-notice-dir">插件目录：{runtime.pluginDir}</div>
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
              onContextMenu={(e) => onItemContext(p, e)}
              title="右键查看更多操作"
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

            {/* openers 的三个路径由内核从主配置读，不是插件私有配置 —— 在它自己的详情里给出，
                否则「配置」区空着会让人以为这插件没给配置项（N-008） */}
            {selected.id === 'openers' ? (
              <>
                <h3 className="plugin-section-title">路径配置</h3>
                <OpenerSettings
                  config={config}
                  openers={openers}
                  updateConfig={updateConfig}
                  refreshOpeners={refreshOpeners}
                  toast={onToast}
                />
                <span className="plugin-detail-desc">
                  这三个路径存在主配置里（由内核读取），所以下面的「配置」区是空的——
                  路径改完立刻生效，不需要点保存配置。
                </span>
              </>
            ) : null}

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

      <ContextMenu
        at={menu ? { x: menu.x, y: menu.y } : null}
        onClose={closeMenu}
        items={menuItems}
      />
    </div>
  )
}
