import { nativeTheme } from 'electron'
import { release } from 'node:os'

/**
 * 平台能力检测。
 * DWM 毛玻璃要求 Windows 11 22H2+，即 build >= 22000。
 *
 * 注意：当前渲染**不依赖**这个能力 —— 玻璃效果全部由 CSS 自绘，
 * 窗口只用 `transparent: true`。这里保留检测是为了两件事：
 *   1. 状态栏与「关于」里显示系统信息；
 *   2. M3 若引入 FFI 做「真·背景桌面模糊」，需要按 Win10/Win11 分支。
 */
export interface PlatformCapability {
  windowsBuild: number
  acrylicSupported: boolean
}

export function detectCapability(): PlatformCapability {
  if (process.platform !== 'win32') {
    return { windowsBuild: 0, acrylicSupported: false }
  }
  let build = 0
  try {
    const parts = release().split('.')      // 形如 10.0.26200
    build = Number.parseInt(parts[2] ?? '0', 10) || 0
  } catch {
    build = 0
  }
  return { windowsBuild: build, acrylicSupported: build >= 22000 }
}

/**
 * 让原生控件的明暗跟随应用外观。
 *
 * 为什么还要做：窗口虽然全自绘，但系统右键菜单、原生文件对话框、滚动条
 * 这些仍在系统手里。不显式设置的话，「深色外观 + 系统浅色」会弹出白色菜单，
 * 一眼就露馅。
 *
 * 入参是 **scheme（light / dark）**，不是 theme（glass / minimal）——
 * 风格和明暗是两个维度，原生层只关心后者。
 */
export function applyNativeTheme(theme: string): void {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light'
}
