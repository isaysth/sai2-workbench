/**
 * 生成 M2b 性能基线用的 5000 个稿件（Node 直接运行）。
 *
 *   node tests/fixtures/make-5000.mjs            # 生成到 tests/perf5000
 *   node tests/fixtures/make-5000.mjs --clean    # 删除
 *
 * 用 copyFile 复制一份只有 5KB 的真实 sai2（有 jssf 缩略图），
 * 5000 份约 24MB —— 足够压索引与列表，又不会把磁盘塞满。
 * 文件名带 4 位序号，修改时间故意错开，方便按时间筛选用例。
 */
import { copyFile, mkdir, readdir, rm, utimes } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '..', 'perf5000')
const source = join(here, '纯白画布256.sai2')
const total = 5000
const perDir = 500

if (process.argv.includes('--clean')) {
  await rm(target, { recursive: true, force: true })
  console.log(`已删除 ${target}`)
  process.exit(0)
}

for (let d = 0; d < Math.ceil(total / perDir); d += 1) {
  await mkdir(join(target, `批次${String(d + 1).padStart(2, '0')}`), { recursive: true })
}

let made = 0
const base = Date.now() - total * 60_000
for (let dir = 0; dir < Math.ceil(total / perDir); dir += 1) {
  const folder = join(target, `批次${String(dir + 1).padStart(2, '0')}`)
  for (let i = 0; i < perDir && made < total; i += 1) {
    const seq = String(made + 1).padStart(5, '0')
    const file = join(folder, `稿件-${seq}.sai2`)
    await copyFile(source, file)
    const ts = base + made * 60_000
    await utimes(file, new Date(ts), new Date(ts))
    made += 1
  }
}

const count = (await readdir(target, { recursive: true })).filter((f) => f.endsWith('.sai2')).length
console.log(`已生成 ${count} 个文件：${target}`)
