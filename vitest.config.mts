import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 单测只跑不依赖 Electron 的纯逻辑（容器、加载器）。
 * 别名与 electron.vite.config.ts 的 main 段保持一致。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // 当前环境的默认 worker 池会让 Vitest 5 的 runner 上下文丢失（所有 describe
    // 都报 “Cannot read properties of undefined (reading 'config')”）。
    // vmThreads 在独立 VM 上下文里跑纯逻辑单测，已验证 13 个文件全部通过。
    pool: 'vmThreads'
  }
})
