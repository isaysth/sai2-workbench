/**
 * sai2_agent 命名管道客户端（JS 版，对应她的 AgentClient.h）。
 *
 * 协议（见上游 docs/SAI2Injection.md §4）：
 *   连接 \\.\pipe\sai2agent → 写一行 JSON + \n → 读一行 JSON（\n 结尾）→ 断开。
 *   服务端单实例串行，管道名在重建间隙会短暂消失，
 *   因此对 ENOENT / EBUSY / EPIPE 等做限时重试。
 *
 * Windows 命名管道在 Node 里就是 net.connect('\\\\.\\pipe\\sai2agent')。
 * 单测通过注入 connect 工厂完成，不需要真的起 SAI2。
 */
'use strict'

const net = require('node:net')

const DEFAULT_PIPE = '\\\\.\\pipe\\sai2agent'
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms))

/** 极简 JSON 字段读取（对应她的 JsonFindInt / JsonFindString） */
function jsonInt(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`))
  return m ? Number(m[1]) : null
}

function jsonString(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  if (!m) return null
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return m[1]
  }
}

/**
 * 解析 layers 响应里的 rows（含跨文档 tick 过滤）。
 * 本协议结构固定，正则足够，不做通用 JSON 解析。
 */
function parseLayerRows(text, tickWindowMs = 3000) {
  const rows = []
  const re = /\{"y":(-?\d+)[^}]*?"screenX":(-?\d+),"screenY":(-?\d+)[^}]*?"tick":(\d+)[^}]*?"text":"((?:[^"\\]|\\.)*)"\}/g
  let m
  while ((m = re.exec(text)) !== null) {
    let name = m[5]
    try {
      name = JSON.parse(`"${name}"`)
    } catch {
      /* 保留原样 */
    }
    rows.push({ y: Number(m[1]), screenX: Number(m[2]), screenY: Number(m[3]), tick: Number(m[4]), text: name })
  }
  if (rows.length === 0) return rows
  const newest = Math.max(...rows.map((r) => r.tick))
  return rows.filter((r) => newest - r.tick <= tickWindowMs)
}

/** 可重试的"服务端暂不可用"错误 */
function isRetryable(err) {
  const code = (err && err.code) || ''
  return ['ENOENT', 'EBUSY', 'EPIPE', 'ECONNRESET', 'ECONNREFUSED'].includes(code)
}

/** 一次连接：写命令 → 读一行 → 结束 */
function once(socket, command) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false
    const finish = (err, value) => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch { /* ignore */ }
      if (err) reject(err)
      else resolve(value || '')
    }

    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      const nl = buffer.indexOf('\n')
      if (nl >= 0) finish(null, buffer.slice(0, nl))
    })
    socket.on('error', (err) => finish(err))
    socket.on('close', () => {
      if (!settled) {
        // 有内容但没换行也接受（部分 agent 版本不带尾换行）
        if (buffer) finish(null, buffer)
        else finish(new Error('agent 连接提前关闭'))
      }
    })
    socket.on('connect', () => {
      socket.write(`${command}\n`, (err) => {
        if (err) finish(err)
      })
    })
  })
}

/**
 * 发一条命令，返回原始响应字符串。失败抛 Error。
 * opts: { pipeName, budgetMs=3000, connect(path)->Socket, sleep(ms)->Promise }
 */
async function query(command, opts = {}) {
  const pipeName = opts.pipeName || DEFAULT_PIPE
  const budget = Math.max(0, opts.budgetMs == null ? 3000 : opts.budgetMs)
  const sleep = opts.sleep || sleepReal
  const connect = opts.connect || ((path) => net.connect(path))
  const started = Date.now()

  for (;;) {
    try {
      return await once(connect(pipeName), command)
    } catch (err) {
      const elapsed = Date.now() - started
      if (!isRetryable(err) || elapsed >= budget) throw err
      await sleep(Math.min(30, budget - elapsed))
    }
  }
}

/** 高层封装：对应 AgentBridge.h 的 ping / layers / take.request / set.plugins */
async function ping(opts) {
  const text = await query('{"cmd":"ping"}', opts)
  return { ok: text.includes('"ok":true'), pid: jsonInt(text, 'pid') }
}

async function queryLayers(opts) {
  const raw = await query('{"cmd":"layers"}', opts)
  return { ok: raw.includes('"ok":true'), rows: parseLayerRows(raw), raw }
}

async function takeCategoryRequest(opts) {
  const raw = await query('{"cmd":"take.request"}', opts)
  if (raw.includes('"request":null')) return null
  const idx = jsonInt(raw, 'index')
  return idx && idx > 0 ? idx : null
}

async function pushCategories(items, opts) {
  const arr = items
    .map((it) => `{"i":${it.id},"g":${JSON.stringify(it.name)},"n":${JSON.stringify(it.name)}}`)
    .join(',')
  const raw = await query(`{"cmd":"set.plugins","items":[${arr}]}`, opts)
  return raw.includes('"ok":true')
}

module.exports = {
  DEFAULT_PIPE,
  query,
  ping,
  queryLayers,
  takeCategoryRequest,
  pushCategories,
  parseLayerRows,
  jsonInt,
  jsonString
}
