/**
 * 内置缩略图插件：SAI2 / SAI。
 */
module.exports = {
  apply(ctx) {
    const kernel = ctx.get('thumb-kernel')
    const provider = kernel.sai2Provider
    ctx.get('thumbs').registerProvider({
      id: provider.id,
      match: (ext) => provider.match(ext),
      resolve: (file) => provider.resolve(file)
    })
  }
}
