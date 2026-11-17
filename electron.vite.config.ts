import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * 三端构建配置：main / preload / renderer 各自独立编译。
 * 别名统一用 @shared，避免主进程与渲染进程跨目录引用时写一长串相对路径。
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // 多入口：thumb.worker 要单独产出一个文件，主进程用 worker_threads 加载它
        // （PSD 解码放线程里，避免大文件把主进程卡住）
        input: {
          index: resolve('src/main/index.ts'),
          'thumb.worker': resolve('src/main/thumbs/thumb.worker.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // 插件浮窗用独立的 preload，只暴露消息桥，不暴露工作台完整 api
        input: {
          index: resolve('src/preload/index.ts'),
          'plugin-window': resolve('src/preload/plugin-window.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
