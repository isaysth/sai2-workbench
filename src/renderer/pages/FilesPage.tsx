import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { MasonryGrid } from '../components/MasonryGrid'
import { ContextMenu } from '../components/ContextMenu'
import { IconFolder, IconGrid, IconRefresh, IconSearch } from '../components/Icons'
import {
  hasFilters,
  useFiles,
  type KindFilter,
  type SortKey,
  type TimeFilter
} from '../store/files'
import { useUi } from '../store/ui'
import { useMeta } from '../store/meta'
import { usePlugins } from '../store/plugins'
import type { AppConfig } from '@shared/types'
import type { PageKey } from '../store/ui'

/**
 * 文件管理页。
 *
 * 这一页是 M2a 的主界面：监听目录里的稿件按修改时间倒序铺成瀑布流。
 * 卡片缩略图走 `sai2img://thumb/<key>` 直接由 Chromium 解码 —— 不走 base64，
 * 内存不翻倍，滚出视口后浏览器自己回收。
 *
 * v1.21 起默认「仅启动时扫描」，右上角「刷新」是唯一手动重扫入口；
 * 顶部工具条负责在稿件变多后把范围缩到能一眼找到的那几张。
 */

const KIND_OPTIONS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'sai2', label: 'SAI2' },
  { id: 'psd', label: 'PSD' },
  { id: 'image', label: '图片' },
  { id: 'other', label: '其他' }
]

const TIME_OPTIONS: Array<{ id: TimeFilter; label: string }> = [
  { id: 'all', label: '不限时间' },
  { id: '7d', label: '最近 7 天' },
  { id: '30d', label: '最近 30 天' },
  { id: '90d', label: '最近 90 天' },
  { id: 'year', label: '今年' }
]

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'mtime', label: '最近修改' },
  { id: 'name', label: '按名称' },
  { id: 'size', label: '按大小' }
]

function tailOf(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || dir
}

