/**
 * 打开器路径自动探测。
 *
 * 只在常见安装根目录下按 exe 文件名找，不做注册表查询：
 * 免安装 / 绿色版也能命中，且实现简单、可单测。
 * 这里不 import electron，方便直接跑 node 单测。
 */
import { existsSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import type { OpenerKey } from '@shared/types'

/** 每个打开器对应的可执行文件名（大小写不敏感比较） */
const EXE_NAMES: Record<OpenerKey, string> = {
  sai2: 'sai2.exe',
  ps: 'Photoshop.exe',
  csp: 'CLIPStudioPaint.exe'
}

/** 这些目录体积大且与画图软件无关，递归时直接跳过，避免拖慢整次查找 */
const SKIP_DIRS = new Set([
  'node_modules',
  'windows',
  'windowsapps',
  '$recycle.bin',
  'system volume information',
  'recovery',
  'installer'
])

const MAX_DEPTH = 4
/** 遍历目录的硬上限：极端环境（比如把整个 C 盘当根）也不至于卡死 */
const MAX_DIRS = 4000

function normalKey(dir: string): string {
  // 统一小写并去掉末尾分隔符：Windows 路径大小写不敏感，C:\Foo 与 c:\foo\ 视为同一个
  return dir.replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * 常见安装根目录。全部从环境变量派生，不写死盘符/目录名。
 * 返回前过滤掉不存在的目录并去重，避免后续遍历做无用功。
 */
export function candidateRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA,
    env.SystemDrive ? `${env.SystemDrive}\\` : undefined
  ]

  const roots: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item) continue
    const dir = item.trim()
    if (!dir) continue
    const key = normalKey(dir)
    if (seen.has(key)) continue
    // 目录可能不存在（比如 32 位系统没有 Program Files (x86)），静默跳过
    if (!existsSync(dir)) continue
    seen.add(key)
    roots.push(dir)
  }
  return roots
}

export interface DetectOptions {
  /** 最大递归层数，默认 4 */
  maxDepth?: number
  /** 最多访问的目录数，默认 4000 */
  maxDirs?: number
}

/**
 * 在给定根目录下递归查找指定打开器的 exe。
 * 所有 fs 异常（权限不足、目录消失、坏链接）都吞掉，保证调用方拿到数组而不是异常。
 */
export function findInstallCandidates(
  key: OpenerKey,
  roots: string[],
  opts: DetectOptions = {}
): string[] {
  const target = EXE_NAMES[key]?.toLowerCase()
  if (!target) return []

  const maxDepth = opts.maxDepth ?? MAX_DEPTH
  const maxDirs = opts.maxDirs ?? MAX_DIRS

  const hits: string[] = []
  const seenHits = new Set<string>()
  const queue: Array<{ dir: string; depth: number }> = []
  for (const root of roots) {
    if (typeof root === 'string' && root.trim()) queue.push({ dir: root, depth: 0 })
  }

  let visited = 0
  while (queue.length > 0 && visited < maxDirs) {
    const current = queue.shift()
    if (!current) break
    visited++

    let entries: Dirent[]
    try {
      entries = readdirSync(current.dir, { withFileTypes: true })
    } catch {
      // 权限不足 / 目录已删除：跳过这一层，继续找别的
      continue
    }

    for (const entry of entries) {
      // 不跟随符号链接：Windows 的 junction 成环会让递归永远走不完
      if (entry.isSymbolicLink()) continue

      const full = join(current.dir, entry.name)
      if (entry.isFile()) {
        if (entry.name.toLowerCase() !== target) continue
        const dedupe = normalKey(full)
        if (seenHits.has(dedupe)) continue
        seenHits.add(dedupe)
        hits.push(full)
        continue
      }

      if (!entry.isDirectory()) continue
      if (current.depth + 1 > maxDepth) continue
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      queue.push({ dir: full, depth: current.depth + 1 })
    }
  }

  // 路径短的通常更「正统」（非便携版 / 非备份目录），排在前面便于默认选中
  hits.sort((a, b) => a.length - b.length || a.localeCompare(b))
  return hits
}
