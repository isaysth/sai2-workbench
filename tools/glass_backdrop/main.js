/**
 * 玻璃效果验收用的临时底图窗口。
 * 不属于产品代码，只用于在没有彩色壁纸的机器上肉眼核对亚克力透光程度。
 * 用法：electron tools/glass_backdrop/main.js
 * 关闭：点窗口内任意处右键，或直接结束进程。
 */
const { app, BrowserWindow, screen } = require('electron')
const { join } = require('node:path')

app.whenReady().then(() => {
  const { width, height } = screen.getPrimaryDisplay().size
  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#1c1e28',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  win.setIgnoreMouseEvents(true)
  void win.loadFile(join(__dirname, 'index.html'))
})