function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function FilesPage({
  goto,
  config,
  toast
}: {
  goto: (page: PageKey) => void
  config: AppConfig
  toast: (message: string) => void
}): ReactElement {
  const visible = useFiles((s) => s.visible)
  const total = useFiles((s) => s.total)
  const filters = useFiles((s) => s.filters)
  const setFilters = useFiles((s) => s.setFilters)
  const resetFilters = useFiles((s) => s.resetFilters)
  const scanning = useFiles((s) => s.scanning)
  const progress = useFiles((s) => s.progress)
  const selected = useFiles((s) => s.selected)
  const select = useFiles((s) => s.select)
  const showToast = useUi((s) => s.showToast)
  const tags = useMeta((s) => s.tags)
  const projects = useMeta((s) => s.projects)

  const dirCount = config.watch.dirs.length
  const columnWidth = config.general.thumbnailSize
  const [keywordInput, setKeywordInput] = useState(filters.keyword)
  const [refreshing, setRefreshing] = useState(false)
  // 扫描只要 2~3ms，按钮立刻复原会让人不确定"到底刷了没"，于是补一个短暂态 + 上次扫描时间
  const [lastRefresh, setLastRefresh] = useState<number | null>(null)
  const [justRefreshed, setJustRefreshed] = useState(false)

  // 外部（清除筛选按钮 / 其它页面）改了关键词时，输入框要跟着回退
  useEffect(() => {
    setKeywordInput(filters.keyword)
  }, [filters.keyword])

  // 每敲一个字都让上千条瀑布流重排没必要，120ms 防抖后写入 store
  useEffect(() => {
    if (keywordInput === filters.keyword) return
    const timer = setTimeout(() => setFilters({ keyword: keywordInput }), 120)
    return () => clearTimeout(timer)
  }, [keywordInput, filters.keyword, setFilters])

  const addDir = useCallback(async () => {
    const res = await window.api.files.addDir()
    if (res.canceled) return
    if (!res.ok) {
      showToast(res.message ?? '添加失败')
      return
    }
    showToast(res.added ? `已添加 ${res.added} 个目录，开始索引` : (res.message ?? '已添加'))
  }, [showToast])

  const refresh = useCallback(async () => {
    if (refreshing || scanning) return
    setRefreshing(true)
    try {
      const res = await window.api.files.rescan()
      if (res.ok && !res.already) {
        setLastRefresh(Date.now())
        showToast(`扫描完成：${res.total ?? 0} 个文件`)
      }
    } catch {
      showToast('刷新失败，详情看日志页')
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, scanning, showToast])

  // 「已刷新」只停 1.6 秒：够看清，又不至于长期占着按钮位置
  useEffect(() => {
    if (lastRefresh === null) return
    setJustRefreshed(true)
    const timer = setTimeout(() => setJustRefreshed(false), 1600)
    return () => clearTimeout(timer)
  }, [lastRefresh])

  const clearFilters = useCallback(() => {
    setKeywordInput('')
    resetFilters()
  }, [resetFilters])

  const onSelect = useCallback((path: string) => select(path), [select])

  // M3b：双击打开 + 右键菜单。菜单坐标是视口坐标，ContextMenu 内部贴边翻转
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const fileActions = usePlugins((s) => s.fileActions)

  const openFile = useCallback(
    (path: string) => {
      void window.api.launch(path).then((res) => {
        toast(res.ok ? '已交给画图程序打开' : (res.error ?? '打开失败'))
      })
    },
    [toast]
  )

  const onContext = useCallback((path: string, x: number, y: number) => {
    setMenu({ x, y, path })
  }, [])

  const onPluginAction = useCallback(
    (id: string, path: string) => {
      void window.api.plugins.runAction('file', id, path).then((res) => {
        if (!res.ok) toast(res.error ?? '插件动作执行失败')
      })
    },
    [toast]
  )

  const menuExt = menu ? (visible.find((f) => f.path === menu.path)?.ext ?? '') : ''
  const closeMenu = useCallback(() => setMenu(null), [])

  const filterKey = `${filters.keyword}|${filters.dir}|${filters.kind}|${filters.projectId}|${filters.tagId}|${filters.time}|${filters.sort}`
  const busy = refreshing || scanning

  const empty =
    dirCount === 0 ? (
      <div className="empty">
        <div className="empty-mark">
          <IconGrid />
        </div>
        <div className="empty-title">还没有监听目录</div>
        <div className="empty-desc">
          添加一个装稿子的文件夹，程序启动时会扫一遍，之后随时点右上角「刷新」重新扫描。
          <br />
          SAI2 文件不用装任何外部工具就能出缩略图。
        </div>
        <button className="btn is-primary" onClick={() => void addDir()}>
          选择文件夹
        </button>
      </div>
    ) : total === 0 ? (
      <div className="empty">
        <div className="empty-mark">
          <IconGrid />
        </div>
        <div className="empty-title">上次扫描没找到稿件</div>
        <div className="empty-desc">
          确认文件放进了监听目录、扩展名也在设置里勾上了，再点「刷新」重扫一次。
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn is-primary" onClick={() => void refresh()}>
            立即刷新
          </button>
          <button className="btn" onClick={() => goto('settings')}>
            去设置里看看
          </button>
        </div>
      </div>
    ) : (
      <div className="empty">
        <div className="empty-mark">
          <IconSearch size={22} />
        </div>
        <div className="empty-title">没有符合条件的文件</div>
        <div className="empty-desc">
          换个关键词或放宽时间范围试试；也可以直接清除全部筛选看回 {total} 个文件。
        </div>
        <button className="btn is-primary" onClick={clearFilters}>
          清除筛选
        </button>
      </div>
    )

  return (
    <div className="page files-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">文件管理</h1>
          <p className="page-sub">
            {scanning ? (
              <>
                正在索引：已扫 {progress.scanned} 个文件 / {progress.dirs} 个目录
                <span className="files-scan-path"> {progress.current}</span>
              </>
            ) : dirCount === 0 ? (
              '还没有监听目录，添加一个文件夹就会开始收集稿件'
            ) : (
              <>
                {hasFilters(filters) ? `筛出 ${visible.length} / ${total} 个文件` : `${total} 个文件`}
                {' · '}监听 {dirCount} 个目录
                {' · '}
                {config.watch.mode === 'realtime'
                  ? '实时监听'
                  : lastRefresh !== null
                    ? `上次扫描 ${hhmm(lastRefresh)}`
                    : '启动时扫描，点「刷新」更新'}
              </>
            )}
          </p>
        </div>
        <div className="files-head-actions">
          <div className="files-search">
            <IconSearch />
            <input
              className="input"
              placeholder="搜索文件名 / 目录（空格分隔）"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setKeywordInput('')
                  setFilters({ keyword: '' })
                }
              }}
              disabled={dirCount === 0 && total === 0}
            />
          </div>
          <button
            className="btn files-refresh-btn"
            disabled={busy || dirCount === 0}
            onClick={() => void refresh()}
            title="重新扫描所有监听目录（默认只在启动时自动扫一次）"
          >
            <IconRefresh className={busy ? 'is-spinning' : undefined} />
            {busy ? '扫描中…' : justRefreshed ? '已刷新' : '刷新'}
          </button>
          <button className="btn" onClick={() => void addDir()}>
            <IconFolder size={14} />
            添加文件夹
          </button>
        </div>
      </div>

      <div className="files-toolbar">
        <div className="files-filter-group">
          <span className="files-filter-label">类型</span>
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`filter-chip${filters.kind === opt.id ? ' is-on' : ''}`}
              onClick={() => setFilters({ kind: opt.id })}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="files-filter-group">
          <span className="files-filter-label">目录</span>
          <select
            className="select"
            value={filters.dir}
            onChange={(e) => setFilters({ dir: e.target.value })}
            title="按监听目录筛选"
          >
            <option value="">全部目录</option>
            {config.watch.dirs.map((dir) => (
              <option key={dir} value={dir} title={dir}>
                {tailOf(dir)}
              </option>
            ))}
          </select>
        </div>

        <div className="files-filter-group">
          <span className="files-filter-label">项目</span>
          <select
            className="select"
            value={filters.projectId}
            onChange={(e) => setFilters({ projectId: Number(e.target.value) })}
            title="按项目归属筛选"
          >
            <option value={0}>全部项目</option>
            <option value={-1}>未归类</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.client ? `${p.name}（${p.client}）` : p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="files-filter-group">
          <span className="files-filter-label">标签</span>
          <select
            className="select"
            value={filters.tagId}
            onChange={(e) => setFilters({ tagId: Number(e.target.value) })}
            title="按标签筛选"
          >
            <option value={0}>全部标签</option>
            <option value={-1}>无标签</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="files-filter-group">
          <span className="files-filter-label">修改时间</span>
          <select
            className="select"
            value={filters.time}
            onChange={(e) => setFilters({ time: e.target.value as TimeFilter })}
          >
            {TIME_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="files-filter-group">
          <span className="files-filter-label">排序</span>
          <select
            className="select"
            value={filters.sort}
            onChange={(e) => setFilters({ sort: e.target.value as SortKey })}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {hasFilters(filters) ? (
          <button className="btn is-sm is-ghost" onClick={clearFilters}>
            清除筛选
          </button>
        ) : null}
        <span className="files-result">
          {visible.length} / {total}
        </span>
      </div>

      {scanning ? (
        <div className="files-progress">
          <div className="files-progress-bar" />
        </div>
      ) : null}

      <MasonryGrid
        items={visible}
        columnWidth={columnWidth}
        selected={selected}
        onSelect={onSelect}
        onOpen={openFile}
        onContextMenu={onContext}
        scrollResetKey={filterKey}
        empty={empty}
      />

      <ContextMenu
        at={menu}
        onClose={closeMenu}
        onOpen={openFile}
        onReveal={(path) => void window.api.files.reveal(path)}
        onCopyPath={(path) => void navigator.clipboard.writeText(path).then(() => toast('路径已复制'))}
        ext={menuExt}
        pluginActions={fileActions}
        onPluginAction={onPluginAction}
      />
    </div>
  )
}
