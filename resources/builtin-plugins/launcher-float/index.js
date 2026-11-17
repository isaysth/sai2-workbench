/**
 * 启动悬浮窗（官方内置插件）。
 *
 * 只负责「什么时候触发」和「用户想要什么行为」：
 * - 订阅 opener_after_launch，SAI2 启动后自动收成悬浮小窗；
 * - 把配置以 getter 交给内核 WindowManager，悬浮/托盘/最小化行为由内核执行；
 * - 提供一个手动切换的动作，没启动 SAI2 也能用。
 *
 * 配置保存会自动触发插件 reload（plugins.ipc），所以新值立即生效。
 */
module.exports = {
  configSchema: {
    autoFloatOnSai2: {
      type: 'bool',
      label: '启动 SAI2 后自动变悬浮窗',
      default: true,
      hint: '只在通过工作台启动 SAI2 时触发；自己从别处打开 SAI2 不会误触。'
    },
    minimizeToTray: {
      type: 'bool',
      label: '最小化按钮改为「收进托盘」',
      default: true,
      hint: '开启后标题栏的「—」不再缩到任务栏，而是隐藏到系统托盘；双击托盘图标恢复。'
    },
    closeToTray: {
      type: 'bool',
      label: '关闭按钮改为「收进托盘」',
      default: false,
      hint: '默认关闭即退出。开启后点「×」只隐藏窗口，需从托盘菜单选「退出工作台」。'
    },
    alwaysOnTop: {
      type: 'bool',
      label: '悬浮窗始终置顶',
      default: true,
      hint: '盖在 SAI2 上方方便随时点开；如果挡到画布可以关掉。'
    },
    floatWidth: {
      type: 'int',
      label: '悬浮窗宽度',
      default: 336,
      min: 240,
      max: 560,
      hint: '240~560px，保存后立即按新尺寸重排。'
    },
    floatHeight: {
      type: 'int',
      label: '悬浮窗高度',
      default: 132,
      min: 100,
      max: 260
    }
  },

  apply(ctx, config) {
    const wm = ctx.get('window-manager')

    // getter 而不是快照：配置对象就地更新时内核也能拿到新值
    wm.configure(() => ({
      autoFloatOnSai2: config.autoFloatOnSai2,
      minimizeToTray: config.minimizeToTray,
      closeToTray: config.closeToTray,
      alwaysOnTop: config.alwaysOnTop,
      floatWidth: config.floatWidth,
      floatHeight: config.floatHeight
    }))
    ctx.effect(() => wm.configure(null))

    const refreshStatus = (extra) => {
      const parts = []
      parts.push(config.autoFloatOnSai2 ? '自动悬浮' : '手动悬浮')
      if (config.minimizeToTray) parts.push('最小化到托盘')
      if (config.closeToTray) parts.push('关闭到托盘')
      ctx.setStatus(extra || parts.join(' · '), 'ok')
    }
    refreshStatus()

    ctx.on('opener_after_launch', (payload) => {
      // 只对 SAI2 生效：PS / CSP 启动时不打扰
      if (config.autoFloatOnSai2 && payload && payload.openerId === 'opener-sai2') {
        wm.enterFloat()
        refreshStatus('SAI2 已启动 · 悬浮窗模式')
      }
    })

    ctx.addToolbarAction({
      id: 'launcher-float.toggle',
      label: wm.isFloat() ? '展开主界面' : '切换悬浮窗',
      run: () => {
        wm.toggleFloat()
        refreshStatus(wm.isFloat() ? '悬浮窗模式' : '主界面模式')
      }
    })

    ctx.log.info('启动悬浮窗已就绪')
  }
}
