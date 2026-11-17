/**
 * Photoshop 打开器：声明规则即可，内核按 config.openers.ps 读路径。
 */
module.exports = {
  apply(ctx) {
    const openers = ctx.get('openers')
    const off = openers.register({
      id: 'opener-ps',
      label: 'PS',
      configKey: 'ps',
      exts: ['.psd', '.psb']
    })
    ctx.effect(off)
    ctx.log.info('PS 打开器已就绪')
  }
}
