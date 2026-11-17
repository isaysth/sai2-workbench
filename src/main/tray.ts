/**
 * Electron 托盘适配层。
 *
 * 只在这里 import electron 的 Tray / Menu / nativeImage —— 窗口管理器的纯逻辑
 * 不碰这些运行时对象，单测里注入一个假的 TrayHandle 就能覆盖全部行为。
 */
import { Menu, Tray, nativeImage, app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface TrayMenuItem {
  id: string
  label: string
  disabled?: boolean
  separator?: boolean
}

export interface TrayHandle {
  setItems: (items: TrayMenuItem[], tooltip?: string) => void
  destroy: () => void
}

export interface TrayHandlers {
  onActivate: () => void
  onCommand: (id: string) => void
}

function resolveIcon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
}

/** 图标读不到 / 解码失败时返回 null，调用方按「无托盘能力」降级，不能崩 */
export function createNativeTray(handlers: TrayHandlers): TrayHandle | null {
  try {
    const path = resolveIcon()
    if (!existsSync(path)) return null
    const source = nativeImage.createFromPath(path)
    if (source.isEmpty()) return null
    const icon = source.resize({ width: 16, height: 16 })
    const tray = new Tray(icon)
    tray.setToolTip('sai2工作台')
    tray.on('double-click', handlers.onActivate)

    return {
      setItems(items, tooltip) {
        if (tray.isDestroyed()) return
        if (tooltip) tray.setToolTip(tooltip)
        const template = items.map((item) =>
          item.separator
            ? { type: 'separator' as const }
            : {
                label: item.label,
                enabled: item.disabled !== true,
                click: () => handlers.onCommand(item.id)
              }
        )
        tray.setContextMenu(Menu.buildFromTemplate(template))
      },
      destroy() {
        if (!tray.isDestroyed()) tray.destroy()
      }
    }
  } catch {
    return null
  }
}
