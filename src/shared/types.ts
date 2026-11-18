/**
 * 主进程与渲染进程共用的类型。
 * 这里只放「跨进程边界」的数据结构，不放任何实现。
 */

/**
 * 外观体系拆成三个正交维度（需求 v1.14）：
 *   风格 × 明暗 × 背景 = 玻璃/简约 × 浅/深 × 纯色/图片/全透明
 * 旧版是 acrylic / light / dark 三个平级主题，把「风格」和「配色」混在了一起，
 * 导致「深色玻璃」这种组合根本表达不出来。
 */

/** 外观风格。glass = 玻璃（可调不透明度与模糊），minimal = 简约（实色、不透明） */
export type ThemeName = 'glass' | 'minimal'

/** 明暗配色。两种风格都支持 */
export type ColorScheme = 'light' | 'dark'

/**
 * 背景来源。solid = 纯色（跟随明暗），image = 自定义图片，
 * desktop = 全透明（窗口真的透过去看穿到桌面，所以界面上叫「全透明」而不是「桌面」——
 * 用户要的是"透"，不是"桌面"这个概念）
 */
export type BackgroundMode = 'solid' | 'image' | 'desktop'

/**
 * 目录扫描方式（需求 v1.21）：
 *   startup  = 只在启动时扫一次，之后完全不占句柄，靠文件页「刷新」手动更新（默认）
 *   realtime = 常驻 chokidar 监听，丢文件 2 秒内自动出卡片（M2a 原行为，改为可选）
 * 保留实时模式是为了让「边画边看」的用户自己开，而不是替所有人常驻一个监听器。
 */
export type WatchMode = 'startup' | 'realtime'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 一条日志。渲染端日志页直接渲染这个结构。 */
export interface LogEntry {
  time: number
  level: LogLevel
  scope: string
  message: string
}

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/**
 * 缩略图状态。
 *   pending = 还没生成（渲染端先画占位轮廓）
 *   ready   = 已落盘，`key` 可直接拼 sai2img://thumb/<key>
 *   fail    = 解不出来（损坏 / 加密 / 小画布 SAI2），走信息卡
 */
export type ThumbState = 'pending' | 'ready' | 'fail'

/** 标签（需求 F5）。名字在库里唯一，颜色可选（缺省用主题色） */
export interface Tag {
  id: number
  name: string
  color?: string
}

/**
 * 项目（需求 F21）。建模取「一个项目 = 名字 + 可选客户」：
 * 客户不是独立维度，只从项目表里 distinct 出来做筛选，所以筛选条只多一个下拉。
 */
export interface Project {
  id: number
  name: string
  client: string
  color?: string
}

/** 自动标签规则：目录前缀 → 标签。新文件入库时按最长前缀匹配套用 */
export interface AutoTagRule {
  prefix: string
  tagId: number
  tagName: string
}

/** 标签 / 项目变更推送。渲染端只更新对应卡片，不重排瀑布流 */
export interface FileMetaEvent {
  path: string
  tags: Tag[]
  projectId: number | null
  project: Project | null
}

/** 工程文件索引条目。path 在内存 Map 里是键，库里由 (dev,ino) 认身份。 */
export interface ProjectFile {
  path: string
  name: string
  ext: string
  dir: string
  size: number
  mtimeMs: number
  canvas?: { width: number; height: number }
  /** 文件身份（NTFS 的 dev + ino，bigint 转字符串）。取不到时为空，退回按 path 认 */
  dev?: string
  ino?: string
  /** 数据库自增主键。标签挂在这上面 —— 改名后沿用旧 id 才能不丢标签 */
  fileId?: number
  tags?: Tag[]
  projectId?: number | null
  project?: Project | null
  /**
   * 缩略图键。扫描时就算好（sha1 只吃短字符串，微秒级），
   * 这样渲染端拿到列表就能直接拼 `<img src>`，不用为每张卡片再问一次主进程。
   */
  thumbKey?: string
  /** cover=true 表示这张预览是用同目录同名图片兜的（卡片挂「封面」角标） */
  thumb?: { state: ThumbState; reason?: string; cover?: boolean }
}

/**
 * 索引变更批次。渲染端按 path 合并，不做整体替换 ——
 * 否则滚到第 800 条时删掉第 3 条，列表会整体重建、滚动位置丢失。
 */
export interface FileChangeEvent {
  adds?: ProjectFile[]
  removes?: string[]
  /** true = 清空重排（开始新一轮全量扫描时） */
  reset?: boolean
}

/** 扫描进度。5 万文件的目录首扫要几十秒，没有进度条用户会以为卡死。 */
export interface IndexProgress {
  scanning: boolean
  /** 已扫到的条目数 */
  scanned: number
  /** 已遍历的目录数 */
  dirs: number
  /** 当前正在扫的目录（尾部截断，只用于显示） */
  current: string
}

/** 缩略图缓存统计，设置页展示与清理用。 */
export interface ThumbCacheStats {
  bytes: number
  files: number
  /** 其中失败标记的数量 */
  failures: number
  maxBytes: number
}

/** 三个内置打开器的配置键 */
export type OpenerKey = 'sai2' | 'ps' | 'csp'

/** 打开器配置：三个内置插件各一格。 */
export interface OpenerConfig {
  path: string
  args: string
}

/** 打开器的渲染端视图（不含函数，可跨 IPC 序列化） */
export interface OpenerView {
  id: string
  label: string
  /** 对应 config.openers 下的字段名，如 'sai2' */
  configKey: string
  exts: string[]
  path: string
  ready: boolean
  current: boolean
}

