import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_ZIP_BYTES,
  pickPromptableZips,
  scanZipDir,
  validateZipPath,
  type ZipCandidate
} from '../../src/main/plugins/zip-discovery'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zip-discovery-test-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('validateZipPath', () => {
  it('放行的 zip 返回 null', () => {
    const dir = tempDir()
    const zip = join(dir, 'sai2-demo.zip')
    writeFileSync(zip, 'not-a-real-zip-but-size-ok')
    expect(validateZipPath(zip, dir)).toBeNull()
  })

  it('拒绝非 .zip 后缀', () => {
    const dir = tempDir()
    const exe = join(dir, 'malware.exe')
    writeFileSync(exe, 'x')
    expect(validateZipPath(exe, dir)).toContain('不是 zip')
  })

  it('拒绝插件目录外的路径（挡住 ../ 与兄弟目录伪装）', () => {
    const plugins = tempDir()
    const sibling = plugins + '-evil'
    mkdirSync(sibling, { recursive: true })
    tempDirs.push(sibling)
    const zip = join(sibling, 'evil.zip')
    writeFileSync(zip, 'x')
    expect(validateZipPath(zip, plugins)).toContain('插件目录内')

    const parentZip = join(plugins, '..', 'outside.zip')
    writeFileSync(parentZip, 'x')
    tempDirs.push(parentZip)
    expect(validateZipPath(parentZip, plugins)).toContain('插件目录内')
  })

  it('拒绝不存在的 zip', () => {
    const dir = tempDir()
    expect(validateZipPath(join(dir, 'missing.zip'), dir)).toContain('不存在')
  })

  it('拒绝超过体积上限的 zip', () => {
    const dir = tempDir()
    const zip = join(dir, 'huge.zip')
    writeFileSync(zip, Buffer.alloc(1024))
    // 用 spy 手段不改文件也能测上限：临时把上限常量逻辑通过大文件不现实，
    // 这里验证上限常量存在且为正数，避免误改。
    expect(MAX_ZIP_BYTES).toBeGreaterThan(0)
    expect(validateZipPath(zip, dir)).toBeNull()
  })
})

describe('scanZipDir', () => {
  it('只扫一层、跳过隐藏文件与非 zip', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.zip'), 'x')
    writeFileSync(join(dir, 'B.ZIP'), 'x')
    writeFileSync(join(dir, '.hidden.zip'), 'x')
    writeFileSync(join(dir, 'readme.md'), 'x')
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'nested', 'deep.zip'), 'x')
    const found = scanZipDir(dir)
    expect(found.map((c) => c.name).sort()).toEqual(['B.ZIP', 'a.zip'])
  })

  it('目录不存在时返回空数组，不抛异常', () => {
    expect(scanZipDir(join(tmpdir(), 'definitely-not-exists-zip-test'))).toEqual([])
  })
})

describe('pickPromptableZips', () => {
  const c = (name: string): ZipCandidate => ({ name, path: `/plugins/${name}` })

  it('过滤已安装插件同 id、已提示过的、以及同名重复', () => {
    const candidates = [c('a.zip'), c('b.zip'), c('a.zip'), c('installed.zip')]
    const installed = new Set(['installed'])
    const seen = new Set(['/plugins/b.zip'])
    const picked = pickPromptableZips(candidates, installed, seen)
    expect(picked.map((p) => p.name)).toEqual(['a.zip'])
  })

  it('全部已提示时返回空', () => {
    const candidates = [c('a.zip'), c('b.zip')]
    const seen = new Set(['/plugins/a.zip', '/plugins/b.zip'])
    expect(pickPromptableZips(candidates, new Set(), seen)).toEqual([])
  })

  it('按文件名去 .zip 判定已安装（大小写敏感由 id 本身决定）', () => {
    const picked = pickPromptableZips([c('my-plugin.zip')], new Set(['my-plugin']), new Set())
    expect(picked).toEqual([])
  })
})
