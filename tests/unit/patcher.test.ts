import { describe, expect, it } from 'vitest'
import {
  buildApplyScript,
  compareVersions,
  isAllowedPatchEntry,
  isPatchMetaEntry,
  parseChecksums,
  parsePatchInfo
} from '../../src/main/patcher'

const TOP = 'sai2工作台-0.3.1-增量升级包'

/** 一个跟 ship.mjs 产物同形的条目列表 */
function patchEntries(ver = '0.3.1'): string[] {
  const top = `sai2工作台-${ver}-增量升级包`
  return [
    `${top}/`,
    `${top}/resources/`,
    `${top}/resources/app.asar`,
    `${top}/resources/builtin-plugins/`,
    `${top}/resources/builtin-plugins/opener-sai2/index.js`,
    `${top}/SHA256SUMS.txt`,
    `${top}/升级说明.md`,
    `${top}/清理旧插件.bat`
  ]
}

describe('parsePatchInfo', () => {
  it('正常包能解析出顶层目录与三段式版本', () => {
    const info = parsePatchInfo(patchEntries())
    expect(info.topDir).toBe(TOP)
    expect(info.version).toBe('0.3.1')
    expect(info.entries).toHaveLength(8)
  })

  it('空条目列表直接拒绝', () => {
    expect(() => parsePatchInfo([])).toThrow(/空的/)
  })

  it('顶层目录名不合规时拒绝', () => {
    expect(() => parsePatchInfo(['sai2工作台-增量升级包/resources/app.asar'])).toThrow(/不是 sai2工作台/)
    expect(() => parsePatchInfo(['other-app/resources/app.asar'])).toThrow(/不是 sai2工作台/)
  })

  it('版本号不是三段式时拒绝', () => {
    expect(() => parsePatchInfo(['sai2工作台-0.3-增量升级包/resources/app.asar'])).toThrow(/不是 sai2工作台/)
    expect(() => parsePatchInfo(['sai2工作台-0.3.1.2-增量升级包/resources/app.asar'])).toThrow(
      /不是 sai2工作台/
    )
  })

  it('出现多个不同顶层目录时拒绝', () => {
    expect(() =>
      parsePatchInfo([`${TOP}/resources/app.asar`, 'sai2工作台-0.3.2-增量升级包/resources/app.asar'])
    ).toThrow(/多个顶层目录/)
  })

  it('条目穿越 .. 时拒绝', () => {
    expect(() => parsePatchInfo([`${TOP}/../data/index.db`])).toThrow(/不安全的路径/)
    expect(() => parsePatchInfo(['../evil.txt'])).toThrow(/不安全的路径/)
  })
})

describe('isAllowedPatchEntry', () => {
  it('放行 app.asar 与 builtin-plugins 下的文件', () => {
    expect(isAllowedPatchEntry(`${TOP}/resources/app.asar`, TOP)).toBe(true)
    expect(isAllowedPatchEntry(`${TOP}/resources/builtin-plugins/x/index.js`, TOP)).toBe(true)
    // 目录条目也要放行，否则解压时建目录会失败
    expect(isAllowedPatchEntry(`${TOP}/`, TOP)).toBe(true)
    expect(isAllowedPatchEntry(`${TOP}/resources/`, TOP)).toBe(true)
    expect(isAllowedPatchEntry(`${TOP}/resources/builtin-plugins/`, TOP)).toBe(true)
  })

  it('data / plugins / bat 一律拒绝', () => {
    for (const name of [
      `${TOP}/data/index.db`,
      `${TOP}/plugins/x.js`,
      `${TOP}/resources/kill.bat`,
      `${TOP}/resources/app.asar.bak-1`,
      `${TOP}/SHA256SUMS.txt`,
      `${TOP}/清理旧插件.bat`,
      `${TOP}/resourcesx/app.asar`
    ]) {
      expect(isAllowedPatchEntry(name, TOP)).toBe(false)
    }
  })

  it('别的顶层目录与前缀相邻的目录都拒绝', () => {
    expect(isAllowedPatchEntry('sai2工作台-0.3.2-增量升级包/resources/app.asar', TOP)).toBe(false)
    expect(isAllowedPatchEntry(`${TOP}-evil/resources/app.asar`, TOP)).toBe(false)
  })
})

