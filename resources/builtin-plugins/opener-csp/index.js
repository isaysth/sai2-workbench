/**
 * Clip Studio Paint 打开器：声明规则即可，内核按 config.openers.csp 读路径。
 */
module.exports = {
  apply(ctx) {
    const openers = ctx.get('openers')
    const off = openers.register({
      id: 'opener-csp',
      label: 'CSP',
      configKey: 'csp',
      exts: ['.clip']
    })
    ctx.effect(off)
    ctx.log.info('CSP 打开器已就绪')
  }
}
