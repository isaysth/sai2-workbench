import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import {
  createBackup,
  isAllowedBackupEntry,
  planBackupEntries,
  readBackupManifest,
  restoreBackup
} from '../../src/main/backup'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'backup-test-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** 造一个"像用户装过一阵子"的数据目录 */
function seedBase(): string {
  const base = tempDir()
  mkdirSync(join(base, 'data', 'backgrounds'), { recursive: true })
  mkdirSync(join(base, 'data', 'logs'), { recursive: true })
  mkdirSync(join(base, 'data', 'cache', 'thumbs'), { recursive: true })
  mkdirSync(join(base, 'plugins', 'demo'), { recursive: true })

  writeFileSync(join(base, 'data', 'config.json'), '{"general":{"theme":"glass"}}', 'utf8')
  writeFileSync(join(base, 'data', 'index.db'), 'fake-db', 'utf8')
  writeFileSync(join(base, 'data', 'backgrounds', 'bg.png'), 'fake-png', 'utf8')
  writeFileSync(join(base, 'data', 'logs', 'app.log'), 'noise', 'utf8')
  writeFileSync(join(base, 'data', 'cache', 'thumbs', 'ab12.png'), 'cache', 'utf8')
  writeFileSync(join(base, 'plugins', 'demo', 'plugin.json'), '{"id":"demo"}', 'utf8')
  return base
}

function dataOf(base: string): string {
  return join(base, 'data')
}
function pluginsOf(base: string): string {
  return join(base, 'plugins')
}

/** 用 yazl 拼一个任意内容的 zip，给"不是备份"的负例用 */
function makeZip(zipPath: string, files: Record<string, string>): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const [name, content] of Object.entries(files)) {
    zip.addBuffer(Buffer.from(content, 'utf8'), name)
  }
  zip.end()
  return new Promise<void>((resolve, reject) => {
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zip.outputStream.on('error', reject)
    zip.outputStream.on('end', () => {
      writeFileSync(zipPath, Buffer.concat(chunks))
      resolve()
    })
  })
}

describe('isAllowedBackupEntry', () => {
  it('放行备份自己会产出的条目', () => {
    for (const name of [
      'manifest.json',
      'data/config.json',
      'data/index.db',
      'data/index.db-wal',
      'data/index.db-shm',
      'data/backgrounds/bg.png',
      'plugins/demo/plugin.json'
    ]) {
      expect(isAllowedBackupEntry(name)).toBe(true)
    }
  })

  it('挡住缓存、日志与相邻前缀', () => {
    for (const name of [
      'data/logs/app.log',
      'data/cache/thumbs/ab12.png',
      'data/other.json',
      'pluginsx/a.json',
      'run.bat'
    ]) {
      expect(isAllowedBackupEntry(name)).toBe(false)
    }
  })
})

describe('planBackupEntries', () => {
  it('收配置 / 索引库 / 背景图 / 用户插件，跳过缓存与日志', () => {
    const base = seedBase()
    const names = planBackupEntries(dataOf(base), pluginsOf(base)).map((e) => e.name).sort()
    expect(names).toEqual([
      'data/backgrounds/bg.png',
      'data/config.json',
      'data/index.db',
      'plugins/demo/plugin.json'
    ])
  })

  it('目录不存在时不报错，只返回已有的', () => {
    const base = tempDir()
    expect(planBackupEntries(dataOf(base), pluginsOf(base))).toEqual([])
  })
})

describe('createBackup + readBackupManifest', () => {
  it('打出的包能被读回，manifest 带统计与时间', async () => {
    const base = seedBase()
    const zipPath = join(base, 'backup.zip')
    const manifest = await createBackup({
      zipPath,
      dataDir: dataOf(base),
      pluginDir: pluginsOf(base),
      appVersion: '0.2.0',
      counts: { files: 3, tags: 2, projects: 1 },
      now: new Date('2026-11-18T01:55:00.000Z')
    })

    expect(manifest.entries).toBe(4)
    expect(manifest.bytes).toBeGreaterThan(0)

    const read = await readBackupManifest(zipPath)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.appVersion).toBe('0.2.0')
    expect(read.value.counts).toEqual({ files: 3, tags: 2, projects: 1 })
    expect(read.value.createdAt).toBe('2026-11-18T01:55:00.000Z')
  })

  it('不是备份的 zip 会被拒绝', async () => {
    const base = seedBase()
    const zipPath = join(base, 'random.zip')
    await makeZip(zipPath, { 'data/config.json': '{}' })
    const read = await readBackupManifest(zipPath)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('manifest.json')
  })

  it('来自更新格式版本的备份会被拒绝', async () => {
    const base = seedBase()
    const zipPath = join(base, 'future.zip')
    await makeZip(zipPath, {
      'manifest.json': JSON.stringify({ kind: 'data-backup', format: 99, appVersion: '9.9.9' })
    })
    const read = await readBackupManifest(zipPath)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('更新的版本')
  })

  it('manifest 损坏时报错而不是抛异常', async () => {
    const base = seedBase()
    const zipPath = join(base, 'broken.zip')
    await makeZip(zipPath, { 'manifest.json': '{not json' })
    const read = await readBackupManifest(zipPath)
    expect(read.ok).toBe(false)
  })
})

