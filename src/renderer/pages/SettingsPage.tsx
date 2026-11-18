import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  AppConfig,
  BackgroundMode,
  ColorScheme,
  RuntimeInfo,
  ThemeName,
  ThumbCacheStats
} from '@shared/types'
import type { PageKey } from '../store/ui'
import { CitrusMark } from '../components/Brand'
import { CropDialog } from '../components/CropDialog'
import { useMeta } from '../store/meta'

const STYLE_OPTIONS: Array<{ id: ThemeName; name: string; note: string; preview: string }> = [
  { id: 'glass', name: '玻璃', note: '可透 · 可模糊', preview: 'is-glass' },
  { id: 'minimal', name: '简约', note: '实色 · 看图最准', preview: 'is-minimal' }
]

const SCHEME_OPTIONS: Array<{ id: ColorScheme; name: string }> = [
  { id: 'light', name: '浅色' },
  { id: 'dark', name: '深色' }
]

/** 可勾选的文件类型。clip / kra 目前还出不了预览（M3a 插件），但先允许监听 */
const EXT_OPTIONS = [
  { ext: '.sai2', label: 'SAI2' },
  { ext: '.sai', label: 'SAI' },
  { ext: '.psd', label: 'PSD' },
  { ext: '.psb', label: 'PSB' },
  { ext: '.png', label: 'PNG' },
  { ext: '.jpg', label: 'JPG' },
  { ext: '.jpeg', label: 'JPEG' },
  { ext: '.webp', label: 'WEBP' },
  { ext: '.clip', label: 'CLIP' },
  { ext: '.kra', label: 'KRA' }
]

const BACKGROUND_OPTIONS: Array<{ id: BackgroundMode; name: string; note: string }> = [
  { id: 'solid', name: '纯色', note: '跟随明暗' },
  { id: 'image', name: '图片', note: '自定义' },
  { id: 'desktop', name: '全透明', note: '看穿窗口' }
]

interface SettingsProps {
  runtime: RuntimeInfo
  config: AppConfig
  updateConfig: (key: string, value: unknown) => Promise<void>
  toast: (msg: string) => void
  goto: (page: PageKey) => void
}

/**
 * 设置页。外观拆成三个互不干扰的维度：
 *   风格（玻璃 / 简约）× 明暗（浅 / 深）× 背景（纯色 / 图片 / 全透明）
 *
 * 玻璃参数只在玻璃风格下渲染 —— 简约风格没有"面板不透明度"这个概念，
 * 留一个禁用的滑块只会让人以为哪里坏了，所以整块不出现。
 * 但简约在图片/全透明背景下确实有一层纱，它的厚薄由「背景清晰度」单独控制，
 * 那个滑块放在「背景」卡片里，因为它调的是背景的显示程度，不是面板材质。
 */
