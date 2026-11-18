import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppConfig, BackgroundMode, ColorScheme, ThemeName } from '@shared/types'
import type { Logger } from './logger'

/** 配置结构版本。v2 = 外观拆成「风格 × 明暗 × 背景」三个维度 */
const CONFIG_VERSION = 2

/**
 * 配置中心：JSON + 点分键读写 + 原子写 + 损坏自愈。
 * 需求 §6：断电不损坏配置；坏文件不能让程序起不来。
 */
export const DEFAULT_CONFIG: AppConfig = {
  version: CONFIG_VERSION,
  general: {
    theme: 'glass',
    scheme: 'light',
    background: 'solid',
    backgroundImage: '',
    glassOpacity: 0.32,
    glassBlur: 24,
    bgClarity: 0.4,
    thumbnailSize: 180,
    cardSize: 'md'
  },
  watch: {
    dirs: [],
    mode: 'startup',
    recursive: true,
    extensions: ['.sai2', '.sai', '.psd', '.psb', '.clip', '.kra', '.png', '.jpg', '.jpeg', '.webp'],
    debounceMs: 200
  },
  openers: {
    sai2: { path: '', args: '' },
    ps: { path: '', args: '' },
    csp: { path: '', args: '' },
    default: 'opener-sai2'
  },
  ui: {
    splitterLeft: 208,
    splitterRight: 264,
    windowBounds: null
  },
  plugins: {
    disabled: [],
    config: {}
  },
  cache: {
    thumbVersion: 1,
    /** 2GB。缩略图长边 512 的 webp/png 单张约 20~80KB，2GB 够放几万张 */
    maxThumbBytes: 2 * 1024 * 1024 * 1024
  }
}

const THEMES: ThemeName[] = ['glass', 'minimal']
const SCHEMES: ColorScheme[] = ['light', 'dark']
const BACKGROUNDS: BackgroundMode[] = ['solid', 'image', 'desktop']

/**
 * 内置插件合并后的禁用名单迁移：旧 id → 新 id（M5/T3）。
 * opener-sai2/ps/csp 合成 openers，thumb-image/psd/sai2 合成 thumbs。
 * 组内任一旧插件被禁用 → 新插件默认禁用，避免用户此前关掉某一路能力却在合并后被重新打开。
 * 迁移后会删掉旧 id，天然只跑一次（幂等），不会覆盖用户之后对新插件的选择。
 */
const MERGED_PLUGIN_IDS: Record<string, string> = {
  'opener-sai2': 'openers',
  'opener-ps': 'openers',
  'opener-csp': 'openers',
  'thumb-image': 'thumbs',
  'thumb-psd': 'thumbs',
  'thumb-sai2': 'thumbs'
}

function migratePluginIds(cfg: AppConfig): boolean {
  const disabled = cfg.plugins?.disabled
  if (!Array.isArray(disabled)) return false
  const next: string[] = []
  let changed = false
  for (const id of disabled) {
    const mapped = typeof id === 'string' ? MERGED_PLUGIN_IDS[id] : undefined
    if (mapped) {
      changed = true
      if (!next.includes(mapped)) next.push(mapped)
    } else if (typeof id === 'string') {
      next.push(id)
    } else {
      changed = true // 丢弃非法条目
    }
  }
  if (changed) cfg.plugins.disabled = next
  return changed
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * v1 → v2 迁移：把旧的三合一 theme 拆成「风格 + 明暗」。
 *
 * 映射原则是**观感就近**，升级后用户看到的界面不该变样：
 *   acrylic（白色玻璃）→ glass + light
 *   light（浅色实底）  → minimal + light
 *   dark（深色实底）   → minimal + dark
 *
 * 返回 true 表示确实改动了内容，调用方需要备份并写回。
 */
function migrate(raw: Record<string, unknown>): boolean {
  const ver = Number(raw.version) || 1
  if (ver >= CONFIG_VERSION) return false
  const g = isPlainObject(raw.general) ? raw.general : null
  if (!g) {
    raw.version = CONFIG_VERSION
    return true
  }

  const old = g.theme
  if (old === 'acrylic') {
    g.theme = 'glass'
    g.scheme = 'light'
  } else if (old === 'light') {
    g.theme = 'minimal'
    g.scheme = 'light'
  } else if (old === 'dark') {
    g.theme = 'minimal'
    g.scheme = 'dark'
  }

  // acrylicOpacity 改名 glassOpacity：它早就不代表亚克力材质了，纯 CSS 变量
  if (g.glassOpacity === undefined && g.acrylicOpacity !== undefined) {
    g.glassOpacity = g.acrylicOpacity
  }
  delete g.acrylicOpacity

  raw.version = CONFIG_VERSION
  return true
}

/** 用默认值兜住缺失字段；数组整体替换，不做元素级合并 */
function mergeDefaults<T>(defaults: T, incoming: unknown): T {
  if (!isPlainObject(defaults) || !isPlainObject(incoming)) {
    return (incoming === undefined ? defaults : (incoming as T)) ?? defaults
  }
  const out: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(incoming)) {
    const base = (defaults as Record<string, unknown>)[key]
    out[key] = isPlainObject(base) && isPlainObject(value) ? mergeDefaults(base, value) : value
  }
  return out as T
}