describe('isPatchMetaEntry', () => {
  it('放行 ship.mjs 固定产出的三个顶层元数据文件（但不会落地）', () => {
    for (const name of [`${TOP}/SHA256SUMS.txt`, `${TOP}/升级说明.md`, `${TOP}/清理旧插件.bat`]) {
      expect(isPatchMetaEntry(name, TOP)).toBe(true)
      expect(isAllowedPatchEntry(name, TOP)).toBe(false)
    }
  })

  it('别的顶层文件与元数据同名但不在顶层的都拒绝', () => {
    expect(isPatchMetaEntry(`${TOP}/kill.bat`, TOP)).toBe(false)
    expect(isPatchMetaEntry(`${TOP}/resources/SHA256SUMS.txt`, TOP)).toBe(false)
    expect(isPatchMetaEntry(`other-app/SHA256SUMS.txt`, TOP)).toBe(false)
  })

  it('ship.mjs 实际产出的条目列表能整体过验收', () => {
    const info = parsePatchInfo(patchEntries())
    const bad = info.entries.filter(
      (n) => !isAllowedPatchEntry(n, info.topDir) && !isPatchMetaEntry(n, info.topDir)
    )
    expect(bad).toEqual([])
  })
})

describe('parseChecksums', () => {  const a = 'a'.repeat(64)
  const b = 'b'.repeat(64)

  it('解析 ship.mjs 实际产出的 `sha *path` 格式，兼容 \\r\\n', () => {
    const text = `${a} *resources/app.asar\r\n${b} *resources/builtin-plugins/x/index.js\r\n`
    expect(parseChecksums(text)).toEqual([
      { path: 'resources/app.asar', sha256: a },
      { path: 'resources/builtin-plugins/x/index.js', sha256: b }
    ])
  })

  it('两个空格分隔的写法也能读', () => {
    expect(parseChecksums(`${a.toUpperCase()}  resources/app.asar`)).toEqual([
      { path: 'resources/app.asar', sha256: a }
    ])
  })

  it('空行与 # 注释跳过', () => {
    const text = ['# 这是注释', '', `  ${a} *resources/app.asar  `, ''].join('\r\n')
    expect(parseChecksums(text)).toHaveLength(1)
  })

  it('格式错误或空清单抛错', () => {
    expect(() => parseChecksums('not-a-checksum  resources/app.asar')).toThrow(/格式不对/)
    expect(() => parseChecksums(`${a} *../escape.txt`)).toThrow(/不安全的路径/)
    expect(() => parseChecksums('\r\n\r\n')).toThrow(/空的/)
  })
})

describe('buildApplyScript', () => {
  const script = buildApplyScript({
    targetPid: 4242,
    patchDir: 'C:\\app\\.patch-20261118-120000',
    targetDir: 'C:\\app',
    exePath: 'C:\\app\\sai2工作台.exe',
    stamp: '20261118-120000'
  })

  it('参数名是 $targetPid，不出现 PowerShell 只读的 $pid', () => {
    expect(script).toContain('$targetPid')
    expect(script).not.toMatch(/\$pid\b/)
    // param 必须是第一句
    expect(script.startsWith('param(')).toBe(true)
  })

  it('等进程退出、拉起新版本', () => {
    expect(script).toContain('Get-Process -Id $targetPid')
    expect(script).toContain('Start-Process -FilePath $exePath')
  })

  it('覆盖前留底，catch 里用 backup 还原并写 failed', () => {
    expect(script).toContain('Copy-Item')
    expect(script).toContain("'backup'")
    expect(script).toContain('} catch {')
    expect(script).toContain("'failed: ' + $msg")
    expect(script).toContain("'ok'")
  })

  it('不往脚本里写死路径（路径全部走参数）', () => {
    expect(script).not.toContain('C:\\app')
  })
})

describe('compareVersions', () => {
  it('按段比较，缺位补 0', () => {
    expect(compareVersions('0.3.1', '0.3.0')).toBeGreaterThan(0)
    expect(compareVersions('0.3.1', '0.3.1')).toBe(0)
    expect(compareVersions('0.2.9', '0.3.1')).toBeLessThan(0)
    expect(compareVersions('1.0', '0.9.9')).toBeGreaterThan(0)
  })
})
