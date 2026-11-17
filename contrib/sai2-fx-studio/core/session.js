/**
 * 处理会话（JS 版，对应 BridgeCore 的状态管理）。
 *
 * 数据模型（对齐上游）：
 *   original_  本次抓到的原图（全分辨率，画质基准）
 *   applied_   当前"已应用"结果（全分辨率，就是要贴回 SAI2 的内容）
 *   preview_   降采样预览图（拖参数时跑它，保证流畅）
 *   撤销 = applied_ 快照栈，按字节预算（避免大画布 OOM）
 */
'use strict'

const { ImageBuffer } = require('./image.js')

const HISTORY_BUDGET_BYTES = 512 * 1024 * 1024
const HISTORY_MAX_DEPTH = 20
const HISTORY_MIN_DEPTH = 3
const DEFAULT_PREVIEW_MAX_DIM = 900

class Session {
  constructor(opts = {}) {
    this.previewMaxDim = opts.previewMaxDim || DEFAULT_PREVIEW_MAX_DIM
    this.original = null
    this.applied = null
    this.preview = null
    this.previewScale = 1
    this.params = {}
    this.effectId = ''
    this.history = []
    this.historyBytes = 0
  }

  /** 载入一张新抓到的图，清空历史 */
  setImage(image) {
    if (!(image instanceof ImageBuffer)) throw new Error('setImage 需要 ImageBuffer')
    this.original = image.clone()
    this.applied = image.clone()
    this.history = []
    this.historyBytes = 0
    this.rebuildPreview()
  }

  hasImage() {
    return !!this.original
  }

  setEffect(id, defaults = {}) {
    this.effectId = id
    this.params = { ...defaults }
  }

  setParam(key, value) {
    this.params[key] = value
  }

  getParam(key, fallback) {
    return key in this.params ? this.params[key] : fallback
  }

  /** 重建降采样预览基准 */
  rebuildPreview() {
    if (!this.applied) return
    this.preview = this.applied.downsample(this.previewMaxDim)
    this.previewScale = this.preview.width / this.applied.width
  }

  /** 提交全分辨率结果：压入撤销栈，更新 applied 与预览 */
  apply(result, label = 'apply') {
    if (!(result instanceof ImageBuffer)) throw new Error('apply 需要 ImageBuffer')
    this.pushHistory()
    this.applied = result.clone()
    this.rebuildPreview()
    return this.applied
  }

  pushHistory() {
    if (!this.applied) return
    const snap = this.applied.clone()
    const bytes = snap.data.byteLength
    this.history.push({ image: snap, label: `snapshot-${this.history.length}`, bytes })
    this.historyBytes += bytes
    // 先按最大深度裁，再按字节预算裁（至少留 MIN_DEPTH 张）
    while (this.history.length > HISTORY_MAX_DEPTH) {
      const old = this.history.shift()
      this.historyBytes -= old.bytes
    }
    while (this.historyBytes > HISTORY_BUDGET_BYTES && this.history.length > HISTORY_MIN_DEPTH) {
      const old = this.history.shift()
      this.historyBytes -= old.bytes
    }
  }

  canUndo() {
    return this.history.length > 0
  }

  /** 撤销到上一个已应用状态；返回是否成功 */
  undo() {
    const snap = this.history.pop()
    if (!snap) return false
    this.historyBytes -= snap.bytes
    this.applied = snap.image
    this.rebuildPreview()
    return true
  }

  /** 复位到原图（历史也清空） */
  reset() {
    if (!this.original) return
    this.applied = this.original.clone()
    this.history = []
    this.historyBytes = 0
    this.rebuildPreview()
  }

  /** 当前进程要处理的输入图（全分辨率） */
  fullBase() {
    return this.applied
  }

  /** 当前预览输入图（降采样） */
  previewBase() {
    return this.preview
  }

  /** 预览图 → 全分辨率坐标的倍率 */
  scale() {
    return this.previewScale
  }
}

module.exports = { Session, HISTORY_BUDGET_BYTES, HISTORY_MAX_DEPTH }