/** 越界或非法值就地修正，保证下游不用再防御 */
function sanitize(cfg: AppConfig): AppConfig {
  if (!THEMES.includes(cfg.general.theme)) cfg.general.theme = DEFAULT_CONFIG.general.theme
  if (!SCHEMES.includes(cfg.general.scheme)) cfg.general.scheme = DEFAULT_CONFIG.general.scheme
  // 选了图片却没有图（文件被删 / 从没选过）时退回纯色，避免窗口一片透明
  if (!BACKGROUNDS.includes(cfg.general.background)) {
    cfg.general.background = DEFAULT_CONFIG.general.background
  }
  if (typeof cfg.general.backgroundImage !== 'string') cfg.general.backgroundImage = ''
  if (cfg.general.background === 'image' && !cfg.general.backgroundImage) {
    cfg.general.background = 'solid'
  }

  // 注意：这里不能用 `Number(x) || 0.24` —— 用户把滑块拉到 0（完全透明）是合法值，
  // 而 0 是 falsy，会被静默改回默认值，导致"拉到最低又弹回去"。
  const rawBlur = Number(cfg.general.glassBlur)
  cfg.general.glassBlur = Number.isFinite(rawBlur) ? Math.min(40, Math.max(0, rawBlur)) : 24
  const rawOpacity = Number(cfg.general.glassOpacity)
  cfg.general.glassOpacity = Number.isFinite(rawOpacity)
    ? Math.min(0.95, Math.max(0, rawOpacity))
    : DEFAULT_CONFIG.general.glassOpacity
  // 同样不能用 `Number(x) || 0.4`：0 表示"背景几乎看不见"，也是合法值
  const rawClarity = Number(cfg.general.bgClarity)
  cfg.general.bgClarity = Number.isFinite(rawClarity)
    ? Math.min(1, Math.max(0, rawClarity))
    : DEFAULT_CONFIG.general.bgClarity
  cfg.general.thumbnailSize = Math.min(320, Math.max(96, Number(cfg.general.thumbnailSize) || 180))
  cfg.ui.splitterLeft = Math.min(400, Math.max(140, Number(cfg.ui.splitterLeft) || 208))
  cfg.ui.splitterRight = Math.min(520, Math.max(200, Number(cfg.ui.splitterRight) || 264))
  if (!Array.isArray(cfg.watch.dirs)) cfg.watch.dirs = []
  if (!Array.isArray(cfg.watch.extensions) || cfg.watch.extensions.length === 0) {
    cfg.watch.extensions = [...DEFAULT_CONFIG.watch.extensions]
  }
  // 扩展名统一成「小写 + 带点」，否则用户加个 "PSD" 就永远匹配不上
  cfg.watch.extensions = cfg.watch.extensions
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => e.length > 1 && e.length < 12)
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
  if (cfg.watch.extensions.length === 0) cfg.watch.extensions = [...DEFAULT_CONFIG.watch.extensions]
  cfg.watch.dirs = cfg.watch.dirs.filter((d): d is string => typeof d === 'string' && d.length > 0)
  // 老配置没有 mode，mergeDefaults 会补 'startup'；这里只兜住手写坏值，
  // 不能把用户主动选的 'realtime' 悄悄改掉
  if (cfg.watch.mode !== 'startup' && cfg.watch.mode !== 'realtime') {
    cfg.watch.mode = DEFAULT_CONFIG.watch.mode
  }
  cfg.watch.debounceMs = Math.min(2000, Math.max(50, Number(cfg.watch.debounceMs) || 200))

  const rawVersion = Number(cfg.cache.thumbVersion)
  cfg.cache.thumbVersion = Number.isFinite(rawVersion) ? Math.max(1, Math.round(rawVersion)) : 1
  // 下限 100MB：配成 0 会让缓存一写就被清空，等于每次都重新解码
  const rawMax = Number(cfg.cache.maxThumbBytes)
  cfg.cache.maxThumbBytes = Number.isFinite(rawMax)
    ? Math.min(64 * 1024 * 1024 * 1024, Math.max(100 * 1024 * 1024, rawMax))
    : DEFAULT_CONFIG.cache.maxThumbBytes
  return cfg
}

