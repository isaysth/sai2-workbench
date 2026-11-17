/**
 * 示例插件：把 PluginContext 的每一种扩展面都演示一遍。
 * 想写自己的插件，复制这个目录、改 plugin.json 的 id/name、在 apply 里改逻辑即可。
 *
 * 覆盖点：configSchema（四种字段）、addFileAction、addToolbarAction、addPage、
 * log、on(事件)、runLater、dataDir、shell.exists。
 */
module.exports = {
  configSchema: {
    greeting: { type: 'string', label: '问候语', default: '你好', hint: '随便填，保存后立即生效' },
    loud: { type: 'bool', label: '写日志时加感叹号', default: true },
    level: {
      type: 'enum',
      label: '日志级别',
      default: 'info',
      options: [
        { value: 'debug', label: '调试' },
        { value: 'info', label: '信息' },
        { value: 'warn', label: '警告' }
      ]
    },
    keywords: { type: 'list', label: '感兴趣的文件名关键词', item: { word: { type: 'string', label: '关键词' } } }
  },

  apply(ctx, config) {
    const say = (msg) => {
      const bang = config.loud === true ? '！' : ''
      const level = config.level === 'warn' ? 'warn' : config.level === 'debug' ? 'debug' : 'info'
      ctx.log[level](`${String(config.greeting || '你好')}，${msg}${bang}`)
    }

    // 1. 右键菜单动作：只对图片显示（exts 白名单），点击后打印路径
    ctx.addFileAction({
      id: 'hello-world.say-path',
      label: '示例：看看这个文件',
      exts: ['.png', '.jpg', '.jpeg', '.webp', '.sai2', '.psd'],
      run: (payload) => {
        const path = typeof payload === 'string' ? payload : ''
        const name = path.split(/[\\/]/).pop() || path
        say(`你右键了「${name}」`)
      }
    })

    // 2. 工具栏动作（当前工具栏暂无插槽，保留示例，将来接上即可见）
    ctx.addToolbarAction({
      id: 'hello-world.ping',
      label: '示例：打个招呼',
      run: () => say('工具栏按钮被点了')
    })

    // 3. 侧栏页：插件在主进程，React 组件过不来，交一段 HTML 给渲染端 iframe 渲染
    ctx.addPage({
      id: 'demo',
      title: '示例页',
      html: `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
        body{font-family:system-ui,sans-serif;margin:28px;color:#222;background:#fff}
        h1{font-size:20px} p{line-height:1.7;color:#555} code{background:#f2f2f2;padding:2px 6px;border-radius:4px}
      </style></head><body>
        <h1>你好，这是插件贡献的页面</h1>
        <p>这个页面来自 <code>hello-world</code> 插件的 <code>ctx.addPage</code>。</p>
        <p>在插件中心禁用它，这个侧栏入口会一起消失。</p>
        <p>想改内容？编辑插件目录里的 <code>index.js</code>，开发模式下会自动重载。</p>
      </body></html>`
    })

    // 4. 事件订阅：每次打开文件都记一条（这里的「打开」由内核在启动打开器时发出）
    ctx.on('file_open', (payload) => {
      ctx.log.debug('示例插件收到 file_open 事件')
      void payload
    })
    ctx.on('opener_after_launch', (payload) => {
      const id = payload && typeof payload === 'object' ? String(payload.openerId ?? '') : ''
      if (id) say(`打开器 ${id} 已启动`)
    })

    // 5. 定时任务：启动 3 秒后写一条，演示 runLater 会自动随插件卸载清理
    ctx.runLater(3000, () => say('我已启动 3 秒了'))

    // 6. 数据目录：插件可以往自己的目录写东西，互不干扰
    ctx.log.debug(`示例插件的数据目录：${ctx.dataDir}`)

    say('示例插件已就绪')
  }
}
