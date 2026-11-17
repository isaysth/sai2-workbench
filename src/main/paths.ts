import { app } from 'electron'
import { accessSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 便携路径解析。
 * 规则（需求 §6「便携性」）：数据一律放程序同级目录；目录不可写时整体回退到 %APPDATA%。
 * 开发模式下程序根目录 = 仓库根，数据落在 <repo>/data，方便查看与清理。
 */
export interface AppPaths {
  rootDir: string
  dataDir: string
  logDir: string
  cacheDir: string
  /** 缩略图落盘缓存（sha1 键名，与 sai2img://thumb/ 一一对应） */
  thumbCacheDir: string
  /** 用户导入的背景图存这里，跟配置一起搬迁 */
  backgroundDir: string
  /** 索引库（M2b）：文件身份、标签、项目。跟 data/ 一起搬走 */
  dbFile: string
  /** 用户插件目录（可写）：跟随数据目录，便携时随程序、回退时进 APPDATA */
  pluginDir: string
  /**
   * 内置插件目录（只读）：随程序自带资源走，绝不跟随数据目录回退。
   * 否则程序装在 Program Files 这类不可写位置时，会去 %APPDATA% 找内置插件，必然找不到。
   */
  builtinPluginDir: string
  /** 是否成功使用「程序同级目录」（便携模式） */
  portable: boolean
}

let cached: AppPaths | null = null

/** 真实写一个探针文件来判断可写性，比 accessSync 可靠（Program Files 下经常 AC 通过但写失败）。 */
function isWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.write-probe')
    writeFileSync(probe, 'ok', 'utf8')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

function ensureDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, constants.W_OK)
  } catch {
    /* 创建失败由调用方的可写探测兜底，这里不抛 */
  }
}

export function resolvePaths(): AppPaths {
  if (cached) return cached

  const rootDir = app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()
  const portable = isWritable(join(rootDir, 'data'))
  const base = portable ? rootDir : app.getPath('userData')

  // 内置插件是只读的程序资源：开发态读仓库源码目录；打包态读 asar 外的 resources/builtin-plugins。
  // 关键：它跟 base 无关 —— 数据目录回退到 %APPDATA% 时，内置插件仍在程序自带目录里。
  // 兜底：若 extraResources 因故没复制过来，退回程序同级的 plugins/builtin，保证老布局也能找到。
  const packagedBuiltin = join(process.resourcesPath, 'builtin-plugins')
  const builtinPluginDir = app.isPackaged
    ? existsSync(packagedBuiltin)
      ? packagedBuiltin
      : join(rootDir, 'plugins', 'builtin')
    : join(rootDir, 'resources', 'builtin-plugins')

  const paths: AppPaths = {
    rootDir,
    dataDir: join(base, 'data'),
    logDir: join(base, 'data', 'logs'),
    cacheDir: join(base, 'data', 'cache'),
    thumbCacheDir: join(base, 'data', 'cache', 'thumbs'),
    backgroundDir: join(base, 'data', 'backgrounds'),
    dbFile: join(base, 'data', 'index.db'),
    pluginDir: join(base, 'plugins'),
    builtinPluginDir,
    portable
  }

  ensureDir(paths.dataDir)
  ensureDir(paths.logDir)
  ensureDir(paths.cacheDir)
  ensureDir(paths.thumbCacheDir)
  ensureDir(paths.backgroundDir)
  ensureDir(paths.pluginDir)

  cached = paths
  return paths
}
