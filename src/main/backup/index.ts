/**
 * 用户数据备份 / 恢复。
 *
 * 备份什么（都是"丢了要重打一遍"的东西）：
 *   - `data/config.json`   配置
 *   - `data/index.db`      索引库（文件身份、标签、项目、自动规则快照），连带 -wal / -shm
 *   - `data/backgrounds/`  导入的背景图
 *   - `plugins/`           用户自己装的插件
 * **不备份** `data/cache/thumbs/`（可重建，动辄几百 MB）和 `data/logs/`（排错用，不属于资产）。
 *
 * 恢复策略：先解压到临时目录并逐条校验路径，再「现有数据改名留底 → 落盘」。
 * 留底后缀 `.bak-<时间戳>`，出问题可以手工改名回滚，绝不静默覆盖。
 *
 * 本模块不 import electron：对话框、重启都在 IPC 层，纯文件逻辑在这里，便于单测。
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  type Dirent
} from 'node:fs'
import { dirname, join } from 'node:path'
import yazl from 'yazl'
import { extractZip, readZipText } from '../plugins/zip-extract'

/** 备份格式版本。将来条目结构变了就 +1，旧版程序拒绝读新版备份 */
export const BACKUP_FORMAT = 1
export const MANIFEST_NAME = 'manifest.json'
export const BACKUP_KIND = 'data-backup'

export interface BackupCounts {
  files: number
  tags: number
  projects: number
}

export interface BackupManifest {
  app: string
  kind: typeof BACKUP_KIND
  format: number
  appVersion: string
  createdAt: string
  counts: BackupCounts
  /** 备份里包含的文件条数（不含 manifest 自身） */
  entries: number
}

export interface BackupEntry {
  abs: string
  name: string
}

/**
 * 恢复时允许落盘的条目。白名单写死，避免一个伪装成备份的 zip 往程序目录里塞任意文件。
 * 目录条目（以 / 结尾）与其下文件都按前缀放行。
 */
export function isAllowedBackupEntry(name: string): boolean {
  if (name === MANIFEST_NAME) return true
  if (name === 'data/config.json') return true
  if (name === 'data/index.db' || name === 'data/index.db-wal' || name === 'data/index.db-shm') return true
  if (name.startsWith('data/backgrounds/')) return true
  if (name.startsWith('plugins/')) return true
  return false
}

/** 递归收集目录下的普通文件；符号链接跳过（防止把程序目录外的内容打进包） */
function collect(dir: string, prefix: string, out: BackupEntry[], depth = 0): void {
  if (depth > 8) return
  let items: Dirent[]
  try {
    items = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const item of items) {
    const abs = join(dir, item.name)
    const name = `${prefix}${item.name}`
    if (item.isSymbolicLink()) continue
    if (item.isDirectory()) {
      collect(abs, `${name}/`, out, depth + 1)
      continue
    }
    if (item.isFile()) out.push({ abs, name })
  }
}

/** 备份会包含哪些文件（顺序稳定：配置 → 索引库 → 背景图 → 插件） */
export function planBackupEntries(dataDir: string, pluginDir: string): BackupEntry[] {
  const out: BackupEntry[] = []
  const config = join(dataDir, 'config.json')
  if (existsSync(config)) out.push({ abs: config, name: 'data/config.json' })
  for (const ext of ['', '-wal', '-shm']) {
    const f = join(dataDir, `index.db${ext}`)
    if (existsSync(f)) out.push({ abs: f, name: `data/index.db${ext}` })
  }
  collect(join(dataDir, 'backgrounds'), 'data/backgrounds/', out)
  collect(pluginDir, 'plugins/', out)
  return out
}

export interface CreateBackupOptions {
  zipPath: string
  dataDir: string
  pluginDir: string
  appVersion: string
  counts: BackupCounts
  now?: Date
}

/**
 * 打一个备份 zip。调用方需保证此刻没有写库动作（本函数的调用点在设置页，索引写入是异步的，
 * 极端情况下 index.db 可能差一条记录 —— 恢复后重扫能补齐，不影响标签/项目这类元数据）。
 */
export async function createBackup(options: CreateBackupOptions): Promise<BackupManifest & { bytes: number }> {
  const now = options.now ?? new Date()
  const entries = planBackupEntries(options.dataDir, options.pluginDir)
  const manifest: BackupManifest = {
    app: 'sai2-workbench',
    kind: BACKUP_KIND,
    format: BACKUP_FORMAT,
    appVersion: options.appVersion,
    createdAt: now.toISOString(),
    counts: options.counts,
    entries: entries.length
  }

  mkdirSync(dirname(options.zipPath), { recursive: true })

  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), MANIFEST_NAME)
  for (const entry of entries) zip.addFile(entry.abs, entry.name)
  zip.end()

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(options.zipPath)
    let settled = false
    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      try {
        out.destroy()
      } catch {
        /* 已经关了就算了 */
      }
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    out.on('error', fail)
    out.on('close', () => {
      if (settled) return
      settled = true
      resolve()
    })
    zip.outputStream.on('error', fail)
    zip.outputStream.pipe(out)
  })

  return { ...manifest, bytes: statSync(options.zipPath).size }
}

