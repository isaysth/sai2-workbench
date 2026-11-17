/**
 * 最小复现：验证 Windows 上 Electron 的 transparent 窗口到底有没有生效。
 * 用法：electron tools/transparent_probe.js
 * 预期：屏幕被半透明红覆盖，能看见底下的底图颜色（蓝）。
 * 如果显示成纯红/纯白，说明透明窗口在本机失效，与业务代码无关。
 */
const { app, BrowserWindow, screen } = require('electron')
const { join } = require('node:path')

app.whenReady().then(() => {
  const { width, height } = screen.getPrimaryDisplay().size
  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width: Math.round(width * 0.6),
    height: Math.round(height * 0.6),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: { contextIsolation: true }
  })
  void win.loadFile(join(__dirname, 'transparent_probe.html'))
  win.webContents.once('did-finish-load', () => {
    win.show()
    console.log('probe shown')
  })
})
