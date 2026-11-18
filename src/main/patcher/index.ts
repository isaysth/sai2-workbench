/**
 * 增量升级包：解析、白名单、校验清单与应用脚本生成。
 *
 * 这里是纯逻辑，不 import electron、不碰文件系统 —— 解压、哈希、重启都在 IPC 层，
 * 这样包格式的判定规则能直接单测，不用起 Electron。
 *
 * 包的形状由 `scripts/ship.mjs` 约定：
 *   sai2工作台-<x.y.z>-增量升级包/
 *     resources/app.asar
 *     resources/builtin-plugins/**
 *     SHA256SUMS.txt        （每行 `<sha256> *<相对顶层目录的路径>`）
 *     升级说明.md
 *     清理旧插件.bat
 */
import { safeZipName } from '../plugins/zip-extract'

export interface PatchInfo {
  /** 包内唯一顶层目录，如 sai2工作台-0.3.1-增量升级包 */
  topDir: string
  /** 从顶层目录名里取出的三段式版本号 */
  version: string
  /** 原始条目名（保留给调用方做白名单遍历） */
  entries: string[]
}

const TOP_DIR_RE = /^sai2工作台-(\d+\.\d+\.\d+)-增量升级包$/

/** 取条目名的第一段（兼容 / 与 \；目录条目末尾带斜杠也照此取） */
function topSegment(name: string): string {
  const i = name.search(/[\\/]/)
  return i === -1 ? name : name.slice(0, i)
}

function normalize(name: string): string {
  return name.replace(/\\/g, '/')
}

/**
 * 从 zip 条目名列表解析补丁包信息。
 * 不合规直接抛错（消息给用户看，必须能看懂错在哪）。
 */
export function parsePatchInfo(entryNames: string[]): PatchInfo {
  if (entryNames.length === 0) throw new Error('升级包是空的')

  const tops = new Set<string>()
  for (const name of entryNames) {
    if (!name) throw new Error('升级包里有未命名的条目')
    if (!safeZipName(name)) throw new Error(`升级包内存在不安全的路径：${name}`)
    tops.add(topSegment(name))
  }

  if (tops.size > 1) {
    throw new Error(`升级包内出现了多个顶层目录：${[...tops].join('、')}`)
  }
  const topDir = [...tops][0]!
  const m = TOP_DIR_RE.exec(topDir)
  if (!m) {
    throw new Error(`这不是 sai2工作台 的增量升级包（顶层目录是「${topDir}」）`)
  }
  return { topDir, version: m[1]!, entries: entryNames }
}

/**
 * 允许落到程序目录的条目：只认 `<topDir>/resources/app.asar`
 * 与 `<topDir>/resources/builtin-plugins/**`（含这两级目录自身的目录条目）。
 * 之外的（data/、plugins/、bat 等）一律拒绝，整包不解。
 */
export function isAllowedPatchEntry(name: string, topDir: string): boolean {
  if (!name || !safeZipName(name)) return false
  const norm = normalize(name)
  const prefix = `${normalize(topDir)}/`
  if (!norm.startsWith(prefix)) return false

  // 去掉末尾斜杠，目录条目与文件条目用同一套判断
  const rel = norm.slice(prefix.length).replace(/\/+$/, '')
  if (!rel) return true // 顶层目录自身
  if (rel === 'resources') return true // 目录条目
  if (rel === 'resources/app.asar') return true
  if (rel === 'resources/builtin-plugins') return true
  return rel.startsWith('resources/builtin-plugins/')
}

/**
 * 允许出现在包里、但**不会解压落地**的元数据条目。
 * ship.mjs 固定产出这三个（校验清单 / 升级说明 / 清理旧插件的 bat），
 * 它们只给人看或给下次收尾用，绝不进程序目录 —— 所以跟落盘白名单分开判。
 */
const PATCH_META = new Set(['SHA256SUMS.txt', '升级说明.md', '清理旧插件.bat'])

export function isPatchMetaEntry(name: string, topDir: string): boolean {
  if (!name || !safeZipName(name)) return false
  const norm = normalize(name)
  const prefix = `${normalize(topDir)}/`
  if (!norm.startsWith(prefix)) return false
  return PATCH_META.has(norm.slice(prefix.length))
}

export interface ChecksumEntry {
  /** 相对顶层目录的路径，统一用 / */
  path: string
  sha256: string
}

/**
 * 解析 SHA256SUMS.txt。
 * 正式格式是 `<sha256> *<路径>`（GNU sha256sum 的二进制标记），
 * 也兼容两个空格分隔的写法；空行与 # 注释跳过。
 */
export function parseChecksums(text: string): ChecksumEntry[] {
  const out: ChecksumEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line)
    if (!m) throw new Error(`校验清单格式不对：${line.slice(0, 80)}`)
    const path = normalize(m[2]!.trim())
    if (!path || !safeZipName(path)) throw new Error(`校验清单里有不安全的路径：${path}`)
    out.push({ path, sha256: m[1]!.toLowerCase() })
  }
  if (out.length === 0) throw new Error('校验清单是空的')
  return out
}