export interface AppConfig {
  version: number
  general: {
    /** 外观风格：玻璃 / 简约 */
    theme: ThemeName
    /** 明暗：浅色 / 深色 */
    scheme: ColorScheme
    /** 背景来源：纯色 / 图片 / 全透明（看穿窗口） */
    background: BackgroundMode
    /** 背景图文件名（相对 data/backgrounds/），空串表示没选 */
    backgroundImage: string
    /** 玻璃面板的不透明度 0~0.95，仅 glass 风格生效（0 = 完全透明，只剩文字与描边） */
    glassOpacity: number
    /** 玻璃模糊半径（px），0~40，独立于不透明度 */
    glassBlur: number
    /**
     * 背景清晰度 0~1，仅 minimal 风格 + 图片/全透明背景生效（0 = 背景几乎看不见，1 = 面板全透）。
     * 玻璃风格用 glassOpacity 表达同一件事，不需要第二个滑块。
     */
    bgClarity: number
    thumbnailSize: number
    cardSize: 'sm' | 'md' | 'lg'
  }
  watch: {
    dirs: string[]
    /** 扫描方式：默认仅启动时扫描 + 手动刷新；可切回实时监听 */
    mode: WatchMode
    recursive: boolean
    extensions: string[]
    debounceMs: number
  }
  openers: {
    sai2: OpenerConfig
    ps: OpenerConfig
    csp: OpenerConfig
    /** 当前默认打开器 id，如 "opener-sai2" */
    default: string
  }
  ui: {
    splitterLeft: number
    splitterRight: number
    windowBounds: WindowBounds | null
    /** 悬浮球上次停留的位置（屏幕坐标，左上角）。越界时恢复会复位到右上角 */
    ballPosition?: BallPosition | null
    /** 悬浮球皮肤：'orange'（内置橙子切片）或用户皮肤目录的绝对路径 */
    ballSkin?: string
  }
  plugins: {
    disabled: string[]
    config: Record<string, unknown>
  }
  cache: {
    /**
     * 缩略图缓存版本。改动解码逻辑（比如修了 jssf 的颜色）后 +1，
     * 会让所有旧缓存键失效 —— 否则用户看到的还是老图，以为是没修好。
     */
    thumbVersion: number
    /** 缩略图缓存上限（字节），超了按 mtime 淘汰最旧的 10% */
    maxThumbBytes: number
  }
}

/** 运行环境信息，启动时给渲染端一次。 */
export interface RuntimeInfo {
  dataDir: string
  pluginDir: string
  /** 内置插件的只读目录（打包后随程序走，不随数据回退） */
  builtinPluginDir: string
  portable: boolean
  version: string
  platform: string
  /** Windows build 号，用于判断是否支持系统毛玻璃 */
  windowsBuild: number
  /** 系统是否具备 DWM 毛玻璃能力。当前渲染不依赖它（玻璃全自绘），
      保留是因为 M3 若引入 FFI 真背景模糊需要区分 Win10/Win11 */
  acrylicSupported: boolean
  isDev: boolean
}

/** 窗口控制动作（自定义标题栏 / 悬浮条需要）。 */
export type WindowAction =
  | 'minimize'
  | 'toggle-maximize'
  | 'close'
  /** 切换悬浮窗（小窗 ↔ 正常窗口） */
  | 'toggle-float'
  /** 收进托盘（隐藏窗口但保持进程） */
  | 'tray'
  /** 从托盘菜单 / 悬浮条显式退出 */
  | 'quit'

/** 悬浮窗的配置与状态（插件配置驱动，主进程 → 渲染端） */
export interface FloatModeState {
  active: boolean
  width: number
  height: number
}

/** 悬浮球位置（屏幕坐标，球窗口左上角） */
export interface BallPosition {
  x: number
  y: number
}

/**
 * 悬浮球皮肤。svg 与 image 二选一：
 * - svg   = 内置皮肤直接给整段 SVG 字符串（页面 innerHTML 注入）
 * - image = 用户皮肤给 dataURI（nativeImage 读盘转码，运行时读，不进 asar）
 */
export interface BallSkin {
  svg?: string
  image?: string
  /** 球直径（px），窗口与页面同时按它排版 */
  size: number
}

/** 导出数据备份的结果（设置页「备份数据」按钮） */
export interface DataBackupResult {
  ok: boolean
  /** 用户在另存对话框里取消 */
  canceled?: boolean
  error?: string
  /** 生成的文件绝对路径 */
  file?: string
  bytes?: number
  /** 包内文件条数 */
  entries?: number
}

/** 恢复数据备份的结果（设置页「从备份恢复」按钮） */
export interface DataRestoreResult {
  ok: boolean
  canceled?: boolean
  error?: string
  /** 落盘成功的条目数 */
  restored?: number
  /** 旧数据的留底后缀，如 .bak-20261118-095500 */
  asideSuffix?: string
  /** 恢复成功后程序会自动重启 */
  restarting?: boolean
}

/**
 * 应用增量升级包的结果（设置页「选择升级包并更新」）。
 * ok=true 表示已写好替换脚本，程序即将退出重启；真正搬文件发生在进程退出之后。
 */
export interface UpdateApplyResult {
  ok: boolean
  /** 用户在选文件对话框里取消 */
  canceled?: boolean
  /** 拒绝原因（中文，直接 toast 给用户看） */
  error?: string
  /** 升级前版本 */
  from?: string
  /** 升级包里的版本 */
  to?: string
}
