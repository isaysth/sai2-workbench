/**
 * 数据备份 / 恢复的 IPC。
 *
 * 分工：本文件只管「跟用户对话」（另存、选文件、二次确认、重启），
 * 真正的文件读写与路径校验在 `main/backup`，那边不依赖 electron，能单测。
 *
 * 恢复是唯一会动用户数据的动作，因此三道闸：
 *   1. 先读 manifest 校验是不是本程序的备份、格式版本是否支持；
 *   2. 弹窗明确告知「会用备份替换当前数据，现有数据改名留底」；
 *   3. 关库、停监听之后才动文件，成功后自动重启。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { CH } from '@shared/channels'
import type { DataBackupResult, DataRestoreResult } from '@shared/types'
import type { Logger } from '../logger'
import type { AppPaths } from '../paths'
import { createBackup, readBackupManifest, restoreBackup, type BackupCounts } from '../backup'

export interface DataIpcDeps {
  paths: AppPaths
  log: Logger
  version: string
  /** 当前索引统计，写进 manifest，恢复前能让人看清"备份里到底有多少东西" */
  counts: () => BackupCounts
  /** 关库 + 停监听。恢复前必须调用，否则 Windows 上 index.db 被占用无法改名 */
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

function formatWhen(iso: string): string {
  if (!iso) return '时间未知'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

export function registerDataIpc(deps: DataIpcDeps): void {
  const { paths, log, version, counts, shutdown } = deps

  ipcMain.handle(CH.dataExport, async (): Promise<DataBackupResult> => {
    const win = focusedWindow()
    const options = {
      title: '保存数据备份',
      buttonLabel: '保存备份',
      defaultPath: join(app.getPath('desktop'), `sai2工作台-数据备份-${stamp()}.zip`),
      filters: [{ name: '数据备份', extensions: ['zip'] }]
    }
    try {
      const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }

      const result = await createBackup({
        zipPath: picked.filePath,
        dataDir: paths.dataDir,
        pluginDir: paths.pluginDir,
        appVersion: version,
        counts: counts()
      })
      log.info(
        'backup',
        `已导出数据备份：${picked.filePath}（${result.entries} 个文件，${(result.bytes / 1024).toFixed(0)}KB）`
      )
      return { ok: true, file: picked.filePath, bytes: result.bytes, entries: result.entries }
    } catch (err) {
      log.error('backup', `导出数据备份失败：${messageOf(err)}`)
      return { ok: false, error: `备份失败：${messageOf(err)}` }
    }
  })

  ipcMain.handle(CH.dataImport, async (): Promise<DataRestoreResult> => {
    const win = focusedWindow()
    const options = {
      title: '选择数据备份',
      buttonLabel: '选择',
      properties: ['openFile' as const],
      filters: [{ name: '数据备份', extensions: ['zip'] }]
    }
    try {
      const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }
      const zipPath = picked.filePaths[0]!

      // 闸 1：先确认是本程序能读的备份，避免拿错文件直接覆盖
      const manifest = await readBackupManifest(zipPath)
      if (!manifest.ok) {
        log.warn('backup', `拒绝恢复：${manifest.error}（${zipPath}）`)
        return { ok: false, error: manifest.error }
      }

      // 闸 2：说清后果再动手
      const detail = [
        `备份时间：${formatWhen(manifest.value.createdAt)}`,
        `备份来自版本：v${manifest.value.appVersion}`,
        `备份内容：${manifest.value.counts.files} 个稿件记录 · ${manifest.value.counts.tags} 个标签 · ${manifest.value.counts.projects} 个项目 · ${manifest.value.entries} 个文件`,
        '',
        '恢复后当前数据会被备份替换，现有数据自动改名留底（后缀 .bak-时间），不会直接删除。',
        '画布原文件不受影响 —— 备份里只有索引、标签、配置、背景图和插件。',
        '恢复完成后程序会自动重启。'
      ].join('\n')

      const ask = win
        ? await dialog.showMessageBox(win, {
            type: 'warning',
            title: '确认恢复数据',
            message: '用这个备份替换当前数据？',
            detail,
            buttons: ['取消', '恢复并重启'],
            defaultId: 1,
            cancelId: 0,
            noLink: true
          })
        : await dialog.showMessageBox({
            type: 'warning',
            title: '确认恢复数据',
            message: '用这个备份替换当前数据？',
            detail,
            buttons: ['取消', '恢复并重启'],
            defaultId: 1,
            cancelId: 0,
            noLink: true
          })
      if (ask.response !== 1) return { ok: false, canceled: true }

      // 闸 3：关库、停监听，再动文件
      const restoreStamp = stamp()
      try {
        await shutdown()
        const result = await restoreBackup({
          zipPath,
          dataDir: paths.dataDir,
          pluginDir: paths.pluginDir,
          stamp: restoreStamp
        })
        log.info(
          'backup',
          `已恢复数据备份：${zipPath}（落盘 ${result.restored} 项，旧数据留底后缀 ${result.asideSuffix}）`
        )
        // 让渲染端先把 toast 显示出来，再重启
        setTimeout(() => {
          app.relaunch()
          app.exit(0)
        }, 1200)
        return { ok: true, restored: result.restored, asideSuffix: result.asideSuffix, restarting: true }
      } catch (err) {
        log.error('backup', `恢复数据失败：${messageOf(err)}（旧数据在 .bak-${restoreStamp}，程序将重启）`)
        // 此时库已关闭、文件可能已改名：必须重启才能回到可用状态，旧数据以 .bak- 形式留在原目录
        setTimeout(() => {
          app.relaunch()
          app.exit(0)
        }, 3000)
        return {
          ok: false,
          error: `恢复失败：${messageOf(err)}。原数据已留底为 .bak-${restoreStamp}，程序即将重启。`
        }
      }
    } catch (err) {
      log.error('backup', `恢复流程异常：${messageOf(err)}`)
      return { ok: false, error: `恢复失败：${messageOf(err)}` }
    }
  })

  ipcMain.handle(CH.dataOpenDir, async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const err = await shell.openPath(paths.dataDir)
      if (err) return { ok: false, error: err }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: messageOf(e) }
    }
  })
}