/** 三段式版本比较：a>b 返回正数，相等返回 0 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export interface ApplyScriptOptions {
  /** 主进程 pid。参数名不能叫 $pid —— PowerShell 的只读自动变量，会直接报错 */
  targetPid: number
  /** 本次升级的临时目录（含 payload / backup / apply.log） */
  patchDir: string
  /** 程序根目录（含 resources 的那一层） */
  targetDir: string
  /** 重启时要拉起的 exe */
  exePath: string
  /** 本次升级的时间戳，用于 app.asar.bak-<stamp> */
  stamp: string
}

/**
 * 生成 apply.ps1。
 *
 * 设计要点：
 *   - 参数全部通过命令行传，脚本里不写死任何路径（也不会有本机绝对路径）；
 *   - 先等主进程退出再动文件（运行中的进程持有 app.asar 句柄）；
 *   - 覆盖前把 app.asar / builtin-plugins 复制到 backup\，失败时原样还原；
 *   - 成功写 apply.log=ok，失败写 failed: 原因，两种情况都尽量把程序拉起来；
 *   - 临时目录不删，留给下次启动收尾（失败时是证据）。
 *
 * 调用方必须把返回的文本写成 **UTF-8 带 BOM**，否则 PS 5.1 会把中文路径读成乱码。
 */
export function buildApplyScript(o: ApplyScriptOptions): string {
  const lines = [
    'param(',
    '  [Parameter(Mandatory=$true)][int]$targetPid,',
    '  [Parameter(Mandatory=$true)][string]$patchDir,',
    '  [Parameter(Mandatory=$true)][string]$targetDir,',
    '  [Parameter(Mandatory=$true)][string]$exePath,',
    '  [Parameter(Mandatory=$true)][string]$stamp',
    ')',
    `# sai2工作台 增量替换脚本（生成于 ${o.stamp}）`,
    "$ErrorActionPreference = 'Stop'",
    '',
    "$logPath = Join-Path $patchDir 'apply.log'",
    "$resDir = Join-Path $targetDir 'resources'",
    "$backupDir = Join-Path $patchDir 'backup'",
    "$bakAsar = Join-Path $resDir ('app.asar.bak-' + $stamp)",
    '$exited = $false',
    'try {',
    '  # 1) 等主进程真的退出，最多等 60 秒',
    '  $waited = 0',
    '  while (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) {',
    '    if ($waited -ge 200) { throw "等待旧进程退出超时" }',
    '    Start-Sleep -Milliseconds 300',
    '    $waited = $waited + 1',
    '  }',
    '  Start-Sleep -Milliseconds 500',
    '  $exited = $true',
    '',
    '  # 2) 留底：app.asar 与 builtin-plugins 都复制一份到 patchDir\\backup',
    '  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null',
    "  $curAsar = Join-Path $resDir 'app.asar'",
    "  $curBuiltin = Join-Path $resDir 'builtin-plugins'",
    '  if (Test-Path -LiteralPath $curAsar) {',
    "    Copy-Item -LiteralPath $curAsar -Destination (Join-Path $backupDir 'app.asar') -Force",
    '  }',
    '  if (Test-Path -LiteralPath $curBuiltin) {',
    "    Copy-Item -LiteralPath $curBuiltin -Destination (Join-Path $backupDir 'builtin-plugins') -Recurse -Force",
    '  }',
    '  # 界面里承诺「旧版本留一份 app.asar.bak-时间」',
    '  if ((Test-Path -LiteralPath $curAsar) -and -not (Test-Path -LiteralPath $bakAsar)) {',
    '    Copy-Item -LiteralPath $curAsar -Destination $bakAsar -Force',
    '  }',
    '',
    '  # 3) 覆盖 resources（payload 里只有 app.asar 与 builtin-plugins）',
    "  Copy-Item -Path (Join-Path $patchDir 'payload\\resources\\*') -Destination $resDir -Recurse -Force",
    "  Set-Content -LiteralPath $logPath -Value 'ok' -Encoding UTF8",
    '} catch {',
    '  $msg = $_.Exception.Message',
    '  # 4) 用 backup 里的副本还原，失败也必须把原因写进 apply.log',
    '  try {',
    "    $srcAsar = Join-Path $backupDir 'app.asar'",
    '    if (-not (Test-Path -LiteralPath $srcAsar)) { $srcAsar = $bakAsar }',
    '    if (Test-Path -LiteralPath $srcAsar) {',
    "      Copy-Item -LiteralPath $srcAsar -Destination (Join-Path $resDir 'app.asar') -Force",
    '    }',
    "    $srcBuiltin = Join-Path $backupDir 'builtin-plugins'",
    '    if (Test-Path -LiteralPath $srcBuiltin) {',
    "      Copy-Item -LiteralPath $srcBuiltin -Destination (Join-Path $resDir 'builtin-plugins') -Recurse -Force",
    '    }',
    '  } catch { }',
    "  Set-Content -LiteralPath $logPath -Value ('failed: ' + $msg) -Encoding UTF8",
    '}',
    '',
    '# 5) 失败也把程序拉起来：还原过就是旧版，用户至少还能用',
    'if ($exited -and (Test-Path -LiteralPath $exePath)) {',
    '  Start-Process -FilePath $exePath -WorkingDirectory $targetDir',
    '}'
  ]
  return lines.join('\r\n')
}
