import { useMemo, type ReactElement } from 'react'
import type { ProjectFile, RuntimeInfo, Tag } from '@shared/types'
import { useFiles } from '../store/files'
import { useMeta } from '../store/meta'
import { IconExternal, IconImage } from './Icons'
import { ProjectSelect } from './ProjectSelect'
import { TagInput } from './TagInput'

/**
 * 右侧详情面板（需求 F4 / M2b T3.5）。
 *
 * 未选中时是空态 + 运行环境；选中后是大图 + 元信息 + 项目 + 标签 + 定位。
 *
 * 大图直接用 `sai2img://thumb/<key>`（512 长边的缓存图）。面板最宽 400px，
 * 2 倍屏要 800px 才够锐，但这里只是"确认是不是这张"，512 已经够用，
 * 为它再生成一份大图会把缓存体积翻倍。
 */

const EXT_LABEL: Record<string, string> = {
  '.sai2': 'SAI2',
  '.sai': 'SAI',
  '.psd': 'PSD',
  '.psb': 'PSB',
  '.clip': 'CLIP',
  '.kra': 'KRA',
  '.png': 'PNG',
  '.jpg': 'JPG',
  '.jpeg': 'JPG',
  '.webp': 'WEBP'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function tailDir(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.slice(-2).join('\\') || dir
}

export function DetailsPanel({
  runtime,
  watchCount,
  file,
  toast
}: {
  runtime: RuntimeInfo
  watchCount: number
  file: ProjectFile | null
  toast: (msg: string) => void
}): ReactElement {
  const tags = useMeta((s) => s.tags)
  const projects = useMeta((s) => s.projects)
  const createProject = useMeta((s) => s.createProject)
  const setFileTags = useFiles((s) => s.setFileTags)
  const setFileProject = useFiles((s) => s.setFileProject)

  const extLabel = file ? (EXT_LABEL[file.ext] ?? file.ext.replace('.', '').toUpperCase()) : ''
  const src = file?.thumbKey ? `sai2img://thumb/${file.thumbKey}.jpg` : ''

  // 大图高度按画布比例算，最多 260px：竖版长图不能把面板撑得只剩一条缝
  const shotRatio = file?.canvas ? file.canvas.width / file.canvas.height : 1
  const shotHeight = useMemo(() => {
    const ratio = Math.min(1.6, Math.max(0.5, shotRatio))
    return Math.round(Math.min(260, 250 / ratio))
  }, [shotRatio])

  const onTags = (next: string[]): void => {
    if (!file) return
    void setFileTags(file.path, next).then((res) => {
      if (!res.ok) toast(res.error ?? '标签保存失败')
    })
  }

  const onProject = (id: number | null): void => {
    if (!file) return
    void setFileProject(file.path, id).then((res) => {
      if (!res.ok) toast(res.error ?? '项目归属保存失败')
    })
  }

  if (!file) {
    return (
      <aside className="details glass-edge">
        <div className="panel-head">
          <span className="panel-title">详情</span>
          <span className="tag">未选中</span>
        </div>
        <div className="panel-body">
          <div className="empty" style={{ minHeight: 180 }}>
            <div className="empty-mark">
              <IconImage size={22} />
            </div>
            <div className="empty-title">还没有选中文件</div>
            <div className="empty-desc">
              在中间卡片区点一张稿子，这里会显示大图、画布尺寸、项目归属和标签。
            </div>
          </div>

          <div className="tile" style={{ gap: 8 }}>
            <div className="tile-title">运行环境</div>
            <div className="setting-row">
              <span className="setting-label">版本</span>
              <span className="setting-value">v{runtime.version}</span>
            </div>
            <div className="setting-row">
              <span className="setting-label">数据目录</span>
              <span className="setting-value" title={runtime.dataDir}>
                {runtime.portable ? '便携（程序同级）' : '用户目录'}
              </span>
            </div>
            <div className="setting-row">
              <span className="setting-label">监听目录</span>
              <span className="setting-value">{watchCount} 个</span>
            </div>
            <div className="setting-row">
              <span className="setting-label">窗口</span>
              <span className="setting-value">透明 · 自绘玻璃</span>
            </div>
          </div>
        </div>
      </aside>
    )
  }

  const tagNames = (file.tags ?? []).map((t: Tag) => t.name)
  const project = file.project ?? null

  return (
    <aside className="details glass-edge">
      <div className="panel-head">
        <span className="panel-title">详情</span>
        <span className="tag">{extLabel}</span>
      </div>

      <div className="panel-body">
        <div className="detail-shot" style={{ height: shotHeight }}>
          {src && file.thumb?.state !== 'fail' ? (
            <img src={src} alt="" draggable={false} />
          ) : (
            <div className="detail-shot-fallback">
              <span className="file-card-ext">{extLabel}</span>
              <span className="file-card-meta">
                {file.canvas ? `${file.canvas.width} × ${file.canvas.height}` : '暂无预览'}
              </span>
            </div>
          )}
        </div>

        <div className="detail-name" title={file.path}>
          {file.name}
        </div>

        <div className="detail-rows">
          <div className="detail-row">
            <span className="detail-label">画布</span>
            <span className="detail-value">
              {file.canvas ? `${file.canvas.width} × ${file.canvas.height}` : '未知'}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">大小</span>
            <span className="detail-value">{formatSize(file.size)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">修改</span>
            <span className="detail-value">{formatTime(file.mtimeMs)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">位置</span>
            <span className="detail-value is-mono" title={file.dir}>
              {tailDir(file.dir)}
            </span>
          </div>
        </div>

        <div className="detail-block">
          <div className="detail-block-title">
            项目
            {project?.client ? <span className="detail-client">客户 · {project.client}</span> : null}
          </div>
          <ProjectSelect
            value={file.projectId ?? null}
            projects={projects}
            onChange={onProject}
            onCreate={async (name, client) => {
              const created = await createProject(name, client)
              if (!created) toast('项目创建失败')
              return created
            }}
          />
        </div>

        <div className="detail-block">
          <div className="detail-block-title">标签</div>
          <TagInput value={tagNames} options={tags} onChange={onTags} />
        </div>

        <button
          className="btn is-sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            void window.api.files.reveal(file.path).then((res) => {
              if (!res.ok) toast(res.error ?? '定位失败')
            })
          }}
        >
          <IconExternal size={13} />
          在资源管理器中定位
        </button>
      </div>
    </aside>
  )
}
