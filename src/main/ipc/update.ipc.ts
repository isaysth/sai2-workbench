/**
 * 增量升级包的 IPC。
 *
 * 本文件只管「跟用户对话 + 编排」：选 zip、校验、解到旁边、写脚本、退出，
 * 包格式判定在 `main/patcher`（纯逻辑，可单测），解包在 `main/plugins/zip-extract`。
 *
 * 为什么不在进程内替换文件：`resources/app.asar` 被运行中的进程持有句柄，
 * Windows 上连 unlink 都会失败。所以只能「解到 .patch-<stamp> → 退出 →
 * 独立 PowerShell 脚本搬文件 → 拉起新版本」，下次启动再清理临时目录。
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import yauzl from 'yauzl'
import { CH } from '@shared/channels'
import type { UpdateApplyResult } from '@shared/types'
import {
  buildApplyScript,
  compareVersions,
  isAllowedPatchEntry,
  isPatchMetaEntry,
  parseChecksums,
  parsePatchInfo,
  type ChecksumEntry
} from '../patcher'
import { extractZip, readZipText } from '../plugins/zip-extract'
import type { Logger } from '../logger'
import type { AppPaths } from '../paths'

export interface UpdateIpcDeps {
  paths: AppPaths
  log: Logger
  /** 当前版本，直接来自 app.getVersion() */
  version: string
  /** 关库 + 停监听（D-014 抽出来的唯一实现），退出前必须调用 */
  shutdown: () => Promise<void>
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 20261118-095500 */
function stamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}${pad(date.getSeconds())}`
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/** 真写一个探针文件判断可写，跟 paths.ts 的做法一致（Program Files 下 AC 经常骗人） */
function isWritable(dir: string): boolean {
  const probe = join(dir, '.update-write-probe')
  try {
    writeFileSync(probe, 'ok', 'utf8')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/** 只列条目名，不解压 */
function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error('无法打开 zip 文件'))
        return
      }
      const names: string[] = []
      let done = false
      const finish = (failure?: Error): void => {
        if (done) return
        done = true
        zipFile.close()
        if (failure) reject(failure)
        else resolve(names)
      }
      zipFile.on('error', (e) => finish(e))
      zipFile.on('end', () => finish())
      zipFile.readEntry()
      zipFile.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName)
        zipFile.readEntry()
      })
    })
  })
}

/** 递归列出目录下所有文件，返回相对 dir 的路径（统一 /） */
function walkFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isDirectory()) out.push(...walkFiles(join(dir, item.name), rel))
    else if (item.isFile()) out.push(rel)
  }
  return out
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * 逐个比对解出来的文件与清单。
 * 以「解出来的文件」为准遍历：清单里多出来的（升级说明.md 之类没解压的）不参与，
 * 少一项则直接判损坏。
 */
function verifyPayload(payloadRoot: string, checksums: ChecksumEntry[]): void {
  const want = new Map(checksums.map((c) => [c.path, c.sha256]))
  const files = walkFiles(payloadRoot)
  if (files.length === 0) throw new Error('升级包里没有可替换的文件')
  for (const rel of files) {
    const expected = want.get(rel)
    if (!expected) throw new Error(`升级包已损坏或被改动（清单里没有 ${rel}）`)
    const actual = sha256File(join(payloadRoot, rel))
    if (actual !== expected) throw new Error(`升级包已损坏或被改动（${rel} 校验不符）`)
  }
}

export function registerUpdateIpc(deps: UpdateIpcDeps): void {
  const { paths, log, version, shutdown } = deps
  let inFlight = false

  ipcMain.handle(CH.updateApply, async (): Promise<UpdateApplyResult> => {
    if (!app.isPackaged) {
      return { ok: false, error: '开发模式下不支持应用升级包，请用打包后的正式版' }
    }
    if (inFlight) return { ok: false, error: '已经有一个升级包在处理了，请稍候' }
    inFlight = true

    const win = focusedWindow()
    const options = {
      title: '选择增量升级包',
      buttonLabel: '选择',
      properties: ['openFile' as const],
      filters: [{ name: '增量升级包', extensions: ['zip'] }]
    }
    let patchDir: string | null = null

    try {
      const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }
      const zipPath = picked.filePaths[0]!

      // 闸 1：顶层目录决定版本，格式不对直接挡掉
      const entries = await listZipEntries(zipPath)
      const info = parsePatchInfo(entries)

      // 闸 2：版本必须比当前新
      if (compareVersions(info.version, version) <= 0) {
        return {
          ok: false,
          error: `这个升级包是 ${info.version}，当前已经是 ${version}，不需要升级`
        }
      }

      // 闸 3：白名单外的条目整包拒绝，一个文件都不解
      // 校验清单 / 升级说明 / 清理 bat 是包里该有的元数据，但不会落地（见 isPatchMetaEntry）
      const bad = entries.find(
        (name) => !isAllowedPatchEntry(name, info.topDir) && !isPatchMetaEntry(name, info.topDir)
      )
      if (bad) {
        return { ok: false, error: `升级包里夹带了不该有的文件：${bad}（已整包拒绝）` }
      }

      // 闸 4：程序目录必须可写，否则只能走整包
      if (!isWritable(paths.rootDir)) {
        return { ok: false, error: '程序目录不可写，请用整包升级（把程序装到可写的位置再试）' }
      }

      // 闸 5：必须有校验清单，且清单本身能解析
      const sumsText = await readZipText(zipPath, `${info.topDir}/SHA256SUMS.txt`)
      if (!sumsText) return { ok: false, error: '升级包已损坏或被改动（缺少 SHA256SUMS.txt）' }
      const checksums = parseChecksums(sumsText)

      // 通过校验后才在程序目录旁边建临时目录，任何失败都整删，不留半成品
      const thisStamp = stamp()
      patchDir = join(paths.rootDir, `.patch-${thisStamp}`)
      rmSync(patchDir, { recursive: true, force: true })
      mkdirSync(patchDir, { recursive: true })

      const payloadDir = join(patchDir, 'payload')
      // 元数据（说明 / 校验清单 / bat）允许解出来，但随后会跟顶层目录一起删掉，不会进程序目录
      await extractZip(zipPath, payloadDir, {
        allow: (name) =>
          isAllowedPatchEntry(name, info.topDir) || isPatchMetaEntry(name, info.topDir)
      })

      const payloadRoot = join(payloadDir, info.topDir)
      verifyPayload(payloadRoot, checksums)
      if (!existsSync(join(payloadRoot, 'resources', 'app.asar'))) {
        throw new Error('升级包里缺少 resources/app.asar（只有内置插件不算升级）')
      }

      // 把顶层目录削掉，脚本里固定用 payload\resources\*，不依赖顶层目录名
      renameSync(join(payloadRoot, 'resources'), join(payloadDir, 'resources'))
      rmSync(payloadRoot, { recursive: true, force: true })

      // 备份：builtin-plugins 没被占用，直接复制到 patchDir\backup，脚本失败时用它还原。
      // 注意顺序：所有可能抛错的动作都放在「动程序目录」之前，失败时只删临时目录，程序目录原封不动。
      const asarPath = join(paths.rootDir, 'resources', 'app.asar')
      if (!existsSync(asarPath)) {
        throw new Error('程序目录里没有 resources/app.asar，这不像正式版')
      }
      const builtinDir = join(paths.rootDir, 'resources', 'builtin-plugins')
      if (existsSync(builtinDir)) {
        const backupDir = join(patchDir, 'backup')
        mkdirSync(backupDir, { recursive: true })
        copyDir(builtinDir, join(backupDir, 'builtin-plugins'))
      }

      // 写脚本：UTF-8 带 BOM，否则 PS 5.1 会把中文路径当 ANSI 读成乱码
      const scriptPath = join(patchDir, 'apply.ps1')
      const script = buildApplyScript({
        targetPid: process.pid,
        patchDir,
        targetDir: paths.rootDir,
        exePath: process.execPath,
        stamp: thisStamp
      })
      writeFileSync(scriptPath, `\ufeff${script}`, 'utf8')

      // 旧版 asar 再留一份带时间戳的（界面里承诺过）。
      // 只复制不改名：改名一旦成功而后续步骤失败，程序目录就会缺 app.asar，风险不值得冒。
      // 复制的源文件正被本进程读着，共享读没问题；万一被杀软挡住也只是少一份留底，不影响升级。
      try {
        copyFileSync(asarPath, join(paths.rootDir, 'resources', `app.asar.bak-${thisStamp}`))
      } catch (err) {
        log.warn('update', `留底 app.asar 失败，升级脚本会在退出后再留一份：${messageOf(err)}`)
      }

      log.info('update', `升级包已就绪：v${version} → v${info.version}，脚本 ${scriptPath}`)

      // 先把结果交给渲染端弹 toast，再退出；脚本会等本进程真的没了才动文件
      setTimeout(() => {
        void (async () => {
          try {
            await shutdown()
          } catch (err) {
            // 关库失败也必须继续，否则脚本会一直等这个进程
            log.warn('update', `升级前清理失败，仍继续退出：${messageOf(err)}`)
          }
          try {
            const child = spawn(
              'powershell.exe',
              [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-WindowStyle',
                'Hidden',
                '-File',
                scriptPath,
                '-targetPid',
                String(process.pid),
                '-patchDir',
                patchDir!,
                '-targetDir',
                paths.rootDir,
                '-exePath',
                process.execPath,
                '-stamp',
                thisStamp
              ],
              { detached: true, stdio: 'ignore', windowsHide: true }
            )
            child.unref()
          } catch (err) {
            // 脚本没起来就没人搬文件；照样退出，下次启动会提示「上次更新没跑完」，不会假装成功
            log.error('update', `启动替换脚本失败，本次升级未生效：${messageOf(err)}`)
          }
          app.exit(0)
        })()
      }, 1200)

      return { ok: true, from: version, to: info.version }
    } catch (err) {
      if (patchDir) rmSync(patchDir, { recursive: true, force: true })
      log.error('update', `应用升级包失败：${messageOf(err)}`)
      return { ok: false, error: `应用升级包失败：${messageOf(err)}` }
    } finally {
      inFlight = false
    }
  })
}

/** 递归复制目录（只在升级前备份 builtin-plugins 用，12 个文件，不必引三方库） */
function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const item of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, item.name)
    const dest = join(to, item.name)
    if (item.isDirectory()) copyDir(src, dest)
    else if (item.isFile()) writeFileSync(dest, readFileSync(src))
  }
}
