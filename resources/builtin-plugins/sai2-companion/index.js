/**
 * 启动联动插件。
 * 订阅 opener_before_launch：每次启动画图程序时，按配置的顺序 + 延迟拉起其它程序。
 * 路径失效只 setStatus 提示并跳过，绝不抛错阻断主程序。
 *
 * 关掉工作台不会连带关闭这些程序 —— ctx.shell.launch 走 detached + unref。
 */
module.exports = {
  configSchema: {
    apps: {
      type: 'list',
      label: '联动程序（按顺序启动）',
      hint: '比如参考图软件、录屏软件；每项可单独开关与设延迟',
      item: {
        name: { type: 'string', label: '名称' },
        path: { type: 'path', label: '程序路径', filter: 'exe' },
        delay: { type: 'int', label: '延迟(ms)', default: 0, min: 0, max: 60000 },
        enabled: { type: 'bool', label: '启用', default: true }
      }
    }
  },

  apply(ctx, config) {
    const shell = ctx.shell
    let running = false

    const apps = () => (Array.isArray(config.apps) ? config.apps : [])

    const refreshStatus = () => {
      const all = apps().filter((a) => a && a.enabled !== false && a.name)
      if (all.length === 0) {
        ctx.setStatus('联动未配置', 'ok')
        return
      }
      const missing = all.filter((a) => !a.path || !shell.exists(String(a.path)))
      if (missing.length > 0) {
        ctx.setStatus(`联动：${missing.length} 个路径失效`, 'warn')
      } else {
        ctx.setStatus(`联动就绪：${all.length} 个程序`, 'ok')
      }
    }

    // 配置表单保存后配置对象会被替换吗？不会 —— 递归代理就地更新，
    // 所以这里在每次触发时现读 config.apps，天然拿到最新值。
    refreshStatus()

    ctx.on('opener_before_launch', () => {
      if (running) return
      const list = apps()
        .filter((a) => a && a.enabled !== false && a.name)
        .map((a, i) => ({ ...a, delay: Number(a.delay) || 0, order: i }))
        .sort((x, y) => x.delay - y.delay || x.order - y.order)

      if (list.length === 0) return
      running = true
      let launched = 0

      for (const app of list) {
        const path = String(app.path || '')
        const name = String(app.name || '未命名')
        if (!path || !shell.exists(path)) {
          ctx.log.warn(`联动跳过「${name}」：路径不存在或没填`)
          continue
        }
        ctx.runLater(app.delay, () => {
          void shell.launch(path).then((res) => {
            if (res.ok) ctx.log.info(`已联动启动「${name}」`)
            else ctx.log.warn(`联动启动「${name}」失败：${res.error || '未知原因'}`)
          })
          launched += 1
          if (launched === list.length) running = false
        })
      }
      if (list.every((a) => !a.path || !shell.exists(String(a.path)))) running = false
    })

    ctx.log.info('启动联动已就绪')
  }
}
