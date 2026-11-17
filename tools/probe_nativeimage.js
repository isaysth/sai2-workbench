const { app, nativeImage } = require('electron')
app.whenReady().then(() => {
  for (const f of process.argv.slice(2)) {
    const img = nativeImage.createFromPath(f)
    console.log('[probe]', f.split(/[\\/]/).pop(), 'empty=', img.isEmpty(), 'size=', JSON.stringify(img.getSize()))
  }
  app.quit()
})
