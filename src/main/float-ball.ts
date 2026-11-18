/**
 * 桌面悬浮球：一个独立的小圆窗（不是把主窗口缩小），默认 88px，常驻置顶。
 *
 * 与 window-manager 的分工：
 * - 这里只管「球本身」：建窗、落位、拖动、皮肤、位置持久化；
 * - 「什么时候进 / 出球模式」由 WindowManager 决定（它注入 ball 依赖）。
 *
 * 可测性：模块顶层只做 type-only 引用 electron，运行时对象一律在方法里 require，
 * 这样纯逻辑（尺寸夹取、位置校验、SVG 生成）能在 vitest 里直接 import。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CH } from '@shared/channels'
import type { BallPosition, BallSkin } from '@shared/types'
import type { ConfigStore } from './config'
import type { Logger } from './logger'
import type { AppPaths } from './paths'

/** 球离屏幕边缘的距离（与主窗口的默认留白保持一致） */
const MARGIN = 24
const MIN_SIZE = 48
const MAX_SIZE = 160
const DEFAULT_SIZE = 88
/** 拖动时多久没消息就当作这一次手势结束，下一条消息重新取锚点 */
const DRAG_IDLE_MS = 400
/** 拖动过程中频繁写配置没有意义，停手后再落盘 */
const PERSIST_DELAY_MS = 500

type Electron = typeof import('electron')
type BrowserWin = import('electron').BrowserWindow

/** 屏幕上的矩形（workArea 的裁剪版，方便纯函数测试） */
export interface BallRect {
  x: number
  y: number
  width: number
  height: number
}

/** 把配置里的直径夹到 48~160，坏值回默认 88 */
export function clampBallSize(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_SIZE
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)))
}

/** 默认位置：主屏工作区右上角 */
export function defaultBallPosition(area: BallRect, size: number): BallPosition {
  const s = clampBallSize(size)
  return {
    x: Math.round(Math.max(area.x + 8, area.x + area.width - s - MARGIN)),
    y: Math.round(Math.max(area.y + 8, area.y + MARGIN))
  }
}

/**
 * 恢复上次位置：球必须与某块屏幕的工作区有交集，否则视为「显示器拔掉了」。
 * 思路照抄 window.ts 的 restoreBounds（矩形相交判断）。
 */
export function resolveBallPosition(
  saved: unknown,
  size: number,
  area: BallRect,
  displays: BallRect[]
): BallPosition {
  const s = clampBallSize(size)
  const p = (saved ?? null) as Partial<BallPosition> | null
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    const x = Math.round(p.x as number)
    const y = Math.round(p.y as number)
    const areas = displays.length > 0 ? displays : [area]
    const visible = areas.some(
      (a) => x < a.x + a.width && x + s > a.x && y < a.y + a.height && y + s > a.y
    )
    if (visible) return { x, y }
  }
  return defaultBallPosition(area, s)
}

/**
 * 内置皮肤「橙子切片」。
 *
 * 几何（viewBox 100×100）：外皮 r=48（2px 深橙描边）、白络环 r=39~47、
 * 8 瓣果肉 r=36 交替两种橙色（瓣间按弧长留 1.5px 缝）、中心白芯 r=5.5。
 * 全部内联，不引外链 / 字体，透明底。
 */
export function buildOrangeSliceSvg(): string {
  const cx = 50
  const cy = 50
  const petals = 8
  const step = (Math.PI * 2) / petals
  // 1.5px 的缝按 r=36 换成弧度，两侧各让一半
  const halfGap = 1.5 / 36 / 2
  const r = 36
  const point = (angle: number): string =>
    `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`
  const paths: string[] = []
  for (let i = 0; i < petals; i += 1) {
    const a0 = i * step - Math.PI / 2 + halfGap
    const a1 = (i + 1) * step - Math.PI / 2 - halfGap
    const fill = i % 2 === 0 ? '#ffb347' : '#ffcf7a'
    // A 的 large-arc=0：每瓣 45°，永远是小弧
    paths.push(
      `<path class="petal" d="M ${cx} ${cy} L ${point(a0)} A ${r} ${r} 0 0 1 ${point(a1)} Z" fill="${fill}"/>`
    )
  }
  return [
    '<svg viewBox="0 0 100 100" aria-hidden="true">',
    '<defs><radialGradient id="peel" cx="38%" cy="30%" r="75%">',
    '<stop offset="0%" stop-color="#ff9a3c"/><stop offset="100%" stop-color="#f4762a"/>',
    '</radialGradient></defs>',
    '<circle cx="50" cy="50" r="48" fill="url(#peel)" stroke="#e0661e" stroke-width="2"/>',
    '<circle cx="50" cy="50" r="39" fill="#fff6e8"/>',
    paths.join(''),
    '<circle cx="50" cy="50" r="5.5" fill="#fff6e8"/>',
    '</svg>'
  ].join('')
}

