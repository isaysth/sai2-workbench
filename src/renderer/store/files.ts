import { create } from 'zustand'
import type { FileChangeEvent, FileMetaEvent, IndexProgress, ProjectFile } from '@shared/types'

/**
 * 文件列表 store。
 *
 * 为什么不直接"每次变更重新拉一遍列表"：一次复制 500 个文件进来，拉 500 次
 * （每次都是几十 KB 的 JSON）比直接吃主进程推来的增量慢一个数量级。
 * 所以主进程按 120ms 合并推 adds/removes，这里按 path 增量合并。
 *
 * ★ 合并必须按 path 而**不是**整体替换：滚到第 800 条时删掉第 3 条，
 *   整体替换会把所有卡片重建、滚动位置直接丢失。
 *
 * 筛选（需求 v1.21 / M2b）：`items` 永远是全量，`visible` 是从它派生出来的结果。
 * 过滤放渲染端而不是主进程，是因为输入关键词时每敲一个字都要重算一遍，
 * 走 IPC 会有可感知的延迟；5000 条本地 filter + 保序排序实测在 2ms 级。
 */

export type KindFilter = 'all' | 'sai2' | 'psd' | 'image' | 'other'
export type TimeFilter = 'all' | '7d' | '30d' | '90d' | 'year'
export type SortKey = 'mtime' | 'name' | 'size'

/**
 * 项目 / 标签筛选用数字表达三种状态，省掉两个布尔开关：
 *   0  = 全部（不筛）
 *  -1  = 未归类 / 无标签
 *  >0  = 具体的 id
 */
export interface FileFilters {
  /** 文件名 / 目录名，空格分隔多关键词（AND） */
  keyword: string
  /** '' = 全部监听目录 */
  dir: string
  kind: KindFilter
  projectId: number
  tagId: number
  time: TimeFilter
  sort: SortKey
}

export const DEFAULT_FILTERS: FileFilters = {
  keyword: '',
  dir: '',
  kind: 'all',
  projectId: 0,
  tagId: 0,
  time: 'all',
  sort: 'mtime'
}

export function hasFilters(f: FileFilters): boolean {
  return (
    f.keyword.trim() !== '' ||
    f.dir !== '' ||
    f.kind !== 'all' ||
    f.projectId !== 0 ||
    f.tagId !== 0 ||
    f.time !== 'all' ||
    f.sort !== 'mtime'
  )
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function kindOf(ext: string): Exclude<KindFilter, 'all'> {
  if (ext === '.sai2' || ext === '.sai') return 'sai2'
  if (ext === '.psd' || ext === '.psb') return 'psd'
  if (IMAGE_EXTS.has(ext)) return 'image'
  // CLIP / KRA 还没原生解码，但仍是工程文件；单独归到「其他」
  return 'other'
}

function timeBoundary(t: TimeFilter): number {
  if (t === 'all') return 0
  const now = Date.now()
  if (t === 'year') return new Date(new Date(now).getFullYear(), 0, 1).getTime()
  const days = t === '7d' ? 7 : t === '30d' ? 30 : 90
  return now - days * 86_400_000
}

/** Windows 路径大小写不敏感；统一成反斜杠再比前缀，避免 dir 末尾有无斜杠两种写法 */
function isInside(file: string, dir: string): boolean {
  const f = file.toLowerCase().replaceAll('/', '\\')
  const d = dir.toLowerCase().replaceAll('/', '\\')
  return f === d || f.startsWith(d.endsWith('\\') ? d : `${d}\\`)
}

function applyFilters(all: ProjectFile[], f: FileFilters): ProjectFile[] {
  const terms = f.keyword.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const since = timeBoundary(f.time)
  const out = all.filter((file) => {
    if (f.dir && !isInside(file.path, f.dir)) return false
    if (f.kind !== 'all' && kindOf(file.ext) !== f.kind) return false
    if (since > 0 && file.mtimeMs < since) return false
    if (f.projectId !== 0) {
      if (f.projectId === -1) {
        if (file.projectId) return false
      } else if (file.projectId !== f.projectId) return false
    }
    if (f.tagId !== 0) {
      const tags = file.tags ?? []
      if (f.tagId === -1) {
        if (tags.length > 0) return false
      } else if (!tags.some((t) => t.id === f.tagId)) return false
    }
    if (terms.length > 0) {
      const hay = `${file.name} ${file.dir}`.toLowerCase()
      if (!terms.every((t) => hay.includes(t))) return false
    }
    return true
  })
  // all 已按 mtime desc 排好，filter 是稳定保序的；只有换排序键才需要重排
  if (f.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  else if (f.sort === 'size') out.sort((a, b) => b.size - a.size)
  return out
}

const EMPTY_PROGRESS: IndexProgress = { scanning: false, scanned: 0, dirs: 0, current: '' }

interface FilesStore {
  /** 全量，按修改时间倒序 */
  items: ProjectFile[]
  /** 当前筛选条件命中的结果（瀑布流实际渲染它） */
  visible: ProjectFile[]
  total: number
  filters: FileFilters
  scanning: boolean
  progress: IndexProgress
  loaded: boolean
  selected: string | null

  init: () => Promise<void>
  dispose: () => void
  select: (path: string | null) => void
  refresh: () => Promise<void>
  setFilters: (patch: Partial<FileFilters>) => void
  resetFilters: () => void
  /** 主进程推来的标签/项目变更：只动那一张卡 */
  patchMeta: (ev: FileMetaEvent) => void
  setFileTags: (path: string, names: string[]) => Promise<{ ok: boolean; error?: string }>
  setFileProject: (path: string, id: number | null) => Promise<{ ok: boolean; error?: string }>
}

/** 内存索引。放在 store 外面，避免每次合并都触发一次深比较 */
let index = new Map<string, ProjectFile>()
let unsubChange: (() => void) | null = null
let unsubMeta: (() => void) | null = null
let unsubProgress: (() => void) | null = null
let initing: Promise<void> | null = null

function sortedItems(): ProjectFile[] {
  return [...index.values()].sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
    return a.name.localeCompare(b.name)
  })
}

