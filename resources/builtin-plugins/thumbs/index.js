/**
 * 多格式缩略图：合并原 thumb-image / thumb-psd / thumb-sai2 三个内置插件。
 *
 * 解码算法仍由内核 thumb-kernel 提供，插件只声明「哪些扩展名归谁」。
 * provider 的 id 与 match/resolve 逻辑原样搬来，保持三个解码链互不干扰：
 *   - image：png/jpg/webp 等位图（nativeImage 缩放或直通）
 *   - psd：PSD / PSB（合成图 → PNG）
 *   - sai2：SAI2 / SAI 自带 thum / jssf 预览
 *
 * thumbs.registerProvider 用同 id 覆盖，重载不会重复注册。
 */
const providerKeys = ['imageProvider', 'psdProvider', 'sai2Provider']

module.exports = {
  apply(ctx) {
    const kernel = ctx.get('thumb-kernel')
    const thumbs = ctx.get('thumbs')
    for (const key of providerKeys) {
      const provider = kernel[key]
      if (!provider) {
        ctx.log.warn(`内核缺少缩略图提供者 ${key}，已跳过`)
        continue
      }
      thumbs.registerProvider({
        id: provider.id,
        match: (ext) => provider.match(ext),
        resolve: (file) => provider.resolve(file)
      })
    }
    ctx.log.info(`多格式缩略图已就绪（${providerKeys.length} 个提供者）`)
  }
}