export type ConfigListener = (key: string, value: unknown) => void

export class ConfigStore {
  private data: AppConfig
  private listeners = new Set<ConfigListener>()
  private readonly file: string

  constructor(dataDir: string, private readonly log: Logger) {
    this.file = join(dataDir, 'config.json')
    this.data = this.load()
  }

  private load(): AppConfig {
    if (!existsSync(this.file)) {
      this.log.info('config', `首次启动，写入默认配置：${this.file}`)
      const cfg = structuredClone(DEFAULT_CONFIG)
      this.persist(cfg)
      return cfg
    }
    try {
      const raw = readFileSync(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      // 迁移要在 mergeDefaults 之前做：旧键（acrylicOpacity）得先搬走，
      // 否则合并时会被默认值的字段名绕过，留下一个没人读的孤儿键。
      const migrated = isPlainObject(parsed) ? migrate(parsed) : false
      const cfg = sanitize(mergeDefaults(structuredClone(DEFAULT_CONFIG), parsed))
      const merged = migratePluginIds(cfg)
      if (migrated || merged) {
        const backup = join(dirname(this.file), `config.v${CONFIG_VERSION - 1}.bak`)
        try {
          copyFileSync(this.file, backup)
          this.log.info('config', `配置已迁移，原文件备份为 ${backup}`)
        } catch {
          /* 备份失败不该阻塞迁移，最多丢一次回滚机会 */
        }
        this.persist(cfg)
      }
      this.log.info('config', `配置已加载：${this.file}`)
      return cfg
    } catch (err) {
      const backup = join(dirname(this.file), `config.broken-${Date.now()}.json`)
      try {
        copyFileSync(this.file, backup)
      } catch {
        /* 备份失败也要继续 */
      }
      this.log.error('config', `配置文件损坏，已备份到 ${backup} 并重建默认配置：${String(err)}`)
      const cfg = structuredClone(DEFAULT_CONFIG)
      this.persist(cfg)
      return cfg
    }
  }

  private persist(cfg: AppConfig): void {
    const tmp = `${this.file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
      renameSync(tmp, this.file)   // 同分区 rename 是原子的：要么旧配置，要么新配置
    } catch (err) {
      this.log.error('config', `配置写入失败：${String(err)}`)
    }
  }

  all(): AppConfig {
    return this.data
  }

  /** 点分键读取，如 "general.theme" */
  get<T = unknown>(key: string): T {
    let cur: unknown = this.data
    for (const part of key.split('.')) {
      if (!isPlainObject(cur)) return undefined as T
      cur = cur[part]
    }
    return cur as T
  }

  /** 点分键写入 + 落盘 + 广播 */
  set(key: string, value: unknown): void {
    const parts = key.split('.')
    const last = parts.pop()
    if (!last) return
    let cur: Record<string, unknown> = this.data as unknown as Record<string, unknown>
    for (const part of parts) {
      const next = cur[part]
      if (!isPlainObject(next)) {
        cur[part] = {}
      }
      cur = cur[part] as Record<string, unknown>
    }
    cur[last] = value
    sanitize(this.data)
    this.persist(this.data)
    for (const fn of this.listeners) {
      try {
        fn(key, value)
      } catch {
        /* 监听者异常不影响配置 */
      }
    }
  }

  onDidChange(fn: ConfigListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get path(): string {
    return this.file
  }
}
