/**
 * 插件目录里「用户丢进来的 zip」发现与安全校验。
 *
 * 纯函数，不依赖 electron / fs 监听，便于单测。
 * 真正的解压与安装仍走 ipc/plugins.ipc.ts 的 installChecked，这里只负责：
 *   1. 从目录里挑出候选 zip（只看一层、跳过隐藏文件）
 *   2. 过滤掉已安装的、本次已忽略的、重复的
 *   3. 校验一个 zip 路径是否合法（必须在 pluginDir 下、.zip 后缀、体积上限）
 */
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'

/** 单包上限 200MB，避免误把整个素材盘压缩后丢进来卡死解压 */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024

const HIDDEN_PREFIX = '.'

/** 候选包：绝对路径 + 文件名 */
export interface ZipCandidate {
  path: string
  name: string
}

/**
 * 扫描插件目录根层的 zip。只读一层、跳过隐藏文件与目录。
 * 读不了 / 不存在的目录返回空数组，不抛异常（发现机制不能让主程序崩）。
 */
export function scanZipDir(pluginDir: string): ZipCandidate[] {
  let entries: Dirent[]
  try {
    if (!existsSync(pluginDir)) return []
    entries = readdirSync(pluginDir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: ZipCandidate[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name.startsWith(HIDDEN_PREFIX)) continue
    if (extname(entry.name).toLowerCase() !== '.zip') continue
    out.push({ path: join(pluginDir, entry.name), name: entry.name })
  }
  return out
}

/**
 * 判断 zip 路径是否允许安装：
 *   - 必须是 .zip
 *   - 必须落在 pluginDir 目录内（用 resolve + sep 前缀，挡住 ../ 与绝对路径伪装）
 *   - 文件存在、体积不超上限
 * 返回人话错误；合法时返回 null。
 */
export function validateZipPath(zipPath: string, pluginDir: string): string | null {
  if (typeof zipPath !== 'string' || !zipPath) return 'zip 路径为空'
  if (extname(zipPath).toLowerCase() !== '.zip') return '不是 zip 文件'
  const root = resolve(pluginDir)
  const target = resolve(zipPath)
  // 前缀判断必须带分隔符，否则 pluginDir=.../plugins 时 .../plugins-evil/x.zip 会被误放行
  if (target !== root && !target.startsWith(root + sep)) return 'zip 必须放在插件目录内'
  if (!existsSync(target)) return 'zip 文件不存在'
  try {
    const size = statSync(target).size
    if (size > MAX_ZIP_BYTES) return `zip 超过 ${MAX_ZIP_BYTES / 1024 / 1024}MB 上限`
  } catch (err) {
    return `读取 zip 失败：${err instanceof Error ? err.message : String(err)}`
  }
  return null
}

/**
 * 从候选里挑出值得提示安装的 zip。
 * @param candidates 目录扫描结果
 * @param installedIds 已安装插件 id 集合（zip 文件名去掉 .zip 与 id 相同即视为已安装）
 * @param seenPaths 本次会话已提示过 / 用户点过「暂不安装」的 zip 绝对路径集合（两者都不再提示）
 */
export function pickPromptableZips(
  candidates: ZipCandidate[],
  installedIds: Set<string>,
  seenPaths: Set<string>
): ZipCandidate[] {
  const picked: ZipCandidate[] = []
  const names = new Set<string>()
  for (const c of candidates) {
    if (seenPaths.has(c.path)) continue
    // 已安装插件同 id 的 zip 不再提示：按「文件名(去 .zip) == 插件 id」判断
    const stem = basename(c.name, extname(c.name))
    if (installedIds.has(stem)) continue
    if (names.has(stem)) continue
    names.add(stem)
    picked.push(c)
  }
  return picked
}