export const ORANGE_BALL_SVG = buildOrangeSliceSvg()

/**
 * 球体页面（完全自包含，CSS / JS / SVG 全内联）。
 *
 * 拖动必须用 pointer 事件手动实现 —— `-webkit-app-region: drag` 会把 click /
 * dblclick / contextmenu 一起吞掉，右键菜单和双击复位就全废了。
 * 单击 / 双击仲裁：click 等 230ms 再 expand，期间来 dblclick 就取消并 reset。
 */
export const BALL_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { user-select: none; cursor: default; }
  #ball {
    width: 100%; height: 100%; border-radius: 50%;
    transform-origin: 50% 50%; transition: transform 120ms ease;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, .35));
  }
  body:hover #ball { transform: scale(1.06); }
  body:active #ball { transform: scale(.96); }
  #ball svg, #ball img { width: 100%; height: 100%; display: block; border-radius: 50%; pointer-events: none; }
</style>
</head>
<body>
<div id="ball" role="button" aria-label="sai2工作台悬浮球">${ORANGE_BALL_SVG}</div>
<script>
(function () {
  var ball = document.getElementById('ball')
  var api = window.api && window.api.ball
  if (!api) return

  var clickTimer = null
  var suppressClickUntil = 0
  var dragging = false
  var moved = false
  var lastX = 0
  var lastY = 0

  if (api.onSkin) {
    api.onSkin(function (skin) {
      if (!skin) return
      if (skin.svg) ball.innerHTML = skin.svg
      else if (skin.image) ball.innerHTML = '<img alt="" src="' + skin.image + '">'
    })
  }

  ball.addEventListener('click', function () {
    if (Date.now() < suppressClickUntil) return
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(function () {
      clickTimer = null
      api.action('expand')
    }, 230)
  })

  ball.addEventListener('dblclick', function () {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
    api.action('reset')
  })

  ball.addEventListener('contextmenu', function (e) {
    e.preventDefault()
    api.action('menu')
  })

  // pointerdown 立刻发一次：主进程据此记下「光标在球里的哪个点」，
  // 后面按光标位移平移窗口，球不会跳到光标左上角。
  ball.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return
    dragging = true
    moved = false
    lastX = e.screenX
    lastY = e.screenY
    try { ball.setPointerCapture(e.pointerId) } catch (err) {}
    api.drag({ x: e.screenX, y: e.screenY })
  })

  ball.addEventListener('pointermove', function (e) {
    if (!dragging) return
    if (!moved && Math.abs(e.screenX - lastX) + Math.abs(e.screenY - lastY) > 3) moved = true
    if (moved) api.drag({ x: e.screenX, y: e.screenY })
  })

  function endDrag(e) {
    if (!dragging) return
    dragging = false
    try { ball.releasePointerCapture(e.pointerId) } catch (err) {}
    if (moved) {
      // 拖完顺手松手会补一个 click，别让它又展开主界面
      suppressClickUntil = Date.now() + 260
      moved = false
    }
  }
  ball.addEventListener('pointerup', endDrag)
  ball.addEventListener('pointercancel', endDrag)
})()
</script>
</body>
</html>`

export interface FloatBallDeps {
  config: ConfigStore
  log: Logger
  paths: AppPaths
  /** 主窗口用的同一个 preload（球页面只用到 api.ball） */
  preloadPath: string
  /** 主屏工作区：复位与默认落位用 */
  workArea: () => BallRect
  /** 全部屏幕的工作区：恢复上次位置时做可见性校验 */
  workAreas?: () => BallRect[]
  /** 当前配置的球直径（插件配置，48~160） */
  size: () => number
}

/** 右键菜单里的一项皮肤 */
export interface BallSkinEntry {
  id: string
  label: string
  size: number
}

interface DragAnchor {
  cursorX: number
  cursorY: number
  winX: number
  winY: number
}

function electronApi(): Electron {
  return require('electron') as Electron
}

export class FloatBall {
  private win: BrowserWin | null = null
  private currentSkin: BallSkin = { svg: ORANGE_BALL_SVG, size: DEFAULT_SIZE }
  private dragAnchor: DragAnchor | null = null
  private dragAt = 0
  private persistTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: FloatBallDeps) {}

  /** 皮肤目录：data/ball-skins（用户自定义皮肤都放这里） */
  get skinDir(): string {
    return join(this.deps.paths.dataDir, 'ball-skins')
  }

  /** 主进程弹原生菜单时要 window 句柄 */
  getWindow(): BrowserWin | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  isVisible(): boolean {
    return this.getWindow()?.isVisible() === true
  }

  show(): void {
    const size = clampBallSize(this.deps.size())
    const skin = this.resolveSkin(size)
    this.currentSkin = skin
    const pos = resolveBallPosition(
      this.deps.config.get<BallPosition | null>('ui.ballPosition'),
      skin.size,
      this.deps.workArea(),
      this.deps.workAreas?.() ?? []
    )

    const existing = this.getWindow()
    if (existing) {
      if (existing.getBounds().width !== skin.size) existing.setSize(skin.size, skin.size)
      existing.setPosition(pos.x, pos.y)
      this.sendSkin(existing, skin)
      existing.show()
      existing.focus()
      return
    }

    this.createWindow(pos, skin)
  }

  hide(): void {
    this.flushPosition()
    const win = this.getWindow()
    if (!win) return
    win.hide()
    this.deps.log.info('float-ball', '悬浮球已隐藏')
  }

  /** 双击 / 菜单「复位到右上角」 */
  resetPosition(): void {
    const size = this.currentSkin.size || clampBallSize(this.deps.size())
    const pos = defaultBallPosition(this.deps.workArea(), size)
    const win = this.getWindow()
    if (win) win.setPosition(pos.x, pos.y)
    this.deps.config.set('ui.ballPosition', pos)
    this.deps.log.info('float-ball', `悬浮球已复位到 (${pos.x}, ${pos.y})`)
  }

  /** 拖动：入参是当前光标的屏幕坐标，第一条消息记锚点，之后按位移平移 */
  moveTo(x: number, y: number): void {
    const win = this.getWindow()
    if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return
    const now = Date.now()
    if (!this.dragAnchor || now - this.dragAt > DRAG_IDLE_MS) {
      const [wx, wy] = win.getPosition()
      this.dragAnchor = { cursorX: x, cursorY: y, winX: wx, winY: wy }
    }
    this.dragAt = now
    win.setPosition(
      Math.round(this.dragAnchor.winX + (x - this.dragAnchor.cursorX)),
      Math.round(this.dragAnchor.winY + (y - this.dragAnchor.cursorY))
    )
    this.schedulePersist()
  }

  /** 配置里的皮肤变了（菜单选择 / 改了 skin.json）后重算并热更新 */
  applySkin(): void {
    const size = clampBallSize(this.deps.size())
    const skin = this.resolveSkin(size)
    this.currentSkin = skin
    const win = this.getWindow()
    if (!win) return
    if (win.getBounds().width !== skin.size) win.setSize(skin.size, skin.size)
    this.sendSkin(win, skin)
    this.deps.log.info('float-ball', `皮肤已切换：${describeSkin(skin)}`)
  }

  /** 扫描用户皮肤目录（不存在时返回空数组，不创建任何东西） */
  skins(): BallSkinEntry[] {
    const dir = this.skinDir
    if (!existsSync(dir)) return []
    const out: BallSkinEntry[] = []
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      this.deps.log.warn('float-ball', `皮肤目录读取失败：${String(err)}`)
      return []
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const found = findSkinImage(join(dir, entry.name))
      if (!found) continue
      const meta = readSkinMeta(join(dir, entry.name))
      out.push({
        id: join(dir, entry.name),
        label: meta.name ?? entry.name,
        size: clampBallSize(meta.size)
      })
    }
    return out
  }

  /** 「打开皮肤目录」：目录不存在才创建，并写一份说明（不塞假图） */
  ensureSkinDir(): string {
    const dir = this.skinDir
    try {
      mkdirSync(dir, { recursive: true })
      const readme = join(dir, 'README.txt')
      if (!existsSync(readme)) {
        writeFileSync(
          readme,
          [
            'sai2工作台 · 悬浮球皮肤目录',
            '',
            '每个皮肤一个子文件夹，里面放一张 skin.png（也支持 .jpg / .gif）。',
            '可选在同级放 skin.json：{"name":"我的球","size":96}',
            '（size 省略则跟随插件里的「悬浮球直径」配置，范围 48~160）。',
            '然后在悬浮球右键菜单的「更换皮肤…」里选中该文件夹。',
            ''
          ].join('\r\n'),
          'utf8'
        )
      }
    } catch (err) {
      this.deps.log.warn('float-ball', `准备皮肤目录失败：${String(err)}`)
    }
    return dir
  }

  dispose(): void {
    this.flushPosition()
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const win = this.win
    this.win = null
    if (win && !win.isDestroyed()) win.destroy()
  }

  // ------------------------------------------------------------------ 内部

  private createWindow(pos: BallPosition, skin: BallSkin): void {
    const { BrowserWindow } = electronApi()
    const win = new BrowserWindow({
      x: pos.x,
      y: pos.y,
      width: skin.size,
      height: skin.size,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: true,
      show: false,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false
      }
    })
    this.win = win

    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    win.webContents.on('did-finish-load', () => {
      if (win.isDestroyed()) return
      this.sendSkin(win, this.currentSkin)
    })
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      this.deps.log.error('float-ball', `悬浮球页面加载失败：${code} ${desc} ${url}`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      this.deps.log.error('float-ball', `悬浮球渲染进程退出：${details.reason}`)
    })

    // 与插件浮窗同一个坑：含中文的路径 loadFile 会拼出未编码的 file:///C:\...，
    // 因此把自包含 HTML 复制到纯 ASCII 的 tmp 目录再加载，并延后一拍避开导航竞态。
    try {
      const dir = join(tmpdir(), 'sai2-ball')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'ball.html')
      writeFileSync(file, BALL_HTML, 'utf8')
      setTimeout(() => {
        if (win.isDestroyed()) return
        void win.loadFile(file).catch((err: unknown) => {
          this.deps.log.error('float-ball', `悬浮球页面加载失败：${String(err)}`)
        })
      }, 50)
    } catch (err) {
      this.deps.log.error('float-ball', `准备悬浮球页面失败：${String(err)}`)
    }

    win.show()
    win.setAlwaysOnTop(true, 'floating')
    this.deps.log.info('float-ball', `悬浮球已显示（${skin.size}px @ ${pos.x},${pos.y}）`)
  }

  private sendSkin(win: BrowserWin, skin: BallSkin): void {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(CH.ballSkin, skin)
  }

  private resolveSkin(size: number): BallSkin {
    const configured = this.deps.config.get<string>('ui.ballSkin') ?? 'orange'
    if (!configured || configured === 'orange') return { svg: ORANGE_BALL_SVG, size }

    const file = findSkinImage(configured)
    if (!file) {
      this.deps.log.warn('float-ball', `皮肤目录里没有图片，回退橙子切片：${configured}`)
      return { svg: ORANGE_BALL_SVG, size }
    }
    try {
      const { nativeImage } = electronApi()
      const img = nativeImage.createFromPath(file)
      if (img.isEmpty()) throw new Error('图片解码失败')
      const effective = clampBallSize(readSkinMeta(configured).size ?? size)
      const resized = img.resize({ width: effective, height: effective, quality: 'best' })
      return { image: resized.toDataURL(), size: effective }
    } catch (err) {
      this.deps.log.warn('float-ball', `自定义皮肤加载失败，回退橙子切片：${String(err)}`)
      return { svg: ORANGE_BALL_SVG, size }
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.flushPosition()
    }, PERSIST_DELAY_MS)
  }

  private flushPosition(): void {
    const win = this.getWindow()
    if (!win) return
    const [x, y] = win.getPosition()
    this.deps.config.set('ui.ballPosition', { x, y })
  }
}

/** 皮肤目录里按优先级找图片（png > jpg > gif） */
function findSkinImage(dir: string): string | null {
  if (!dir || !existsSync(dir)) return null
  try {
    if (!statSync(dir).isDirectory()) return null
  } catch {
    return null
  }
  for (const name of ['skin.png', 'skin.jpg', 'skin.jpeg', 'skin.gif']) {
    const file = join(dir, name)
    if (existsSync(file)) return file
  }
  return null
}

/** skin.json：{"name":"我的球","size":96}，坏文件当作没有 */
function readSkinMeta(dir: string): { name?: string; size?: number } {
  try {
    const raw = readFileSync(join(dir, 'skin.json'), 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown; size?: unknown }
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : undefined
    const size = Number.isFinite(Number(parsed.size)) ? Number(parsed.size) : undefined
    return { name, size }
  } catch {
    return {}
  }
}

function describeSkin(skin: BallSkin): string {
  return skin.image ? `自定义图片 ${skin.size}px` : `内置 SVG ${skin.size}px`
}

export interface BallIpcDeps {
  ball: FloatBall
  /** 只用到 exitFloat，避免把整个 WindowManager 拖进这个模块 */
  wm: { exitFloat: () => void }
  config: ConfigStore
  log: Logger
  quit: () => void
}

/**
 * 悬浮球的 IPC 与右键菜单。一个进程只注册一次（由 index.ts 调）。
 * 不塞进 app.ipc.ts：那些是主窗口的窗口控制，球是另一套交互。
 */
export function registerBallIpc(deps: BallIpcDeps): void {
  const { ipcMain, Menu, dialog, shell } = electronApi()
  const { ball, config, log } = deps

  ipcMain.on(CH.ballAction, (_e, kind: unknown) => {
    if (kind === 'expand') deps.wm.exitFloat()
    else if (kind === 'reset') ball.resetPosition()
    else if (kind === 'menu') showMenu()
    else log.warn('float-ball', `收到未知球操作：${String(kind)}`)
  })

  ipcMain.on(CH.ballDrag, (_e, pos: unknown) => {
    const p = (pos ?? {}) as { x?: unknown; y?: unknown }
    ball.moveTo(Number(p.x), Number(p.y))
  })

  function showMenu(): void {
    const win = ball.getWindow()
    if (!win) return
    const current = config.get<string>('ui.ballSkin') ?? 'orange'
    const skins = ball.skins()
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: '展开主界面', click: () => deps.wm.exitFloat() },
      { label: '复位到右上角', click: () => ball.resetPosition() },
      { type: 'separator' },
      {
        label: '更换皮肤…',
        submenu: [
          {
            label: '橙子切片（内置）',
            type: 'radio',
            checked: current === 'orange',
            click: () => {
              config.set('ui.ballSkin', 'orange')
              ball.applySkin()
            }
          },
          ...skins.map((s) => ({
            label: s.label,
            type: 'radio' as const,
            checked: current === s.id,
            click: () => {
              config.set('ui.ballSkin', s.id)
              ball.applySkin()
            }
          })),
          { type: 'separator' as const },
          {
            label: '选择皮肤文件夹…',
            click: () => {
              void dialog
                .showOpenDialog(win, {
                  title: '选择悬浮球皮肤文件夹（内含 skin.png）',
                  properties: ['openDirectory']
                })
                .then((picked) => {
                  if (picked.canceled || picked.filePaths.length === 0) return
                  config.set('ui.ballSkin', picked.filePaths[0])
                  ball.applySkin()
                })
                .catch((err: unknown) => log.warn('float-ball', `选择皮肤失败：${String(err)}`))
            }
          }
        ]
      },
      {
        label: '打开皮肤目录',
        click: () => {
          const dir = ball.ensureSkinDir()
          void shell.openPath(dir).catch((err: unknown) => log.warn('float-ball', `打开皮肤目录失败：${String(err)}`))
        }
      },
      { type: 'separator' },
      { label: '退出工作台', click: () => deps.quit() }
    ]
    Menu.buildFromTemplate(template).popup({ window: win })
  }
}
