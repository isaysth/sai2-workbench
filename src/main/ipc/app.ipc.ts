import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { extname, join } from 'node:path'
import { CH } from '@shared/channels'
import type { RuntimeInfo, WindowAction } from '@shared/types'
import type { Logger } from '../logger'
import type { WindowManager } from '../window-manager'

/** 背景图上限。4K 壁纸通常 2~6MB，8MB 足够，同时挡住"误拖一张 50MB 的源文件进来" */
const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024
const BACKGROUND_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp']
/** 取景确认后写出的背景长边上限：窗口再大也用不到 4K 背景，压一压省内存也省 IO */
const MAX_OUTPUT_EDGE = 2560
/** 渲染端编码上来的 PNG 字节上限（2560 长边的照片 PNG 大约 4~10MB，给足余量） */
const MAX_OUTPUT_BYTES = 40 * 1024 * 1024
/** 选图后先落这个前缀的临时文件，取景确认才转正；取消 → 删掉 */
const PENDING_PREFIX = '.pending-'

/**
 * 只取纯文件名，挡掉 `../` 之类的路径穿越。
 * 渲染端的入参一律不可信（哪怕现在只有我们自己写代码在调，以后插件也会碰）。
 */
function safeFileName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? ''
  if (!base || base === '.' || base === '..' || base.includes('\0')) return null
  return base
}

/** 运行环境查询 + 自定义标题栏窗口按钮 + 背景图导入 */
export function registerAppIpc(runtime: RuntimeInfo, log: Logger, backgroundDir: string, wm: WindowManager): void {
  sweepPending(backgroundDir, log)

  ipcMain.handle(CH.appRuntime, () => runtime)
  ipcMain.handle(CH.appFloatState, () => wm.state())

  ipcMain.handle(CH.appWindow, (event, action: WindowAction) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { ok: false, error: '窗口已关闭' }

    switch (action) {
      case 'minimize':
        // 「最小化到托盘」由 launcher-float 插件配置决定，渲染端不用知道
        wm.handleMinimize()
        break
      case 'toggle-maximize':
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        break
      case 'toggle-float':
        wm.toggleFloat()
        break
      case 'tray':
        wm.hideToTray()
        break
      case 'quit':
        wm.quit()
        break
      case 'close':
        win.close()
        break
      default:
        log.warn('ipc', `收到未知窗口动作：${String(action)}`)
        return { ok: false, error: '未知窗口动作' }
    }
    return { ok: true }
  })

/**
 * 选一张图做背景。
 * 复制到 data/backgrounds 而不是直接引用原路径：用户从 U 盘或临时目录选图后，
 * 原文件一删背景就没了；拷进数据目录才能做到"拷走整个文件夹即迁移"。
 *
 * v1.18：先落成 `.pending-*` 临时文件返回给渲染端取景，**不再直接删旧图**。
 * 取景取消时旧背景必须原封不动 —— 用户点了"换一张"又反悔，不该把现有背景弄丢。
 */
ipcMain.handle(CH.appPickBackground, async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options = {
    title: '选择背景图片',
    buttonLabel: '下一步：取景',
    properties: ['openFile' as const],
    filters: [{ name: '图片', extensions: BACKGROUND_EXTS }]
  }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }

  const src = picked.filePaths[0]!
  try {
    const size = statSync(src).size
    if (size > MAX_BACKGROUND_BYTES) {
      const mb = (size / 1024 / 1024).toFixed(1)
      log.warn('ipc', `背景图过大，已拒绝：${src}（${mb}MB）`)
      return { ok: false, error: `图片太大（${mb}MB），请换一张 8MB 以内的` }
    }
    const ext = extname(src).toLowerCase() || '.png'
    if (!BACKGROUND_EXTS.includes(ext.replace('.', ''))) {
      return { ok: false, error: '只支持 PNG / JPG / WebP / BMP' }
    }
    const pending = `${PENDING_PREFIX}${Date.now()}${ext}`
    copyFileSync(src, join(backgroundDir, pending))
    log.info('ipc', `背景图已选入临时区：${pending}（${(size / 1024).toFixed(0)} KB）`)
    return { ok: true, pending }
  } catch (err) {
    log.error('ipc', `导入背景图失败：${String(err)}`)
    return { ok: false, error: '导入失败，请检查文件是否被占用' }
  }
})

/**
 * 取景确认：渲染端已经把图裁好、编码成 PNG，这里只校验 + 落盘。
 *
 * 为什么不在主进程裁：Electron 的 `nativeImage` **只支持 PNG / JPEG**。
 * WebP（以及部分 BMP）会被解成空图，`isEmpty()` 直接 true —— 用户在取景框里
 * 明明看得到图，一点"用作背景"就报"解码失败"。渲染端是完整的 Chromium，
 * webp/bmp/avif 全能解，顺手把长边降采样也做了，主进程留一份纯 IO。
 *
 * 入参一律不可信：临时文件名必须带 `.pending-` 前缀，字节必须是真 PNG（校验 magic），
 * 体积封顶 40MB。
 */
