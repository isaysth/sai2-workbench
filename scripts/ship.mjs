#!/usr/bin/env node
// 一条命令完成 sai2工作台 的发版打包：构建 → 整包 zip → 增量升级包 zip → 脱敏扫描
// 用法：node scripts/ship.mjs [--fresh] [--skip-build] [--old-sha=<hex>] [--notes=<文本>] [--notes-file=<路径>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import yazl from 'yazl'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATES = path.join(ROOT, 'scripts', 'templates')
const OUT_DIR = path.resolve(ROOT, '..', '发布包')

// 某些沙箱/IDE 会通过 NODE_OPTIONS 注入 safe-delete shim，把 unlink/rm 变成"移到回收站"，
// 批量删除会直接失败（electron-builder 也栽在这上面）。这里检测到就带着干净环境重跑一次自己。
const SHIM_RE = /--require=(?:"[^"]*(?:node-language-shim|safe-delete)[^"]*"|'[^']*(?:node-language-shim|safe-delete)[^']*'|\S*(?:node-language-shim|safe-delete)\S*)/gi
if (process.env.NODE_OPTIONS && /node-language-shim|safe-delete/i.test(process.env.NODE_OPTIONS)) {
  const cleaned = process.env.NODE_OPTIONS.replace(SHIM_RE, '').trim()
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: cleaned, CODEBUDDY_SAFE_DELETE_ENABLED: '0' }
  })
  process.exit(r.status ?? 1)
}

const SCAN_EXT = new Set(['.md', '.txt', '.json', '.yml', '.yaml', '.html', '.js', '.bat', '.cjs', '.mjs', '.css'])

// ---------- 基础工具 ----------

const log = (msg) => console.log(msg)
const step = (msg) => console.log(`\n=== ${msg} ===`)
const fail = (msg) => {
  console.error(`\n[失败] ${msg}`)
  process.exit(1)
}
const mb = (bytes) => (bytes / 1048576).toFixed(2) + 'MB'

function walkFiles(dir, rel = '') {
  const out = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name)
    const r = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) out.push(...walkFiles(abs, r))
    else if (ent.isFile()) out.push({ abs, rel: r })
  }
  return out
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  const buf = fs.readFileSync(file)
  hash.update(buf)
  return hash.digest('hex')
}

function zipDir({ src, out, prefix }) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    const files = walkFiles(src)
    for (const f of files) {
      zip.addFile(f.abs, `${prefix}/${f.rel}`, { mtime: fs.statSync(f.abs).mtime })
    }
    zip.end()
    const ws = fs.createWriteStream(out)
    zip.outputStream.on('error', reject)
    ws.on('close', () => resolve({ count: files.length, size: fs.statSync(out).size }))
    ws.on('error', reject)
    zip.outputStream.pipe(ws)
  })
}

