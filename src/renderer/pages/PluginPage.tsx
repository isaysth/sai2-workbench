import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactElement
} from 'react'
import type { AppConfig, OpenerView, RuntimeInfo } from '@shared/types'
import { SchemaForm } from '../components/SchemaForm'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { IconCaretDown } from '../components/Icons'
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
  // 「安装插件 ▾」分裂菜单（D-019：原来并排的 3 个安装/打开按钮合并到这里）
  const [installOpen, setInstallOpen] = useState(false)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const installToggleRef = useRef<HTMLButtonElement | null>(null)
  const installMenuRef = useRef<HTMLDivElement | null>(null)
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
          if (res.ok) {
            const id = res.id ? ` ${res.id}` : ''
            onToast(`已安装插件${id}，若界面没变化请点标题栏右上角的「重启」`)
          } else onToast(`安装失败：${res.error ?? '未知原因'}`)
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

  // 分裂菜单的关闭语义与 ContextMenu 一致：点别处 / 窗口失焦关闭
  useEffect(() => {
    if (!installOpen) return
    const onDown = (e: globalThis.MouseEvent): void => {
      if (splitRef.current && !splitRef.current.contains(e.target as Node)) setInstallOpen(false)
    }
    const onBlur = (): void => setInstallOpen(false)
    // 捕获阶段：避免同一次 mousedown 又让触发按钮把菜单重新打开
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [installOpen])

  // 打开后焦点落到第一项，键盘用户不必先 Tab 一圈（Enter/空格在按钮上是原生 click）
  useEffect(() => {
    if (!installOpen) return
    installMenuRef.current?.querySelector<HTMLButtonElement>('.context-item')?.focus()
  }, [installOpen])

  const doInstall = async (mode: 'folder' | 'zip'): Promise<void> => {
    await install(mode)
    onToast(mode === 'zip' ? '已处理 zip 安装包' : '已处理插件目录')
  }

  const pickInstall = (action: 'zip' | 'folder' | 'dir'): void => {
    setInstallOpen(false)
    if (action === 'dir') {
      void openDir().then((ok) => onToast(ok ? '已打开插件目录，把 zip 放进去即可' : '打开插件目录失败'))
    } else void doInstall(action)
  }

  /** 菜单内方向键 / Home / End 移动焦点，Esc 关闭并把焦点还给触发按钮 */
  const onInstallMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setInstallOpen(false)
      installToggleRef.current?.focus()
      return
    }
    if (e.key === 'Tab') {
      // 不拦 Tab：先让浏览器把焦点移出去，再卸载菜单，否则焦点会掉到 body
      setTimeout(() => setInstallOpen(false), 0)
      return
    }
    const list = Array.from(
      installMenuRef.current?.querySelectorAll<HTMLButtonElement>('.context-item') ?? []
    )
    if (list.length === 0) return
    const idx = list.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % list.length
    else if (e.key === 'ArrowUp') next = idx <= 0 ? list.length - 1 : idx - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = list.length - 1
    if (next === null) return
    e.preventDefault()
    list[next].focus()
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
        // disabled 是「用户主动禁用」的唯一状态；waiting / failed 仍属启用中
        const enabled = p.status !== 'disabled'
        const list: MenuItem[] = [
          {
            id: 'toggle',
            label: enabled ? '禁用此插件' : '启用此插件',
            disabled: p.system && !runtime.isDev,
            onClick: () => void setEnabled(p.id, !enabled)
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
          <div className="btn-split" ref={splitRef}>
            <button
              className="btn is-sm is-primary"
              title="选择 zip 安装包安装"
              onClick={() => {
                setInstallOpen(false)
                void doInstall('zip')
              }}
            >
              安装插件
            </button>
            <button
              ref={installToggleRef}
              type="button"
              className="btn is-sm is-primary btn-split-toggle"
              aria-haspopup="menu"
              aria-expanded={installOpen}
              aria-label="更多安装方式"
              title="更多安装方式"
              onClick={() => setInstallOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setInstallOpen(true)
                } else if (e.key === 'Escape' && installOpen) {
                  e.preventDefault()
                  setInstallOpen(false)
                }
              }}
            >
              <IconCaretDown />
            </button>
            {installOpen ? (
              <div
                ref={installMenuRef}
                className="context-menu btn-split-menu"
                role="menu"
                aria-label="安装方式"
                onKeyDown={onInstallMenuKeyDown}
              >
                <button role="menuitem" className="context-item" onClick={() => pickInstall('zip')}>
                  从 zip 安装
                </button>
                <button role="menuitem" className="context-item" onClick={() => pickInstall('folder')}>
                  从文件夹安装
                </button>
                <div className="context-sep" />
                <button role="menuitem" className="context-item" onClick={() => pickInstall('dir')}>
                  打开插件目录
                </button>
              </div>
            ) : null}
          </div>
          <button className="btn is-sm is-ghost" onClick={() => void load()}>刷新</button>
        </div>
      </div>

      <div className="plugin-notice">
        <b>使用说明</b>
        <br />
        ① 推荐：点右上角「安装插件 ▾」→「打开插件目录」，把插件 zip 丢进去，工作台会自动发现并询问是否安装（确定即装）；也可点「刷新」重新扫描。
        <br />
        ② 传统方式：点「安装插件」直接选 zip 包；「安装插件 ▾」里也可「从文件夹安装」。安装后自动启用。已安装插件的同名 zip 不再重复询问。
        <br />
        ③ 在左侧列表点选一个插件查看状态、说明与配置；卡片右侧的开关可直接启用/禁用，系统插件（如缩略图服务）的开关为灰色不可点。右键列表项还可快速启用/禁用、重载、复制 ID 或卸载。
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
          <div className="empty-desc">用右上角按钮安装一个，或把插件 zip 放进插件目录后点「刷新」。</div>
        </div>
      ) : null}

      <div className="plugin-layout">
        <div className="plugin-list">
          {items.map((p) => (
            <div
              key={p.id}
              className={`plugin-item${p.id === selectedId ? ' is-active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => select(p.id)}
              onContextMenu={(e) => onItemContext(p, e)}
              onKeyDown={(e) => {
                // 焦点在开关上时，按键归开关自己（否则空格会选中卡片而不切换）
                if (e.target !== e.currentTarget) return
                if (e.key !== 'Enter' && e.key !== ' ') return
                // 空格默认会滚页面
                if (e.key === ' ') e.preventDefault()
                select(p.id)
              }}
              title="右键查看更多操作"
            >
              <div className="plugin-item-main">
                <span className={`plugin-status plugin-status--${p.status}`}>{STATUS_TEXT[p.status] ?? p.status}</span>
                <span className="plugin-item-name">{p.name}</span>
                <span className="plugin-item-id">{p.id} · v{p.version}{p.source === 'builtin' ? ' · 内置' : ''}</span>
                {p.error ? <span className="plugin-item-error">{p.error}</span> : null}
              </div>
              {(() => {
                const enabled = p.status !== 'disabled'
                // 系统插件正常模式锁死；开发模式下按需求 §5 允许关（主进程也会放行）
                const locked = p.system && !runtime.isDev
                return (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={enabled ? `禁用 ${p.name}` : `启用 ${p.name}`}
                    title={locked ? '系统插件不能禁用' : enabled ? '点击禁用' : '点击启用'}
                    className={`plugin-switch${enabled ? ' is-on' : ''}`}
                    disabled={locked}
                    onClick={(e) => {
                      // 否则会顺带选中卡片、跳详情
                      e.stopPropagation()
                      void setEnabled(p.id, !enabled)
                    }}
                  >
                    <span className="plugin-switch-dot" />
                  </button>
                )
              })()}
            </div>
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
                  disabled={selected.system && !runtime.isDev}
                  onClick={() => void setEnabled(selected.id, selected.status === 'disabled')}
                >
                  {selected.status !== 'disabled' ? '禁用' : '启用'}
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