function withVisible(all: ProjectFile[], f: FileFilters): Pick<FilesStore, 'items' | 'visible' | 'total'> {
  return { items: all, total: all.length, visible: applyFilters(all, f) }
}

function applyEvent(ev: FileChangeEvent): void {
  if (ev.reset) index = new Map()
  for (const item of ev.adds ?? []) index.set(item.path, item)
  for (const path of ev.removes ?? []) index.delete(path)
}

export const useFiles = create<FilesStore>((set, get) => ({
  items: [],
  visible: [],
  total: 0,
  filters: { ...DEFAULT_FILTERS },
  scanning: false,
  progress: EMPTY_PROGRESS,
  loaded: false,
  selected: null,

  init: async () => {
    if (initing) return initing
    initing = (async () => {
      unsubChange = window.api.files.onChanged((ev) => {
        applyEvent(ev)
        // 选中的那张被删 / 被筛掉时不能留幽灵数据，详情面板要回空态
        const sel = get().selected
        const selected = sel !== null && !index.has(sel) ? null : sel
        set({ ...withVisible(sortedItems(), get().filters), selected })
      })
      unsubMeta = window.api.files.onMetaChanged((ev) => get().patchMeta(ev))
      unsubProgress = window.api.files.onProgress((p) => set({ scanning: p.scanning, progress: p }))

      const res = await window.api.files.list()
      index = new Map(res.items.map((f) => [f.path, f]))
      set({ ...withVisible(sortedItems(), get().filters), loaded: true })
      // 订阅与首次拉取之间有个空窗，进页面时补一次，避免错过扫描中的批次
      const again = await window.api.files.list()
      if (again.total !== res.total) {
        index = new Map(again.items.map((f) => [f.path, f]))
        set(withVisible(sortedItems(), get().filters))
      }
    })()
    return initing
  },

  dispose: () => {
    unsubChange?.()
    unsubMeta?.()
    unsubProgress?.()
    unsubChange = null
    unsubMeta = null
    unsubProgress = null
    initing = null
  },

  select: (selected) => set({ selected }),

  refresh: async () => {
    const res = await window.api.files.list()
    index = new Map(res.items.map((f) => [f.path, f]))
    set({ ...withVisible(sortedItems(), get().filters), loaded: true })
    if (get().selected && !index.has(get().selected!)) set({ selected: null })
  },

  setFilters: (patch) => {
    const filters = { ...get().filters, ...patch }
    const visible = applyFilters(get().items, filters)
    const selected = get().selected
    // 选中的卡片被筛掉时不能留一个"看不见的高亮"，详情面板也该回到空态
    const keep = selected !== null && visible.some((v) => v.path === selected)
    set({ filters, visible, selected: keep ? selected : null })
  },

  resetFilters: () => {
    const filters = { ...DEFAULT_FILTERS }
    set({ filters, visible: applyFilters(get().items, filters) })
  },

  patchMeta: (ev) => {
    const file = index.get(ev.path)
    if (!file) return
    // 必须换成新对象：详情面板的 selector 用 Object.is 比较，
    // 原地改字段会让它认为"什么都没变"，面板就不刷新
    index.set(ev.path, { ...file, tags: ev.tags, projectId: ev.projectId, project: ev.project })
    set(withVisible(sortedItems(), get().filters))
  },

  setFileTags: async (path, names) => {
    const res = await window.api.files.setTags(path, names)
    // 主进程同时会广播 files:meta-changed，这里就地先更新一次免得等一个来回
    if (res.ok && res.tags) {
      const file = index.get(path)
      if (file) {
        index.set(path, { ...file, tags: res.tags })
        set(withVisible(sortedItems(), get().filters))
      }
    }
    return res
  },

  setFileProject: async (path, id) => {
    const res = await window.api.files.setProject(path, id)
    if (res.ok) {
      const file = index.get(path)
      if (file) {
        index.set(path, { ...file, projectId: res.projectId ?? null, project: res.project ?? null })
        set(withVisible(sortedItems(), get().filters))
      }
    }
    return res
  }
}))
