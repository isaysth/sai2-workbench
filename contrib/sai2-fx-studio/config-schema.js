/**
 * FX Studio 配置表单（声明式，工作台据此自动生成表单）。
 * 默认使用随插件一起分发的上游套件；只有需要换成其他版本时才让用户改路径。
 */
'use strict'

module.exports = {
  suiteDir: {
    type: 'path',
    label: 'SAI2 插件套件目录（已内置）',
    filter: 'dir',
    default: 'vendor/sai2-plugin-suite',
    hint: '默认就是插件包里附带的上游套件，无需另下载。仅当你想换用其他版本时才选这里（相对路径按插件目录解析）。'
  },
  autoInject: {
    type: 'bool',
    label: '打开浮窗时自动注入',
    default: true,
    hint: '默认开启：打开 FX Studio 会运行随包的 sai2_injector.exe inject（权限需与 SAI2 一致；首次可能需加杀软白名单）。'
  },
  previewMaxDim: {
    type: 'int',
    label: '预览最长边（像素）',
    default: 900,
    min: 300,
    max: 2000,
    step: 100,
    hint: '越小越流畅但预览越模糊；应用时始终按全分辨率计算。'
  }
}