describe('restoreBackup', () => {
  it('恢复备份内容，并把现有数据改名留底', async () => {
    const source = seedBase()
    const zipPath = join(source, 'backup.zip')
    await createBackup({
      zipPath,
      dataDir: dataOf(source),
      pluginDir: pluginsOf(source),
      appVersion: '0.2.0',
      counts: { files: 3, tags: 2, projects: 1 }
    })

    // 目标机器：配置和插件都不一样
    const target = tempDir()
    mkdirSync(dataOf(target), { recursive: true })
    mkdirSync(pluginsOf(target), { recursive: true })
    writeFileSync(join(dataOf(target), 'config.json'), '{"general":{"theme":"minimal"}}', 'utf8')
    writeFileSync(join(dataOf(target), 'index.db'), 'old-db', 'utf8')

    const result = await restoreBackup({
      zipPath,
      dataDir: dataOf(target),
      pluginDir: pluginsOf(target),
      stamp: '20261118-095500'
    })

    expect(result.asideSuffix).toBe('.bak-20261118-095500')

    // 备份内容回来了
    expect(readFileSync(join(dataOf(target), 'config.json'), 'utf8')).toBe(
      '{"general":{"theme":"glass"}}'
    )
    expect(readFileSync(join(dataOf(target), 'index.db'), 'utf8')).toBe('fake-db')
    expect(existsSync(join(dataOf(target), 'backgrounds', 'bg.png'))).toBe(true)
    expect(existsSync(join(pluginsOf(target), 'demo', 'plugin.json'))).toBe(true)

    // 旧数据留底，没被删
    expect(readFileSync(join(dataOf(target), 'config.json.bak-20261118-095500'), 'utf8')).toBe(
      '{"general":{"theme":"minimal"}}'
    )
    expect(readFileSync(join(dataOf(target), 'index.db.bak-20261118-095500'), 'utf8')).toBe('old-db')

    // 缓存与日志不在备份里，恢复后不该凭空出现
    expect(existsSync(join(dataOf(target), 'cache'))).toBe(false)
  })

  it('备份里只有配置时，也会把 backgrounds / plugins 目录补回来', async () => {
    const source = tempDir()
    mkdirSync(dataOf(source), { recursive: true })
    writeFileSync(join(dataOf(source), 'config.json'), '{"a":1}', 'utf8')
    const zipPath = join(source, 'partial.zip')
    await createBackup({
      zipPath,
      dataDir: dataOf(source),
      pluginDir: pluginsOf(source),
      appVersion: '0.2.0',
      counts: { files: 0, tags: 0, projects: 0 }
    })

    const target = tempDir()
    mkdirSync(dataOf(target), { recursive: true })
    await restoreBackup({
      zipPath,
      dataDir: dataOf(target),
      pluginDir: pluginsOf(target),
      stamp: '20261118-100000'
    })

    expect(existsSync(join(dataOf(target), 'config.json'))).toBe(true)
    expect(existsSync(join(dataOf(target), 'backgrounds'))).toBe(true)
    expect(existsSync(join(pluginsOf(target)))).toBe(true)
  })

  it('包里有白名单外的条目就整体拒绝，不动现有数据', async () => {
    const badZip = join(tempDir(), 'evil.zip')
    await makeZip(badZip, { 'manifest.json': '{}', 'data/logs/app.log': 'x' })

    const target = tempDir()
    mkdirSync(dataOf(target), { recursive: true })
    writeFileSync(join(dataOf(target), 'config.json'), '{"keep":true}', 'utf8')

    await expect(
      restoreBackup({
        zipPath: badZip,
        dataDir: dataOf(target),
        pluginDir: pluginsOf(target),
        stamp: '20261118-100500'
      })
    ).rejects.toThrow(/不允许的路径/)

    expect(readFileSync(join(dataOf(target), 'config.json'), 'utf8')).toBe('{"keep":true}')
    expect(existsSync(join(dataOf(target), 'config.json.bak-20261118-100500'))).toBe(false)
  })
})
