/**
 * SAI2 打开器：只声明规则，路径与启动由内核 OpenersService 负责。
 * 卸载 / 禁用时 ctx.effect 会自动注销注册，不留僵尸打开器。
 */
module.exports = {
  apply(ctx) {
    const openers = ctx.get('openers')
    const off = openers.register({
      id: 'opener-sai2',
      label: 'SAI2',
      configKey: 'sai2',
      exts: ['.sai2', '.sai']
    })
    ctx.effect(off)
    ctx.log.info('SAI2 打开器已就绪')
  }
}