export function SettingsPage({ runtime, config, updateConfig, toast, goto }: SettingsProps): ReactElement {
  const [alpha, setAlpha] = useState(config.general.glassOpacity)
  const [blur, setBlur] = useState(config.general.glassBlur)
  const [clarity, setClarity] = useState(config.general.bgClarity)
  const [thumb, setThumb] = useState(config.general.thumbnailSize)
  const [picking, setPicking] = useState(false)
  const [cache, setCache] = useState<ThumbCacheStats | null>(null)
  const [busy, setBusy] = useState('')
  // 选完图先不开工：等取景确认。pending 是 data/backgrounds 里的临时文件名
  const [crop, setCrop] = useState<string | null>(() => {
    // 调试口子（跟 SAIGUI_PAGE 一路货色）：?crop=.pending-xxx.png 时直接开取景框，便于截图验收
    const q = new URLSearchParams(window.location.search).get('crop')
    return q && q.startsWith('.pending-') ? q : null
  })
  const [applying, setApplying] = useState(false)

  const tags = useMeta((s) => s.tags)
  const rules = useMeta((s) => s.rules)
  const addRule = useMeta((s) => s.addRule)
  const removeRule = useMeta((s) => s.removeRule)
  const createTag = useMeta((s) => s.createTag)
  const [ruleDir, setRuleDir] = useState(config.watch.dirs[0] ?? '')
  const [ruleTag, setRuleTag] = useState(0)
  const [newTag, setNewTag] = useState('')

  useEffect(() => {
    setAlpha(config.general.glassOpacity)
  }, [config.general.glassOpacity])

  useEffect(() => {
    setBlur(config.general.glassBlur)
  }, [config.general.glassBlur])

  useEffect(() => {
    setClarity(config.general.bgClarity)
  }, [config.general.bgClarity])

  useEffect(() => {
    setThumb(config.general.thumbnailSize)
  }, [config.general.thumbnailSize])

  const isGlass = config.general.theme === 'glass'
  const background = config.general.background
  const imageName = config.general.backgroundImage

  /** 拖动滑块时只改 CSS 变量、不写盘：拖动过程中每一像素都过一遍主进程会明显卡顿 */
  // 缓存占用只在进页面时读一次；清空后手动刷新（不需要实时轮询）
  useEffect(() => {
    void window.api.thumbs.stats().then(setCache)
  }, [])

  const addDirs = async (): Promise<void> => {
    setBusy('add')
    try {
      const res = await window.api.files.addDir()
      if (res.canceled) return
      if (!res.ok) {
        toast(res.message ?? '添加失败')
        return
      }
      toast(res.added ? `已添加 ${res.added} 个目录，开始索引` : (res.message ?? '已添加'))
    } finally {
      setBusy('')
    }
  }

  const removeDir = async (dir: string): Promise<void> => {
    const res = await window.api.files.removeDir(dir)
    if (!res.ok) toast(res.error ?? '移除失败')
    else toast('已移除，磁盘上的文件没动')
  }

  const rescan = async (): Promise<void> => {
    setBusy('rescan')
    try {
      const res = await window.api.files.rescan()
      toast(`已重新扫描：${res.total ?? 0} 个文件`)
    } finally {
      setBusy('')
    }
  }

  const toggleExt = async (ext: string): Promise<void> => {
    const current = config.watch.extensions
    const next = current.includes(ext) ? current.filter((e) => e !== ext) : [...current, ext]
    await updateConfig('watch.extensions', next)
  }

  const clearCache = async (): Promise<void> => {
    setBusy('cache')
    try {
      const res = await window.api.thumbs.clear()
      setCache(await window.api.thumbs.stats())
      toast(`缓存已清空（${res.removed ?? 0} 个文件）`)
    } finally {
      setBusy('')
    }
  }

  /** 备份：主进程弹另存框 + 打包，这里只负责按钮状态与结果提示 */
  const backupData = async (): Promise<void> => {
    setBusy('backup')
    try {
      const res = await window.api.data.export()
      if (res.canceled) return
      if (!res.ok) {
        toast(res.error ?? '备份失败')
        return
      }
      const mb = ((res.bytes ?? 0) / 1024 / 1024).toFixed(1)
      toast(`已备份 ${res.entries ?? 0} 个文件（${mb} MB），存到你选的位置了`)
    } finally {
      setBusy('')
    }
  }

  /** 恢复：二次确认在主进程弹，成功后主进程会自动重启，这里只提示 */
  const restoreData = async (): Promise<void> => {
    setBusy('restore')
    try {
      const res = await window.api.data.import()
      if (res.canceled) return
      if (!res.ok) {
        toast(res.error ?? '恢复失败')
        return
      }
      toast(`已恢复 ${res.restored ?? 0} 项数据，程序马上重启`)
    } finally {
      setBusy('')
    }
  }

  const preview = (nextAlpha: number, nextBlur: number): void => {
    const root = document.documentElement
    root.style.setProperty('--glass-alpha', String(nextAlpha))
    root.style.setProperty('--glass-blur', `${nextBlur}px`)
    const on = isGlass && background === 'image' && nextBlur > 0 && nextAlpha >= 0.02
    root.dataset.glass = on ? 'on' : 'off'
  }

  /** 选图只是拿到临时文件，真正落地要等取景确认 */
  const pickImage = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    try {
      const res = await window.api.pickBackground(imageName)
      if (!res.ok) {
        if (!res.canceled) toast(res.error ?? '导入背景图失败')
        return
      }
      if (res.pending) setCrop(res.pending)
    } finally {
      setPicking(false)
    }
  }

  const cancelCrop = async (): Promise<void> => {
    if (applying) return
    const pending = crop
    setCrop(null)
    if (pending) await window.api.cancelBackground(pending)
  }

  const applyCrop = async (png: Uint8Array): Promise<void> => {
    if (!crop) return
    setApplying(true)
    try {
      const res = await window.api.applyBackground({ pending: crop, png, oldName: imageName })
      if (!res.ok || !res.file) {
        toast(res.error ?? '生成背景失败')
        return
      }
      await updateConfig('general.backgroundImage', res.file)
      await updateConfig('general.background', 'image')
      setCrop(null)
      toast('背景图已更新')
    } finally {
      setApplying(false)
    }
  }

  const clearImage = async (): Promise<void> => {
    await updateConfig('general.background', 'solid')
    await updateConfig('general.backgroundImage', '')
    if (imageName) await window.api.clearBackground(imageName)
    toast('已恢复纯色背景')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-sub">外观、监听目录、缩略图缓存都能改；画图程序路径在 M3b 接入</p>
        </div>
      </div>

      <div className="settings-stack">
        <section className="setting-card">
          <div className="setting-card-head">
            <span className="setting-card-title">外观</span>
            <span className="setting-card-note">切换立刻生效，重启后保持</span>
          </div>

          <div className="setting-sub">风格</div>
          <div className="theme-options">
            {STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`theme-card${config.general.theme === opt.id ? ' is-active' : ''}`}
                onClick={() => void updateConfig('general.theme', opt.id)}
              >
                <span className={`theme-preview ${opt.preview}`} />
                <span className="theme-name">
                  {opt.name}
                  <small>{opt.note}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="setting-sub">明暗</div>
          <div className="seg">
            {SCHEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`seg-item${config.general.scheme === opt.id ? ' is-active' : ''}`}
                onClick={() => void updateConfig('general.scheme', opt.id)}
              >
                {opt.name}
              </button>
            ))}
          </div>

          {isGlass ? (
            <>
              <div className="setting-sub">玻璃</div>

              <div className="setting-row">
                <span className="setting-label">不透明度</span>
                <span className="setting-value">
                  {alpha <= 0.001 ? '完全透明' : `${Math.round(alpha * 100)}%`}
                </span>
              </div>
              <input
                className="slider"
                type="range"
                min={0}
                max={95}
                step={1}
                value={Math.round(alpha * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100
                  setAlpha(v)
                  preview(v, blur)
                }}
                onPointerUp={() => void updateConfig('general.glassOpacity', alpha)}
                onKeyUp={() => void updateConfig('general.glassOpacity', alpha)}
              />
              <span className="setting-card-note">
                面板底色的浓度。拖到 0% 时底色彻底消失，只剩文字、玻璃高光边和阴影浮在背景上。
              </span>

              <div className="setting-row">
                <span className="setting-label">模糊度</span>
                <span className="setting-value">{blur <= 0 ? '关闭' : `${blur}px`}</span>
              </div>
              <input
                className="slider"
                type="range"
                min={0}
                max={40}
                step={1}
                value={blur}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setBlur(v)
                  preview(alpha, v)
                }}
                onPointerUp={() => void updateConfig('general.glassBlur', blur)}
                onKeyUp={() => void updateConfig('general.glassBlur', blur)}
              />
              <span className="setting-card-note">
                {background === 'image'
                  ? '背景图片被磨砂的程度，和不透明度互不影响。可以「完全不透明 + 0 模糊」也可以「完全透明 + 40 模糊」。'
                  : '只在背景选「图片」时看得出效果：纯色背景没有可模糊的细节，全透明模式读不到窗口外的画面。'}
              </span>
            </>
          ) : (
            <span className="setting-card-note">
              简约风格的面板是实色，没有不透明度、也没有模糊 —— 想要磨砂玻璃就切回玻璃风格。
              选了图片或全透明背景后，背景透出来的程度用下面「背景」卡片里的「背景清晰度」调。
            </span>
          )}
        </section>

        <section className="setting-card">
          <div className="setting-card-head">
            <span className="setting-card-title">背景</span>
            <span className="setting-card-note">窗口最底下那一层画什么</span>
          </div>

          <div className="seg">
            {BACKGROUND_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`seg-item${background === opt.id ? ' is-active' : ''}`}
                onClick={() => {
                  if (opt.id === 'image' && !imageName) {
                    void pickImage()
                    return
                  }
                  void updateConfig('general.background', opt.id)
                }}
              >
                {opt.name}
                <small>{opt.note}</small>
              </button>
            ))}
          </div>

          {background === 'image' && imageName ? (
            <div className="bg-picker">
              <span
                className="bg-preview"
                style={{ backgroundImage: `url("sai2img://bg/${encodeURIComponent(imageName)}")` }}
              />
              <div className="bg-picker-actions">
                <button className="btn is-sm" disabled={picking} onClick={() => void pickImage()}>
                  {picking ? '正在读取…' : '换一张'}
                </button>
                <button className="btn is-sm is-ghost" onClick={() => void clearImage()}>
                  清除
                </button>
              </div>
            </div>
          ) : null}

          {!isGlass && background !== 'solid' ? (
            <>
              <div className="setting-row">
                <span className="setting-label">背景清晰度</span>
                <span className="setting-value">
                  {Math.round(clarity * 100) <= 0 ? '几乎看不见' : `${Math.round(clarity * 100)}%`}
                </span>
              </div>
              <input
                className="slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(clarity * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100
                  setClarity(v)
                  // 拖动只改 CSS 变量、不写盘：每像素过一次主进程会卡（跟玻璃滑块同一套做法）
                  document.documentElement.style.setProperty('--bg-clarity', String(v))
                }}
                onPointerUp={() => void updateConfig('general.bgClarity', clarity)}
                onKeyUp={() => void updateConfig('general.bgClarity', clarity)}
              />
              <span className="setting-card-note">
                面板这层纱的厚薄。调高 = 纱变薄、背景更清楚，100% 时面板完全让开，
                图片原样透出来；调低 = 纱变厚、背景几乎看不见。文字在纱薄时会自动加光晕托底。
              </span>
            </>
          ) : null}

          <span className="setting-card-note">
            {background === 'solid'
              ? '浅色主题用近白底、深色主题用近黑底，都带一层极淡光斑 —— 玻璃面板靠这层明暗才看得出厚度。'
              : background === 'image'
                ? '图片会拷贝到 data/backgrounds 跟程序一起搬走，上限 8MB。导入时先出取景框：框里看到的就是窗口铺满的样子，比例不对的部分可以拖掉、滚轮放大取样。下次改了窗口大小，系统会按新比例重新裁一次（裁的是同一张图，不会二次损失）。'
                : '窗口真的透过去，直接看到桌面 —— 这就是「全透明」：除了文字、图标和卡片，其余什么都不画。注意：模糊参数对它不起作用，浏览器内核读不到窗口外的画面，这是所有 Electron / WebView2 应用的共同限制。'}
          </span>

          {background === 'desktop' && config.general.scheme === 'dark' ? (
            <span className="setting-card-note" style={{ color: 'var(--log-warn)' }}>
              {isGlass
                ? '深色面板压在深色桌面上会看不清边界，建议把不透明度调到 25% 以上。'
                : '深色面板压在深色桌面上会看不清边界，建议把背景清晰度降到 40% 以下。'}
            </span>
          ) : null}
        </section>

        <section className="setting-card">
          <div className="setting-card-head">
            <span className="setting-card-title">缩略图</span>
            <span className="setting-card-note">缓存一份长边 512，所有卡片尺寸共用</span>
          </div>
          <div className="setting-row">
            <span className="setting-label">卡片大小</span>
            <span className="setting-value">{thumb}px</span>
          </div>
          <input
            className="slider"
            type="range"
            min={120}
            max={320}
            step={10}
            value={thumb}
            onChange={(e) => setThumb(Number(e.target.value))}
            onPointerUp={() => void updateConfig('general.thumbnailSize', thumb)}
            onKeyUp={() => void updateConfig('general.thumbnailSize', thumb)}
          />
          <span className="setting-card-note">
            只影响卡片显示尺寸，不影响原图，也不会让缩略图重新生成 —— 缓存长边固定 512，
            卡片最大 320px，2 倍屏也够清晰。
          </span>

          <div className="setting-row" style={{ marginTop: 6 }}>
            <span className="setting-label">缩略图缓存</span>
            <span className="setting-value">
              {cache
                ? `${(cache.bytes / 1024 / 1024).toFixed(1)} MB / ${Math.round(cache.maxBytes / 1024 / 1024)} MB · ${cache.files} 张${
                    cache.failures > 0 ? ` · ${cache.failures} 个失败标记` : ''
                  }`
                : '读取中…'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start' }}>
            <button className="btn is-sm" disabled={busy === 'cache'} onClick={() => void clearCache()}>
              {busy === 'cache' ? '正在清理…' : '清空缓存'}
            </button>
            <button className="btn is-sm is-ghost" onClick={() => void window.api.thumbs.stats().then(setCache)}>
              刷新占用
            </button>
          </div>
          <span className="setting-card-note">
            超过上限时按最后修改时间自动淘汰最旧的。清空后卡片会重新生成一遍（只影响预览，不碰原图）。
          </span>
        </section>

        <section className="setting-card">
          <div className="setting-card-head">
            <span className="setting-card-title">监听目录</span>
            <span className="setting-card-note">
              {config.watch.mode === 'realtime' ? '常驻监听，丢文件自动出卡片' : '启动时扫一次，之后点「刷新」更新'}
            </span>
          </div>

          {config.watch.dirs.length === 0 ? (
            <span className="setting-card-note">
              还没有监听目录。添加后会立即扫一次，之后随时可以点「立即重扫」或文件页的「刷新」。
            </span>
          ) : (
            <div className="watch-list">
              {config.watch.dirs.map((dir) => (
                <div className="watch-item" key={dir}>
                  <span className="watch-path" title={dir}>
                    {dir}
                  </span>
                  <button className="btn is-sm is-ghost" onClick={() => void removeDir(dir)}>
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start', marginTop: 2 }}>
            <button className="btn is-sm" disabled={busy === 'add'} onClick={() => void addDirs()}>
              {busy === 'add' ? '选择中…' : '添加文件夹'}
            </button>
            <button
              className="btn is-sm is-ghost"
              disabled={busy === 'rescan' || config.watch.dirs.length === 0}
              onClick={() => void rescan()}
            >
              {busy === 'rescan' ? '正在重扫…' : '立即重扫'}
            </button>
          </div>

          <div className="setting-sub">扫描方式</div>
          <div className="seg">
            <button
              className={`seg-item${config.watch.mode === 'startup' ? ' is-active' : ''}`}
              onClick={() => void updateConfig('watch.mode', 'startup')}
            >
              仅启动时扫描
              <small>手动刷新</small>
            </button>
            <button
              className={`seg-item${config.watch.mode === 'realtime' ? ' is-active' : ''}`}
              onClick={() => void updateConfig('watch.mode', 'realtime')}
            >
              实时监听
              <small>丢文件约 2 秒出现</small>
            </button>
          </div>
          <span className="setting-card-note">
            默认只在打开程序时扫一次，之后不占后台资源；往目录里加了新稿子，到文件页点「刷新」就会重扫一遍。
            需要边画边看时切「实时监听」，会常驻一个目录监听器。无论哪种模式，添加或移除监听目录都会立即扫一次。
          </span>

          <div className="setting-sub">子目录</div>
          <div className="seg">
            <button
              className={`seg-item${config.watch.recursive ? ' is-active' : ''}`}
              onClick={() => void updateConfig('watch.recursive', true)}
            >
              含子文件夹
            </button>
            <button
              className={`seg-item${config.watch.recursive ? '' : ' is-active'}`}
              onClick={() => void updateConfig('watch.recursive', false)}
            >
              只看当前层
            </button>
          </div>

          <div className="setting-sub">监听的文件类型</div>
          <div className="ext-chips">
            {EXT_OPTIONS.map((opt) => (
              <button
                key={opt.ext}
                className={`ext-chip${config.watch.extensions.includes(opt.ext) ? ' is-on' : ''}`}
                onClick={() => void toggleExt(opt.ext)}
                title={opt.ext}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="setting-card-note">
            勾上的类型才会进索引。CLIP / KRA 目前还出不了预览（会显示信息卡），
            原生解码会由 M3a 的插件补上。
          </span>
        </section>

        <section className="setting-card">
          <div className="setting-card-head">
            <span className="setting-card-title">标签与自动规则</span>
            <span className="setting-card-note">按目录自动打标签，少打一半</span>
          </div>

          <div className="setting-row">
            <span className="setting-label">标签池</span>
            <span className="setting-value">{tags.length} 个</span>
          </div>

          {tags.length > 0 ? (
            <div className="ext-chips">
              {tags.map((t) => (
                <span className="tag-chip" key={t.id}>
                  {t.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="setting-card-note">
              还没有标签。下面直接建一个，或者选中稿件后在右侧详情面板里输入。
            </span>
          )}

          <div className="rule-add">
            <input
              className="input"
              placeholder="新标签名，如「线稿」"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !newTag.trim()) return
                void createTag(newTag.trim()).then((tag) => {
                  if (tag) {
                    setNewTag('')
                    toast(`标签「${tag.name}」已创建`)
                  } else {
                    toast('创建失败，可能已经有同名标签了')
                  }
                })
              }}
            />
            <button
              className="btn is-sm"
              disabled={!newTag.trim()}
              onClick={() => {
                void createTag(newTag.trim()).then((tag) => {
                  if (tag) {
                    setNewTag('')
                    toast(`标签「${tag.name}」已创建`)
                  } else {
                    toast('创建失败，可能已经有同名标签了')
                  }
                })
              }}
            >
              建标签
            </button>
          </div>

          <div className="setting-sub">自动规则</div>
          {rules.length === 0 ? (
            <span className="setting-card-note">
              还没有规则。配一条「哪个目录 → 哪个标签」，之后丢进这个目录的新稿会自动带上标签
              （含子目录）。规则只对之后新出现的稿件生效，已有稿件请在右侧详情面板里手动打。
            </span>
          ) : (
            <div className="watch-list">
              {rules.map((r) => (
                <div className="watch-item" key={r.prefix}>
                  <span className="watch-path" title={r.prefix}>
                    {r.prefix}
                  </span>
                  <span className="rule-arrow">→</span>
                  <span className="tag-chip">{r.tagName}</span>
                  <button
                    className="btn is-sm is-ghost"
                    onClick={() => {
                      void removeRule(r.prefix).then((ok) => toast(ok ? '规则已移除' : '移除失败'))
                    }}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rule-add">
            <select
              className="select"
              value={ruleDir}
              onChange={(e) => setRuleDir(e.target.value)}
              title="选一个已监听的目录"
            >
              <option value="">选择目录…</option>
              {config.watch.dirs.map((dir) => (
                <option key={dir} value={dir} title={dir}>
                  {dir}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={ruleTag}
              onChange={(e) => setRuleTag(Number(e.target.value))}
              title="命中这个目录的新稿带上哪个标签"
            >
              <option value={0}>选择标签…</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              className="btn is-sm"
              disabled={!ruleDir || ruleTag === 0}
              onClick={() => {
                void addRule(ruleDir, ruleTag).then((ok) =>
                  toast(ok ? '规则已添加：之后进这个目录的新稿会自动带标签' : '添加失败')
                )
              }}
            >
              添加规则
            </button>
          </div>
          <span className="setting-card-note">
            手动改过标签的稿件以手动为准，不会被规则改回去。规则按最长前缀匹配，
            更细的子目录规则优先。
          </span>
        </section>

        <section className="setting-card">
          <div className="setting-card-head">
            <span className="setting-card-title">画图程序与插件</span>
            <span className="setting-card-note">已经归到插件中心</span>
          </div>
          <span className="setting-card-note">
            打开器路径、默认画图程序、启动联动、悬浮窗等行为都由插件提供，
            统一放在插件中心管理，这里不再重复一份。
          </span>
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start', marginTop: 8 }}>
            <button className="btn is-sm" onClick={() => goto('plugins')}>
              去插件中心配置
            </button>
          </div>
        </section>

        <section className="setting-card">
          <div className="setting-card-head">
            <span className="setting-card-title">数据备份</span>
            <span className="setting-card-note">配置、标签、项目、背景图、自制插件</span>
          </div>
          <span className="setting-card-note">
            换电脑、换安装位置，或者不小心删了数据目录时用。备份是一个 zip，通常几百 KB 到几 MB
            —— 缩略图缓存和日志不会打进去，那些能重新生成，打进去只会让文件白白变大。
          </span>
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start', marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn is-sm" disabled={busy === 'backup'} onClick={() => void backupData()}>
              {busy === 'backup' ? '正在打包…' : '备份数据'}
            </button>
            <button
              className="btn is-sm is-ghost"
              disabled={busy === 'restore'}
              onClick={() => void restoreData()}
            >
              {busy === 'restore' ? '正在恢复…' : '从备份恢复'}
            </button>
            <button className="btn is-sm is-ghost" onClick={() => void window.api.data.openDir()}>
              打开数据目录
            </button>
          </div>
          <span className="setting-card-note">
            恢复会用备份替换当前的索引与设置，现有数据自动改名留底（后缀 <code>.bak-时间</code>），
            不会直接删除；画布原文件不受影响。恢复完成后程序会自动重启。
          </span>
        </section>

        <section className="setting-card">
          <div className="setting-card-head">
            <span className="setting-card-title">关于</span>
            <span className="setting-card-note">MIT 开源 · 完全离线</span>
          </div>
          <div className="about-brand">
            <CitrusMark size={44} />
            <div className="about-brand-text">
              <div className="about-brand-name">sai2工作台</div>
              <div className="about-brand-sub">SAI2 工程文件浏览器 · 启动台 · 插件宿主</div>
            </div>
          </div>
          <div className="setting-row">
            <span className="setting-label">版本</span>
            <span className="setting-value">v{runtime.version}（{runtime.isDev ? '开发模式' : '正式版'}）</span>
          </div>
          <div className="setting-row">
            <span className="setting-label">数据目录</span>
            <span className="setting-value" title={runtime.dataDir}>
              {runtime.dataDir}
            </span>
          </div>
          <div className="setting-row">
            <span className="setting-label">存储方式</span>
            <span className="setting-value">
              {runtime.portable ? '便携（数据在程序同级，拷走即迁移）' : '程序目录不可写，已回退到用户目录'}
            </span>
          </div>
          <div className="setting-row">
            <span className="setting-label">系统</span>
            <span className="setting-value">
              {runtime.platform} · build {runtime.windowsBuild}
            </span>
          </div>
        </section>
      </div>

      {crop ? (
        <CropDialog
          pending={crop}
          busy={applying}
          onCancel={() => void cancelCrop()}
          onApply={(png) => void applyCrop(png)}
        />
      ) : null}
    </div>
  )
}
