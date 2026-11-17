/**
 * FX Studio 配置表单（声明式，工作台据此自动生成表单）。
 * suiteDir 指向用户自行下载的上游插件套件解压目录（含 sai2_injector.exe）。
 */
'use strict'

module.exports = {
  suiteDir: {
    type: 'path',
    label: 'SAI2 插件套件目录',
    filter: 'dir',
    default: '',
    hint: '选择你从上游 Releases 下载并解压的目录（里面应有 sai2_injector.exe）。本插件不分发该二进制。'
  },
  autoInject: {
    type: 'bool',
    label: '打开浮窗时自动运行注入器',
    default: false,
    hint: '勾选后，打开 FX Studio 会尝试运行套件里的 sai2_injector.exe inject（需管理员权限）。'
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
