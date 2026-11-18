/**
 * 悬浮能力说明（内置占位插件）。
 *
 * 原来的 launcher-float 已独立为官方插件 sai2-window-float，需从 zip 安装。
 * 这个占位项只提供安装指引：一行侧栏状态 + 一个工具栏提示动作。
 * 它不注册 window-manager、不改窗口状态、不订阅启动事件，也不会自动悬浮。
 */
module.exports = {
  apply(ctx) {
    const guide = '悬浮插件已独立，请在插件中心安装 sai2-window-float'
    const detail = '启动悬浮窗已独立为官方插件 sai2-window-float：请在「插件」页点「安装」，选择 sai2-window-float-<版本>.zip；安装后本提示可忽略。'

    // warn 级别会显示在侧栏提示位，确保用户升级后不会静默失去悬浮能力
    ctx.setStatus(guide, 'warn')

    ctx.addToolbarAction({
      id: 'float-guide.install',
      label: '悬浮插件安装指引',
      run: () => {
        ctx.setStatus(detail, 'warn')
        ctx.log.info(detail)
      }
    })

    ctx.log.info(guide)
  }
}
