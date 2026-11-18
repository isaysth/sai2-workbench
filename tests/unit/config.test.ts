import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../src/main/config'
import type { Logger } from '../../src/main/logger'

function fakeLog(): Logger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger
}

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'config-migrate-test-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function writeConfig(dir: string, disabled: unknown): string {
  const cfg = {
    version: 2,
    general: { theme: 'glass', scheme: 'light', background: 'solid', backgroundImage: '' },
    plugins: { disabled, config: {} }
  }
  const file = join(dir, 'config.json')
  writeFileSync(file, JSON.stringify(cfg), 'utf8')
  return file
}

describe('内置插件合并的禁用名单迁移', () => {
  it('旧 opener id 映射到 openers，旧 thumb id 映射到 thumbs', () => {
    const dir = tempDir()
    const file = writeConfig(dir, ['opener-ps', 'thumb-sai2'])
    const store = new ConfigStore(dir, fakeLog())
    expect(store.get<string[]>('plugins.disabled')).toEqual(['openers', 'thumbs'])
    // 迁移已落盘，下次加载不再重复
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as { plugins: { disabled: string[] } }
    expect(persisted.plugins.disabled).toEqual(['openers', 'thumbs'])
  })

  it('组内多个旧 id 去重成一个新 id', () => {
    const dir = tempDir()
    writeConfig(dir, ['opener-sai2', 'opener-ps', 'opener-csp'])
    const store = new ConfigStore(dir, fakeLog())
    expect(store.get<string[]>('plugins.disabled')).toEqual(['openers'])
  })

  it('未涉及旧 id 的禁用名单原样保留', () => {
    const dir = tempDir()
    writeConfig(dir, ['some-other-plugin'])
    const store = new ConfigStore(dir, fakeLog())
    expect(store.get<string[]>('plugins.disabled')).toEqual(['some-other-plugin'])
  })

  it('非法非字符串条目被清理', () => {
    const dir = tempDir()
    writeConfig(dir, ['keep', 42, null])
    const store = new ConfigStore(dir, fakeLog())
    expect(store.get<string[]>('plugins.disabled')).toEqual(['keep'])
  })
})