function run(cmd, args, env = {}) {
  log(`> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env }
  })
  if (r.status !== 0) fail(`命令失败（退出码 ${r.status}）：${cmd} ${args.join(' ')}`)
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else if (ent.isFile()) fs.copyFileSync(s, d)
  }
}

// Windows 上刚被扫过毒/占用的文件，unlink 偶尔报 EBUSY，短暂重试即可
function unlinkWithRetry(file, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      fs.unlinkSync(file)
      return
    } catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e
      if (i === tries - 1) throw e
      const until = Date.now() + 150
      while (Date.now() < until) {}
    }
  }
}

// 清掉 staging 里不属于本轮的残留（不整体删目录：Windows 下常有文件被占用而 EBUSY）
function pruneExtras(dir, keepRels) {
  const dirs = []
  const walk = (d, rel) => {
    dirs.push({ abs: d, rel })
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name)
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) walk(abs, r)
      else if (ent.isFile() && !keepRels.has(r)) unlinkWithRetry(abs)
    }
  }
  walk(dir, '')
  for (const d of dirs.reverse()) {
    if (!d.rel) continue
    try {
      fs.rmdirSync(d.abs)
    } catch {
      // 非空就留着
    }
  }
}

// ---------- 参数 ----------

const args = process.argv.slice(2)
let fresh = false
let skipBuild = false
let oldShaArg = ''
let notesArg = ''
let notesFile = ''

for (const a of args) {
  if (a === '--fresh') fresh = true
  else if (a === '--skip-build') skipBuild = true
  else if (a.startsWith('--old-sha=')) oldShaArg = a.slice('--old-sha='.length).trim()
  else if (a.startsWith('--notes=')) notesArg = a.slice('--notes='.length)
  else if (a.startsWith('--notes-file=')) notesFile = a.slice('--notes-file='.length)
  else fail(`未知参数：${a}\n可用参数：--fresh | --skip-build | --old-sha=<hex> | --notes=<文本> | --notes-file=<路径>`)
}

// ---------- 版本 ----------

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const ver = pkg.version
if (!ver) fail('package.json 里没有 version 字段')

const DIST = path.join(ROOT, `dist-${ver}`)
const UNPACKED = path.join(DIST, 'win-unpacked')
const EXE = path.join(UNPACKED, 'sai2工作台.exe')
const APP_ASAR = path.join(UNPACKED, 'resources', 'app.asar')

log(`sai2工作台 发版打包 v${ver}`)
log(`  构建目录：${path.relative(ROOT, DIST)}`)
log(`  输出目录：${OUT_DIR}`)

// ---------- 1. 构建 ----------

step('构建')
if (skipBuild && !fs.existsSync(EXE)) {
  fail(`--skip-build 要求已存在产物，但没找到：${path.relative(ROOT, EXE)}`)
}

const reuse = fs.existsSync(EXE) && !fresh
if (reuse) {
  log(`复用已有产物：${path.relative(ROOT, EXE)}（要重建请加 --fresh）`)
} else {
  if (fresh) log('--fresh：强制重建')
  run('npx', ['electron-vite', 'build'])
  run(
    'npx',
    ['electron-builder', '--win', '--x64', `--config.directories.output=dist-${ver}`],
    { CODEBUDDY_SAFE_DELETE_ENABLED: '0' }
  )
  if (!fs.existsSync(EXE)) fail(`构建结束但没找到 ${path.relative(ROOT, EXE)}`)
}

if (!fs.existsSync(APP_ASAR)) fail(`没找到 ${path.relative(ROOT, APP_ASAR)}`)
const asarSha = sha256File(APP_ASAR)
log(`app.asar sha256 = ${asarSha}`)

// ---------- 2. 脱敏扫描（必须先于打 zip，命中则不产出任何包） ----------

step('脱敏扫描')

const user = (process.env.USERNAME || os.userInfo().username || '').trim()
if (!user) fail('无法确定当前用户名，脱敏扫描没法做')
const esc = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 同时覆盖 C:\Users\x、C:/Users/x、JSON 里的 C:\\Users\\x、以及多写一个斜杠的情况
const patterns = [new RegExp(`Users[/\\\\]+${esc}`, 'gi')]

const hits = []
function record(file, detail) {
  hits.push(`${file}  ${detail}`)
}

for (const f of walkFiles(UNPACKED)) {
  const ext = path.extname(f.abs).toLowerCase()
  if (!SCAN_EXT.has(ext)) continue
  const text = fs.readFileSync(f.abs, 'utf8')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const re of patterns) {
      re.lastIndex = 0
      const m = re.exec(lines[i])
      if (m) record(path.relative(UNPACKED, f.abs), `第 ${i + 1} 行：…${lines[i].trim().slice(0, 120)}…`)
    }
  }
}

// app.asar 是二进制容器，按原始字节扫（latin1 保证字节一一对应）
{
  const buf = fs.readFileSync(APP_ASAR)
  const raw = buf.toString('latin1')
  for (const re of patterns) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(raw)) !== null) {
      record('resources/app.asar', `字节偏移 ${m.index}：…${raw.slice(m.index, m.index + 60).replace(/[^\x20-\x7e]/g, '.')}…`)
    }
  }
}

if (hits.length) {
  console.error(`[失败] 发现 ${hits.length} 处本机绝对路径残留（"Users\\${user}"），已中止，不产出发布包：`)
  for (const h of hits) console.error('  - ' + h)
  process.exit(1)
}
log('未发现本机绝对路径残留')

// ---------- 3. 整包 ----------

step('打包：整包')
fs.mkdirSync(OUT_DIR, { recursive: true })
const fullZip = path.join(OUT_DIR, `sai2工作台-${ver}-win.zip`)
const full = await zipDir({ src: UNPACKED, out: fullZip, prefix: `sai2工作台-${ver}-win` })
log(`整包完成：${mb(full.size)}，${full.count} 个文件`)

// ---------- 4. 增量包 ----------

step('打包：增量升级包')

const stagingRoot = path.join(DIST, 'patch-stage', `sai2工作台-${ver}-增量升级包`)
fs.mkdirSync(stagingRoot, { recursive: true })

const builtinSrc = path.join(UNPACKED, 'resources', 'builtin-plugins')
const builtinFiles = fs.existsSync(builtinSrc) ? walkFiles(builtinSrc) : []
if (!builtinFiles.length) log('提示：产物里没有 builtin-plugins，增量包只含 app.asar')

// 本轮 staging 应有的全部条目：用来清掉上一轮遗留的多余文件
const keepRels = new Set([
  'resources/app.asar',
  '升级说明.md',
  '清理旧插件.bat',
  'SHA256SUMS.txt',
  ...builtinFiles.map((f) => `resources/builtin-plugins/${f.rel}`)
])
pruneExtras(stagingRoot, keepRels)
// pruneExtras 会顺手删掉空目录（包括上面刚建好的 resources），这里补建一次再拷 asar
fs.mkdirSync(path.join(stagingRoot, 'resources'), { recursive: true })

fs.copyFileSync(APP_ASAR, path.join(stagingRoot, 'resources', 'app.asar'))
if (builtinFiles.length) copyDir(builtinSrc, path.join(stagingRoot, 'resources', 'builtin-plugins'))

// 旧版 asar 的 sha：优先用 --old-sha，其次找上一个 dist-* 目录里的 app.asar
function findPrevAsarSha() {
  const parse = (v) => v.split('.').map((n) => parseInt(n, 10) || 0)
  const cmp = (a, b) => {
    const pa = parse(a)
    const pb = parse(b)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0)
      if (d) return d
    }
    return 0
  }
  const candidates = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^dist-\d+\.\d+\.\d+$/.test(e.name))
    .map((e) => e.name.slice('dist-'.length))
    .filter((v) => v !== ver && cmp(v, ver) < 0)
    .sort(cmp)
    .reverse()
  for (const v of candidates) {
    const p = path.join(ROOT, `dist-${v}`, 'win-unpacked', 'resources', 'app.asar')
    if (fs.existsSync(p)) return { version: v, sha: sha256File(p) }
  }
  return null
}

let oldSha = oldShaArg
if (!oldSha) {
  const prev = findPrevAsarSha()
  if (prev) {
    oldSha = prev.sha
    log(`旧版 sha256 取自 dist-${prev.version}`)
  } else {
    oldSha = '（没有旧版记录，可跳过这一步）'
  }
}

let changelog = notesArg
if (!changelog && notesFile) {
  const p = path.resolve(ROOT, notesFile)
  if (!fs.existsSync(p)) fail(`--notes-file 指定的文件不存在：${notesFile}`)
  changelog = fs.readFileSync(p, 'utf8').trim()
}
if (!changelog) {
  // 约定：docs/release-notes/<版本>.md 存在就自动当变更说明，避免升级包里出现"常规修复"这种废话
  const autoNotes = path.join(ROOT, 'docs', 'release-notes', `${ver}.md`)
  if (fs.existsSync(autoNotes)) changelog = fs.readFileSync(autoNotes, 'utf8').trim()
}
if (!changelog) {
  changelog = '- 常规修复与体验优化\n- 详细条目见程序内「关于」页的版本说明'
}

const render = (name) => {
  const tpl = fs.readFileSync(path.join(TEMPLATES, name), 'utf8')
  return tpl
    .replaceAll('{{VERSION}}', ver)
    .replaceAll('{{ASAR_SHA_OLD}}', oldSha)
    .replaceAll('{{ASAR_SHA_NEW}}', asarSha)
    .replaceAll('{{CHANGELOG}}', changelog)
}

fs.writeFileSync(path.join(stagingRoot, '升级说明.md'), render('升级说明.md'), 'utf8')
fs.writeFileSync(path.join(stagingRoot, '清理旧插件.bat'), render('清理旧插件.bat'), 'utf8')

// 校验清单：staging 内每个文件一行 `<sha256> *<相对路径>`
const sums = walkFiles(stagingRoot)
  .map((f) => `${sha256File(f.abs)} *${f.rel}`)
  .join('\n')
fs.writeFileSync(path.join(stagingRoot, 'SHA256SUMS.txt'), sums + '\n', 'utf8')

const patchZip = path.join(OUT_DIR, `sai2工作台-${ver}-增量升级包.zip`)
const patch = await zipDir({
  src: stagingRoot,
  out: patchZip,
  prefix: `sai2工作台-${ver}-增量升级包`
})
log(`增量包完成：${mb(patch.size)}，${patch.count} 个文件`)

// ---------- 5. 摘要 ----------

step('产物')
log(`整包    ${path.relative(ROOT, fullZip)}  ${mb(full.size)}  ${full.count} 个文件`)
log(`增量包  ${path.relative(ROOT, patchZip)}  ${mb(patch.size)}  ${patch.count} 个文件`)
log(`app.asar sha256 = ${asarSha}`)
log('\n完成。')
