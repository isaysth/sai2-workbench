/**
 * 内置缩略图插件：PSD / PSB。
 * 大文件走 worker 的判断由内核调度层按扩展名与体积决定，与 provider id 无关。
 */
module.exports = {
  apply(ctx) {
    const kernel = ctx.get('thumb-kernel')
    const provider = kernel.psdProvider
    ctx.get('thumbs').registerProvider({
      id: provider.id,
      match: (ext) => provider.match(ext),
      resolve: (file) => provider.resolve(file)
    })
  }
}
