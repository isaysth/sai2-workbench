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
    include: ['tests/unit/**/*.test.ts']
  }
})
