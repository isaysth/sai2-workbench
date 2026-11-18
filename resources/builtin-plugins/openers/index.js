/**
 * 多格式打开器：合并原 opener-sai2 / opener-ps / opener-csp 三个内置插件。
 *
 * 关键：打开器 id（opener-sai2 等）与插件 id（openers）是两回事。
 * 内核按 opener id 读 config.openers.{sai2|ps|csp} 的路径，
 * 所以这里必须原样注册三个 id，用户已填的路径和默认打开器配置才不会丢。
 *
 * 每个 register 都返回注销函数，交给 ctx.effect —— 禁用本插件时三个打开器一起注销，
 * 不留僵尸；启用后重新 apply 再注册。
 */
const definitions = [
  { id: 'opener-sai2', label: 'SAI2', configKey: 'sai2', exts: ['.sai2', '.sai'] },
  { id: 'opener-ps', label: 'PS', configKey: 'ps', exts: ['.psd', '.psb'] },
  { id: 'opener-csp', label: 'CSP', configKey: 'csp', exts: ['.clip'] }
]

module.exports = {
  apply(ctx) {
    const openers = ctx.get('openers')
    for (const def of definitions) {
      const off = openers.register(def)
      ctx.effect(off)
    }
    ctx.log.info(`多格式打开器已就绪（${definitions.map((d) => d.label).join(' / ')}）`)
  }
}