ipcMain.handle(CH.appApplyBackground, (_event, payload: unknown) => {
  const p = (payload ?? {}) as { pending?: unknown; png?: unknown; oldName?: unknown }
  const pending = safeFileName(p.pending)
  if (!pending || !pending.startsWith(PENDING_PREFIX)) {
    log.warn('ipc', `取景参数无效：${String(p.pending)}`)
    return { ok: false, error: '取景参数无效，请重新选择图片' }
  }
  const pendingPath = join(backgroundDir, pending)
  if (!existsSync(pendingPath)) return { ok: false, error: '原图已不在，请重新选择图片' }

  const buf = toBuffer(p.png)
  if (!buf) return { ok: false, error: '取景结果为空，请重新选择图片' }
  if (buf.length > MAX_OUTPUT_BYTES) {
    return { ok: false, error: `取景结果过大（${(buf.length / 1024 / 1024).toFixed(1)}MB），请换一张` }
  }
  // PNG magic：89 50 4E 47。渲染端理论上不会传别的，但这条 IPC 以后可能被插件调
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return { ok: false, error: '取景结果不是有效图片' }
  }
  const outW = buf.readUInt32BE(16)
  const outH = buf.readUInt32BE(20)
  if (!outW || !outH || outW > 8192 || outH > 8192) {
    return { ok: false, error: '取景结果尺寸异常' }
  }

  try {
    const name = `bg-${Date.now()}.png`
    writeFileSync(join(backgroundDir, name), buf)

    // 转正后清场：临时文件 + 上一张背景
    rmSync(pendingPath, { force: true })
    const old = safeFileName(p.oldName)
    if (old && old !== name) {
      try {
        rmSync(join(backgroundDir, old), { force: true })
      } catch {
        /* 删旧图失败不影响新图生效 */
      }
    }
    const longEdge = Math.max(outW, outH)
    const note = longEdge > MAX_OUTPUT_EDGE ? '（超出上限，渲染端应已降采样）' : ''
    log.info(
      'ipc',
      `背景图已取景生成：${name}（${outW}×${outH}，${(buf.length / 1024).toFixed(0)} KB）${note}`
    )
    return { ok: true, file: name }
  } catch (err) {
    log.error('ipc', `生成背景失败：${String(err)}`)
    return { ok: false, error: '生成背景失败：' + String(err) }
  }
})

/** IPC 传来的二进制可能是 Uint8Array / Buffer / ArrayBuffer，统一成 Buffer */
function toBuffer(raw: unknown): Buffer | null {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  return null
}

/**
 * 把临时图整份读成字节交给取景框。
 *
 * 为什么不让取景框直接 `<img src="sai2img://...">`：自定义协议加载的图会**污染 canvas**
 * （Chromium 视为跨源），`toBlob` 直接抛 `SecurityError: Tainted canvases may not be exported`。
 * 走 IPC 拿字节 → `new Blob()` → `blob:` URL 跟页面同源，canvas 可以正常导出。
 * 顺带也绕开了「webp 到底能不能被 nativeImage 解」这一整类格式问题。
 */
ipcMain.handle(CH.appReadBackground, (_event, name: unknown) => {
  const base = safeFileName(name)
  if (!base || !base.startsWith(PENDING_PREFIX)) return { ok: false, error: '取景参数无效' }
  const full = join(backgroundDir, base)
  try {
    const size = statSync(full).size
    if (size > MAX_BACKGROUND_BYTES) return { ok: false, error: '图片太大，请换一张 8MB 以内的' }
    return { ok: true, bytes: readFileSync(full) }
  } catch {
    return { ok: false, error: '图片读不出来，请重新选择' }
  }
})

ipcMain.handle(CH.appCancelBackground, (_event, name: unknown) => {
  const base = safeFileName(name)
  if (!base || !base.startsWith(PENDING_PREFIX)) return { ok: true }
  try {
    rmSync(join(backgroundDir, base), { force: true })
    log.info('ipc', `取景已取消，临时文件已删除：${base}`)
  } catch {
    /* 删不掉也无所谓，下次启动会清 */
  }
  return { ok: true }
})

/**
 * 启动时清掉上次残留的临时文件（选图后直接关窗口 / 崩溃）。
 * 不做的话 backgrounds 目录会慢慢攒下一堆用不上的大图。
 *
 * 只清 10 分钟前的：极短时间内二次启动（或调试时外部刚放进去的探针文件）不该被误删。
 */
function sweepPending(dir: string, log: Logger): void {
  const cutoff = Date.now() - 10 * 60 * 1000
  let removed = 0
  try {
    for (const f of readdirSync(dir)) {
      if (!f.startsWith(PENDING_PREFIX)) continue
      const full = join(dir, f)
      try {
        if (statSync(full).mtimeMs > cutoff) continue
        rmSync(full, { force: true })
        removed += 1
      } catch {
        /* 单个文件被占用不影响其它清理 */
      }
    }
  } catch {
    /* 目录不存在 / 不可读：没什么可清的 */
  }
  if (removed > 0) log.info('ipc', `已清理 ${removed} 个上次残留的背景临时文件`)
}

  ipcMain.handle(CH.appClearBackground, (_event, name: unknown) => {
    const base = safeFileName(name)
    if (!base) return { ok: true }
    try {
      rmSync(join(backgroundDir, base), { force: true })
      log.info('ipc', `背景图已删除：${base}`)
    } catch (err) {
      log.warn('ipc', `删除背景图失败：${String(err)}`)
    }
    return { ok: true }
  })
}
