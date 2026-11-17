/**
 * SAI2 FX Studio —— sai2工作台非官方插件入口。
 *
 * 装配：命名管道 agent + 核心引擎 + 移植算法 + 剪贴板/桌面桥 + 浮窗。
 * 全部逻辑在主进程（CJS），浮窗只发消息，不碰 Node。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const agent = require('./core/agent.js')
const { ImageBuffer } = require('./core/image.js')
const { Session } = require('./core/session.js')
const blur = require('./algorithms/blur.js')
const adjust = require('./algorithms/adjust.js')
const filters = require('./algorithms/filters.js')
const { LiquifySession } = require('./algorithms/liquify.js')
const clip = require('./core/clipboard.js')
const clipWin = require('./core/clipboard-win.js')
const desktop = require('./core/desktop.js')

const PLUGIN_ID = 'sai2-fx-studio'
const PREVIEW_MAX_DIM = 900

function apply(ctx, config) {
  const log = ctx.log
  const session = new Session({ previewMaxDim: PREVIEW_MAX_DIM })
  let liquify = null // 当前液化会话（全分辨率位移场）
  let lastPreview = null // 上一次预览结果（应用时用）
  let windowOpen = false

  // ---- 配置：套件路径与注入器 ----
  function suiteDir() {
    return String(config.suiteDir || '').trim()
  }
  function injectorExe() {
    const d = suiteDir()
    if (!d) return ''
    // 上游套件里注入器叫 sai2_injector.exe
    return path.join(d, 'sai2_injector.exe')
  }
  function checkSuite() {
    const dir = suiteDir()
    if (!dir) {
      ctx.setStatus('未配置插件套件目录', 'warn')
      return false
    }
    if (!fs.existsSync(dir)) {
      ctx.setStatus('套件目录不存在，请重新选择', 'error')
      return false
    }
    ctx.setStatus('FX Studio 就绪', 'ok')
    return true
  }

  // ---- agent 通信 ----
  function agentOpts(budget = 1500) {
    return { budgetMs: budget }
  }
  async function refreshLayers() {
    try {
      const r = await agent.queryLayers(agentOpts(1200))
      const layers = r.ok ? r.rows : []
      post({ type: 'layers', ok: r.ok, layers })
      if (!r.ok) ctx.setStatus('未连接注入器（请先注入 SAI2）', 'warn')
      else ctx.setStatus('FX Studio 就绪', 'ok')
      return layers
    } catch (err) {
      post({ type: 'layers', ok: false, layers: [] })
      ctx.setStatus('注入器离线：' + err.message, 'warn')
      return []
    }
  }

  // ---- 浮窗消息通道 ----
  function post(message) {
    if (ctx.windows) ctx.windows.post(message)
  }
  function toast(text) {
    post({ type: 'status', text })
  }

  // 选中图层：记录行信息（真正的抓取在 grab 里按屏幕坐标点选）
  async function selectLayer(payload) {
    const row = payload && payload.row
    if (!row) return
    state.selectedRow = row
    toast('已选图层：' + row.text + '（点「抓取当前图层」获取内容）')
  }
  const state = { selectedRow: null }

  // ---- 抓图：聚焦 SAI2 → 点图层行 → Ctrl+A/C → 读 DIBV5 ----
  async function grab() {
    try {
      // 若选了图层行，先按屏幕坐标点一下选中它（上游：点行 = 选中该层）
      if (state.selectedRow && typeof state.selectedRow.screenX === 'number') {
        await desktop.clickAt(state.selectedRow.screenX, state.selectedRow.screenY)
      }
      await desktop.grabLayer()
      const dib = await clipWin.readDIBV5()
      if (!dib) {
        toast('剪贴板里没有位图，请确认 SAI2 已复制图层')
        return
      }
      const image = clip.decodeDIBV5(dib)
      if (!image) {
        toast('剪贴板位图格式无法识别')
        return
      }
      session.setImage(image)
      // 液化位移场按全分辨率重建
      liquify = new LiquifySession(image.width, image.height)
      lastPreview = null
      post({ type: 'image', dataUrl: imageToDataUrl(image) })
      toast(`已抓取 ${image.width}×${image.height}`)
    } catch (err) {
      log.error(`${PLUGIN_ID} 抓图失败：${err.message}`)
      toast('抓图失败：' + err.message)
    }
  }

  // ---- 预览：在降采样图上跑当前效果 ----
  async function preview(message) {
    if (!session.hasImage()) { toast('请先抓取图层'); return }
    try {
      const tab = message.tab
      const effect = message.effect
      const params = message.params || {}
      let result
      if (tab === 'liquify') {
        // 液化：位移场是全分辨率，render 会按比例采样降采样基准
        result = liquify ? liquify.render(session.previewBase()) : session.previewBase().clone()
      } else if (tab === 'blur') {
        result = blur.blur(session.previewBase(), effect, params)
      } else if (tab === 'adjust') {
        result = adjust.apply(session.previewBase(), effect, params)
      } else if (tab === 'filter') {
        result = filters.apply(session.previewBase(), effect, params)
      } else {
        result = session.previewBase().clone()
      }
      lastPreview = { tab, effect, params, image: result }
      post({ type: 'image', dataUrl: imageToDataUrl(result) })
    } catch (err) {
      log.error(`${PLUGIN_ID} 预览失败：${err.message}`)
      toast('预览失败：' + err.message)
    }
  }

  // ---- 应用：把预览效果按全分辨率重算 → 写剪贴板 → 贴回 ----
  async function applyEffect(message) {
    if (!session.hasImage()) { toast('请先抓取图层'); return }
    try {
      const tab = message.tab
      const effect = message.effect
      const params = message.params || {}
      const full = session.fullBase()
      let result
      if (tab === 'liquify') {
        // 液化位移场已在全分辨率累积，直接渲染全图
        result = liquify ? liquify.render(full) : full.clone()
      } else if (tab === 'blur') {
        result = blur.blur(full, effect, params)
      } else if (tab === 'adjust') {
        result = adjust.apply(full, effect, params)
      } else if (tab === 'filter') {
        result = filters.apply(full, effect, params)
      } else {
        result = full.clone()
      }

      // 画布补边：抓到的是图层包围盒，需补到 .sai2 精确画布尺寸并放回原偏移。
      // 目前用「抓到多大贴多大」的保守策略（包围盒直接回贴），
      // 精确补边需要 agent 的 canvas.arm/state/save 协议，列为后续增强。
      const dib = clip.encodeDIBV5(result)
      await clipWin.writeDIBV5(dib)
      session.apply(result, effect)
      if (tab === 'liquify') liquify = new LiquifySession(full.width, full.height)
      await desktop.pasteBack()
      post({ type: 'image', dataUrl: imageToDataUrl(result) })
      toast('已应用并贴回 SAI2')
    } catch (err) {
      log.error(`${PLUGIN_ID} 应用失败：${err.message}`)
      toast('应用失败：' + err.message)
    }
  }

  function undo() {
    if (session.undo()) {
      post({ type: 'image', dataUrl: imageToDataUrl(session.applied) })
      toast('已撤销')
    } else toast('没有可撤销的操作')
  }
  function reset() {
    if (!session.hasImage()) return
    session.reset()
    liquify = new LiquifySession(session.applied.width, session.applied.height)
    post({ type: 'image', dataUrl: imageToDataUrl(session.applied) })
    toast('已复位到抓取时的原图')
  }

  // ---- 位图 → data URL（浮窗 canvas 显示） ----
  function imageToDataUrl(image) {
    // 缩到预览尺寸以内再编码，避免大 base64 经 IPC 拖慢
    const view = image.downsample(1200)
    const png = encodePNG(view)
    return 'data:image/png;base64,' + Buffer.from(png).toString('base64')
  }

  /** 极简 PNG 编码（无依赖）：用 zlib 压缩 raw scanline */
  function encodePNG(image) {
    const zlib = require('node:zlib')
    const { width, height } = image
    const raw = Buffer.alloc((width * 4 + 1) * height)
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * (width * 4 + 1)
      raw[rowStart] = 0 // filter none
      for (let x = 0; x < width; x += 1) {
        const si = (y * width + x) * 4
        const di = rowStart + 1 + x * 4
        raw[di] = image.data[si]
        raw[di + 1] = image.data[si + 1]
        raw[di + 2] = image.data[si + 2]
        raw[di + 3] = image.data[si + 3]
      }
    }
    const idat = zlib.deflateSync(raw)
    const chunks = []
    function chunk(type, data) {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(data.length, 0)
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(body) >>> 0, 0)
      chunks.push(len, body, crc)
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 6 // RGBA
    chunk('IHDR', ihdr)
    chunk('IDAT', idat)
    chunk('IEND', Buffer.alloc(0))
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks])
  }

  let crcTable = null
  function crc32(buf) {
    if (!crcTable) {
      crcTable = []
      for (let n = 0; n < 256; n += 1) {
        let c = n
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        crcTable[n] = c >>> 0
      }
    }
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return c ^ 0xffffffff
  }

  // ---- 浮窗打开 / 消息路由 ----
  function openWindow(file) {
    if (!ctx.windows) { ctx.dialog.error('当前工作台版本不支持插件浮窗，请升级 sai2工作台'); return }
    const entry = path.join(__dirname, 'ui', 'panel.html')
    if (!fs.existsSync(entry)) { ctx.dialog.error('找不到浮窗界面文件：' + entry); return }
    const r = ctx.windows.open({
      entry: 'ui/panel.html',
      title: 'SAI2 FX Studio',
      width: 1000,
      height: 680,
      onMessage: handleWindowMessage
    })
    if (!r.ok) { ctx.dialog.error('打开浮窗失败：' + r.error); return }
    windowOpen = true
    checkSuite()
    void refreshLayers()
    if (file) toast('已选择文件：' + file + '（请在 SAI2 中打开后抓取）')
  }

  function handleWindowMessage(message) {
    if (!message || !message.type) return
    switch (message.type) {
      case 'close':
        if (ctx.windows) ctx.windows.close()
        windowOpen = false
        break
      case 'refreshLayers': void refreshLayers(); break
      case 'grab': void grab(); break
      case 'selectLayer': void selectLayer(message); break
      case 'preview': void preview(message); break
      case 'apply': void applyEffect(message); break
      case 'undo': undo(); break
      case 'reset': reset(); break
      default: break
    }
  }

  // ---- 注册贡献点 ----
  ctx.addToolbarAction({
    id: 'fx-open',
    label: 'FX Studio',
    run: () => openWindow()
  })
  ctx.addFileAction({
    id: 'fx-open-file',
    label: '用 FX Studio 处理',
    exts: ['.sai2', '.psd', '.png', '.jpg', '.jpeg', '.webp'],
    run: (payload) => {
      const file = typeof payload === 'string' ? payload : (payload && payload.path)
      openWindow(file)
    }
  })

  // 套件路径校验结果上报
  checkSuite()

  // 退出清理
  ctx.effect(() => {
    windowOpen = false
    liquify = null
    lastPreview = null
  })

  log.info(`${PLUGIN_ID} 已加载（v${config.version || '0.1.0'}）`)
}

module.exports = { apply, configSchema: require('./config-schema.js') }
