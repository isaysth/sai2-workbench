/**
 * 内置缩略图插件：图片。
 * 解码算法仍由内核的 thumb-kernel 服务提供，插件只声明「哪些扩展名归我」。
 */
module.exports = {
  apply(ctx) {
    const kernel = ctx.get('thumb-kernel')
    const provider = kernel.imageProvider
    ctx.get('thumbs').registerProvider({
      id: provider.id,
      match: (ext) => provider.match(ext),
      resolve: (file) => provider.resolve(file)
    })
  }
}