export type ManifestResult =
  | { ok: true; value: BackupManifest }
  | { ok: false; error: string }

/** 读并校验备份包里的 manifest，先挡掉「不是备份」「新版本备份」两类误操作 */
export async function readBackupManifest(zipPath: string): Promise<ManifestResult> {
  let raw: string | null
  try {
    raw = await readZipText(zipPath, MANIFEST_NAME)
  } catch (err) {
    return { ok: false, error: `打不开这个 zip：${err instanceof Error ? err.message : String(err)}` }
  }
  if (!raw) return { ok: false, error: '这不是 sai2工作台 的数据备份（缺少 manifest.json）' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: '备份内的 manifest.json 已损坏' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: '备份内的 manifest.json 格式不对' }

  const value = parsed as Partial<BackupManifest>
  if (value.kind !== BACKUP_KIND) return { ok: false, error: '这不是 sai2工作台 的数据备份' }
  if (typeof value.format !== 'number') return { ok: false, error: '备份格式版本缺失' }
  if (value.format > BACKUP_FORMAT) {
    return { ok: false, error: `备份来自更新的版本（格式 ${value.format}），请先升级程序再恢复` }
  }

  const counts = value.counts
  return {
    ok: true,
    value: {
      app: typeof value.app === 'string' ? value.app : 'sai2-workbench',
      kind: BACKUP_KIND,
      format: value.format,
      appVersion: typeof value.appVersion === 'string' ? value.appVersion : '未知',
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      counts: {
        files: Number(counts?.files ?? 0) || 0,
        tags: Number(counts?.tags ?? 0) || 0,
        projects: Number(counts?.projects ?? 0) || 0
      },
      entries: Number(value.entries ?? 0) || 0
    }
  }
}

export interface RestoreBackupOptions {
  zipPath: string
  dataDir: string
  pluginDir: string
  /** 时间戳后缀，如 20261118-095500；用于临时目录与 .bak 命名 */
  stamp: string
}

export interface RestoreBackupResult {
  restored: number
  asideSuffix: string
  /** 留底后的实际路径，给日志和提示用 */
  aside: string[]
}

/**
 * 恢复备份。**调用前必须已经关库、停监听**，否则 Windows 上 index.db 还被占用，改名会失败。
 */
export async function restoreBackup(options: RestoreBackupOptions): Promise<RestoreBackupResult> {
  const base = dirname(options.dataDir)
  const temp = join(base, `.restore-${options.stamp}`)
  rmSync(temp, { recursive: true, force: true })
  mkdirSync(temp, { recursive: true })

  try {
    await extractZip(options.zipPath, temp, { allow: isAllowedBackupEntry })

    const suffix = `.bak-${options.stamp}`
    const aside: string[] = []
    const moveAside = (target: string): void => {
      if (!existsSync(target)) return
      const dest = `${target}${suffix}`
      rmSync(dest, { recursive: true, force: true })
      renameSync(target, dest)
      aside.push(dest)
    }

    // 1) 现有数据改名留底（不出问题也可留着手工比对）
    moveAside(join(options.dataDir, 'config.json'))
    for (const ext of ['', '-wal', '-shm']) moveAside(join(options.dataDir, `index.db${ext}`))
    moveAside(join(options.dataDir, 'backgrounds'))
    moveAside(join(base, 'plugins'))

    // 2) 备份内容落盘（同一磁盘内 rename，比 copy 快且不占双份空间）
    let restored = 0
    const put = (from: string, to: string): void => {
      if (!existsSync(from)) return
      mkdirSync(dirname(to), { recursive: true })
      rmSync(to, { recursive: true, force: true })
      renameSync(from, to)
      restored += 1
    }
    put(join(temp, 'data', 'config.json'), join(options.dataDir, 'config.json'))
    for (const ext of ['', '-wal', '-shm']) {
      put(join(temp, `data/index.db${ext}`), join(options.dataDir, `index.db${ext}`))
    }
    put(join(temp, 'data', 'backgrounds'), join(options.dataDir, 'backgrounds'))
    put(join(temp, 'plugins'), join(base, 'plugins'))

    // 备份里没有插件 / 背景图时，目录得补回来，否则插件底座会找不到目录
    mkdirSync(join(base, 'plugins'), { recursive: true })
    mkdirSync(join(options.dataDir, 'backgrounds'), { recursive: true })

    return { restored, asideSuffix: suffix, aside }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
