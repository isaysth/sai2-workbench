/**
 * 示例主题插件：通过 ctx.addThemeVars 贡献 CSS 变量。
 * 内核只接受白名单变量，非法值自动回退；禁用 / 卸载时变量立即撤销。
 *
 * 想做自己的主题：改下面的颜色 / 圆角 / 字号，或删除此插件、新建一份。
 */
module.exports = {
  apply(ctx) {
    const off = ctx.addThemeVars({
      '--accent': '#ff7a45',
      '--accent-hover': '#f4662a',
      '--accent-soft': '#fff0e8',
      '--radius': '14px',
      '--radius-sm': '8px',
      '--radius-md': '12px',
      '--radius-lg': '18px',
      '--font-scale': '1.02'
    })
    ctx.effect(off)
    ctx.log.info('示例主题已应用：暖橙')
  }
}
