import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { candidateRoots, findInstallCandidates } from '../../src/main/openers/detect'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openers-detect-test-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** 造一棵和真实安装目录同构的假树，三个 exe 同名同层级 */
function installTree(): { programFiles: string; sai2: string; ps: string; csp: string } {
  const root = tempDir()
  const programFiles = join(root, 'Program Files')

  const saiDir = join(programFiles, 'PaintTool SAI')
  const sai2 = join(saiDir, 'sai2.exe')
  mkdirSync(saiDir, { recursive: true })
  writeFileSync(sai2, 'x')

  const psDir = join(programFiles, 'Adobe', 'Adobe Photoshop 2024')
  const ps = join(psDir, 'Photoshop.exe')
  mkdirSync(psDir, { recursive: true })
  writeFileSync(ps, 'x')

  const cspDir = join(programFiles, 'CELSYS', 'CLIP STUDIO 1.5', 'CLIP STUDIO PAINT')
  const csp = join(cspDir, 'CLIPStudioPaint.exe')
  mkdirSync(cspDir, { recursive: true })
  writeFileSync(csp, 'x')

  // 无关 exe，用来验证不会乱命中
  writeFileSync(join(programFiles, 'notepad.exe'), 'x')
  return { programFiles, sai2, ps, csp }
}

describe('findInstallCandidates', () => {
  it('按 exe 名分别命中 SAI2 / PS / CSP，互不串', () => {
    const t = installTree()
    expect(findInstallCandidates('sai2', [t.programFiles])).toEqual([t.sai2])
    expect(findInstallCandidates('ps', [t.programFiles])).toEqual([t.ps])
    expect(findInstallCandidates('csp', [t.programFiles])).toEqual([t.csp])
  })

  it('无关 exe 与错误后缀不会被命中', () => {
    const t = installTree()
    const forPs = findInstallCandidates('ps', [t.programFiles])
    expect(forPs).not.toContain(t.sai2)
    expect(forPs.some((p) => p.toLowerCase().endsWith('notepad.exe'))).toBe(false)
    expect(findInstallCandidates('sai2', [t.programFiles]).some((p) => p.endsWith('Photoshop.exe'))).toBe(false)
  })

  it('目录不存在时返回空数组且不抛异常', () => {
    expect(findInstallCandidates('ps', [join(tmpdir(), 'definitely-not-exist-openers-detect')])).toEqual([])
    expect(findInstallCandidates('csp', [])).toEqual([])
  })

  it('超过最大深度不再往下找', () => {
    const root = tempDir()
    const tooDeep = join(root, 'a', 'b', 'c', 'd', 'e')
    mkdirSync(tooDeep, { recursive: true })
    writeFileSync(join(tooDeep, 'Photoshop.exe'), 'x')
    expect(findInstallCandidates('ps', [root])).toEqual([])
  })

  it('跳过 node_modules 等无关目录', () => {
    const root = tempDir()
    const nested = join(root, 'node_modules', 'some-pkg')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'sai2.exe'), 'x')
    expect(findInstallCandidates('sai2', [root])).toEqual([])
  })
})

describe('candidateRoots', () => {
  it('从环境变量派生根目录并保留顺序', () => {
    const base = tempDir()
    const programFiles = join(base, 'Program Files')
    const programFilesX86 = join(base, 'Program Files (x86)')
    const localAppData = join(base, 'Local')
    const drive = join(base, 'Drive')
    for (const d of [programFiles, programFilesX86, localAppData, drive]) {
      mkdirSync(d, { recursive: true })
    }

    const roots = candidateRoots({
      ProgramFiles: programFiles,
      'ProgramFiles(x86)': programFilesX86,
      LOCALAPPDATA: localAppData,
      SystemDrive: drive
    })
    expect(roots).toEqual([programFiles, programFilesX86, localAppData, `${drive}\\`])
  })

  it('过滤不存在的目录', () => {
    const base = tempDir()
    const roots = candidateRoots({
      ProgramFiles: join(base, 'missing-1'),
      'ProgramFiles(x86)': join(base, 'missing-2'),
      LOCALAPPDATA: join(base, 'missing-3'),
      SystemDrive: join(base, 'missing-4')
    })
    expect(roots).toEqual([])
  })

  it('大小写与末尾分隔符不同视为同一个根，只保留一个', () => {
    const base = tempDir()
    const programFiles = join(base, 'Program Files')
    mkdirSync(programFiles, { recursive: true })

    const roots = candidateRoots({
      ProgramFiles: programFiles,
      // Windows 路径大小写不敏感；在大小写敏感的系统上这个目录不存在，会被自然过滤
      'ProgramFiles(x86)': programFiles.toUpperCase(),
      LOCALAPPDATA: `${programFiles}\\`,
      SystemDrive: join(base, 'missing-drive')
    })
    expect(roots).toHaveLength(1)
    expect(roots[0]!.toLowerCase()).toBe(programFiles.toLowerCase())
  })
})
