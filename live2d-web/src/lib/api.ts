/**
 * 后端 API 封装
 * 所有方法调用统一 request wrapper（自动处理：超时 / 状态码 / NSFW / toast 错误提示）
 */
import { http, getApiBase, UPLOAD_TIMEOUT } from './request'
import { AppError } from './errors'

// ============== Types ==============

export interface HealthInfo {
  status: 'online' | 'offline' | 'warning'
  gpu_ok: boolean
  model_loaded: boolean
  nsfw_check_available: boolean
  queue_size: number
  queue_limit: number
  avg_split_seconds: number
  version: string
  uptime_seconds: number
  gpu_memory_gb: number
  gpu_memory_used_gb: number
}

export interface LayerInfo {
  id: string
  name: string
  part_type: string
  file_name: string
  width: number
  height: number
  left: number
  top: number
  z_index: number
  group?: string
  url?: string
}

export interface TaskInfo {
  task_id: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  message?: string
  progress?: number
  elapsed: number
  resolution?: number
  inference_steps?: number
  nsfw_status?: 'PASS' | 'NSFW_REVIEW' | 'NSFW_REJECT' | 'SKIP'
  layers?: LayerInfo[]
  psd_url?: string
  original_url?: string
}

export interface UploadOptions {
  resolution?: number
  inference_steps?: number
  tblr_split?: boolean
  group_offload?: boolean
  /** 当 NSFW 需要 review 时的回调（让用户确认后再继续） */
  onNsfwReview?: (data: { score: number; labels: string[] }) => Promise<boolean>
  /** 上传进度回调 0-100 */
  onProgress?: (percent: number) => void
}

export interface NsfwResult {
  status: 'PASS' | 'NSFW_REVIEW' | 'NSFW_REJECT' | 'SKIP'
  score: number
  labels: string[]
  message?: string
}

export interface SplitInitiateResult {
  task_id: string
  status: string
  message?: string
  nsfw?: NsfwResult
}

// ============== Defaults ==============

export const DEFAULT_HEALTH: HealthInfo = {
  status: 'offline',
  gpu_ok: false,
  model_loaded: false,
  nsfw_check_available: false,
  queue_size: 0,
  queue_limit: 1,
  avg_split_seconds: 40,
  version: 'unknown',
  uptime_seconds: 0,
  gpu_memory_gb: 0,
  gpu_memory_used_gb: 0,
}

// ============== Helpers ==============

function safeResolve<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback)
}

const GROUP_ORDER = [
  'Head',
  'Face',
  'Torso',
  'Arm',
  'Leg',
  'Accessory',
  'Other',
]

const PART_GROUP_MAP: Record<string, string> = {
  // 头部类
  hair: 'Head',
  hair_front: 'Head',
  hair_back: 'Head',
  hair_side: 'Head',
  ahoge: 'Head',
  head: 'Head',
  // 脸部类
  face: 'Face',
  eyebrow: 'Face',
  eyelash: 'Face',
  eyewhite: 'Face',
  eye: 'Face',
  eye_left: 'Face',
  eye_right: 'Face',
  iris: 'Face',
  iris_left: 'Face',
  iris_right: 'Face',
  pupil: 'Face',
  nose: 'Face',
  mouth: 'Face',
  lip: 'Face',
  teeth: 'Face',
  tongue: 'Face',
  blush: 'Face',
  // 躯干类
  neck: 'Torso',
  body: 'Torso',
  torso: 'Torso',
  chest: 'Torso',
  breast: 'Torso',
  shirt: 'Torso',
  cloth: 'Torso',
  collar: 'Torso',
  // 手臂类
  arm: 'Arm',
  arm_left: 'Arm',
  arm_right: 'Arm',
  shoulder: 'Arm',
  shoulder_left: 'Arm',
  shoulder_right: 'Arm',
  sleeve: 'Arm',
  sleeve_left: 'Arm',
  sleeve_right: 'Arm',
  hand: 'Arm',
  hand_left: 'Arm',
  hand_right: 'Arm',
  finger: 'Arm',
  finger_left: 'Arm',
  finger_right: 'Arm',
  // 腿部类
  leg: 'Leg',
  leg_left: 'Leg',
  leg_right: 'Leg',
  thigh: 'Leg',
  thigh_left: 'Leg',
  thigh_right: 'Leg',
  calf: 'Leg',
  calf_left: 'Leg',
  calf_right: 'Leg',
  knee: 'Leg',
  foot: 'Leg',
  foot_left: 'Leg',
  foot_right: 'Leg',
  footwear: 'Leg',
  footwear_left: 'Leg',
  footwear_right: 'Leg',
  pants: 'Leg',
  skirt: 'Leg',
  sock: 'Leg',
  sock_left: 'Leg',
  sock_right: 'Leg',
  // 配饰类
  ears: 'Accessory',
  ears_left: 'Accessory',
  ears_right: 'Accessory',
  ear: 'Accessory',
  ear_left: 'Accessory',
  ear_right: 'Accessory',
  earwear: 'Accessory',
  earwear_left: 'Accessory',
  earwear_right: 'Accessory',
  earring: 'Accessory',
  earring_left: 'Accessory',
  earring_right: 'Accessory',
  eyewear: 'Accessory',
  glasses: 'Accessory',
  headset: 'Accessory',
  headwear: 'Accessory',
  hat: 'Accessory',
  hair_ornament: 'Accessory',
  hairpin: 'Accessory',
  bow: 'Accessory',
  ribbon: 'Accessory',
  necklace: 'Accessory',
  choker: 'Accessory',
  tie: 'Accessory',
  brooch: 'Accessory',
  button: 'Accessory',
  badge: 'Accessory',
  tail: 'Accessory',
  wings: 'Accessory',
  horn: 'Accessory',
  horn_left: 'Accessory',
  horn_right: 'Accessory',
  handwear: 'Accessory',
  handwear_left: 'Accessory',
  handwear_right: 'Accessory',
  glove: 'Accessory',
  bracelet: 'Accessory',
  ring: 'Accessory',
  other: 'Other',
}

export function partToGroup(partType: string): string {
  if (!partType) return 'Other'
  const direct = PART_GROUP_MAP[partType.toLowerCase()]
  if (direct) return direct
  // fuzzy prefix match
  const lower = partType.toLowerCase()
  for (const key of Object.keys(PART_GROUP_MAP)) {
    if (lower.includes(key)) return PART_GROUP_MAP[key]
  }
  return 'Other'
}

export function normalizeLayers(task: TaskInfo): LayerInfo[] {
  const raw = task.layers || []
  return raw
    .map((l) => ({
      ...l,
      group: l.group || partToGroup(l.part_type || l.name || ''),
    }))
    .sort((a, b) => (b.z_index || 0) - (a.z_index || 0))
}

export function groupLayers(
  layers: LayerInfo[]
): Record<string, LayerInfo[]> {
  const groups: Record<string, LayerInfo[]> = {}
  for (const l of layers) {
    const g = l.group || 'Other'
    if (!groups[g]) groups[g] = []
    groups[g].push(l)
  }
  // sort group keys
  const sorted: Record<string, LayerInfo[]> = {}
  for (const name of GROUP_ORDER) {
    if (groups[name]) sorted[name] = groups[name]
  }
  for (const name of Object.keys(groups)) {
    if (!sorted[name]) sorted[name] = groups[name]
  }
  return sorted
}

export function isTaskDone(task: TaskInfo): boolean {
  return task.status === 'done'
}

// ============== API ==============

/** 健康检查（失败时返回默认值，不抛错） */
export async function healthCheck(): Promise<HealthInfo> {
  try {
    const data = await http.get<any>('/api/health', { timeout: 5000 })
    const d = data && typeof data === 'object' ? data : {}
    return {
      status: d.status || (d.gpu_ok ? 'online' : 'offline'),
      gpu_ok: !!d.gpu_ok,
      model_loaded: !!d.model_loaded,
      nsfw_check_available: !!d.nsfw_check_available,
      queue_size: Number(d.queue_size) || 0,
      queue_limit: Number(d.queue_limit) || 1,
      avg_split_seconds: Number(d.avg_split_seconds) || 40,
      version: String(d.version || 'unknown'),
      uptime_seconds: Number(d.uptime_seconds) || 0,
      gpu_memory_gb: Number(d.gpu_memory_gb) || 0,
      gpu_memory_used_gb: Number(d.gpu_memory_used_gb) || 0,
    }
  } catch {
    return { ...DEFAULT_HEALTH }
  }
}

/** NSFW 预检（POST /api/check_nsfw） */
export async function checkNsfw(file: File | Blob): Promise<NsfwResult> {
  const fd = new FormData()
  fd.append('file', file)
  const data = await http.post<any>('/api/check_nsfw', fd, {
    timeout: 15000,
  })
  const d = data && typeof data === 'object' ? data : {}
  return {
    status: (d.nsfw_status || d.status || 'PASS') as NsfwResult['status'],
    score: Number(d.score) || 0,
    labels: Array.isArray(d.labels) ? d.labels : [],
    message: d.message,
  }
}

/** 上传图片并启动拆分（POST /api/split） */
export async function uploadImage(
  file: File | Blob,
  opts: UploadOptions = {}
): Promise<SplitInitiateResult> {
  const fd = new FormData()
  fd.append('file', file)
  const params: Record<string, string> = {}
  if (opts.resolution) params.resolution = String(opts.resolution)
  if (opts.inference_steps)
    params.inference_steps = String(opts.inference_steps)
  if (opts.tblr_split !== undefined)
    params.tblr_split = String(opts.tblr_split)
  if (opts.group_offload !== undefined)
    params.group_offload = String(opts.group_offload)
  const qs = Object.keys(params).length
    ? '?' +
      Object.keys(params)
        .map((k) => `${k}=${encodeURIComponent(params[k])}`)
        .join('&')
    : ''

  try {
    const data = await http.post<any>(`/api/split${qs}`, fd, {
      timeout: UPLOAD_TIMEOUT,
    })
    const d = data && typeof data === 'object' ? data : {}
    const nsfw: NsfwResult | undefined = d.nsfw
      ? {
          status: d.nsfw.nsfw_status || d.nsfw.status || 'PASS',
          score: Number(d.nsfw.score) || 0,
          labels: Array.isArray(d.nsfw.labels) ? d.nsfw.labels : [],
          message: d.nsfw.message,
        }
      : undefined

    // NSFW 需要用户确认（review）时的交互式处理
    if (nsfw?.status === 'NSFW_REVIEW' && opts.onNsfwReview) {
      const confirmed = await opts.onNsfwReview({
        score: nsfw.score,
        labels: nsfw.labels,
      })
      if (confirmed) {
        // 用户确认后，带上 override 参数重新发起
        const overrideQs =
          (qs ? qs + '&' : '?') + 'nsfw_override=REVIEW_CONFIRMED'
        const data2 = await http.post<any>(`/api/split${overrideQs}`, fd, {
          timeout: UPLOAD_TIMEOUT,
        })
        return {
          task_id: String(data2?.task_id || d.task_id),
          status: String(data2?.status || d.status || 'pending'),
          message: data2?.message || d.message,
        }
      }
    }

    return {
      task_id: String(d.task_id),
      status: String(d.status || 'pending'),
      message: d.message,
      nsfw,
    }
  } catch (err) {
    if (err instanceof AppError && err.code === 'NSFW_REVIEW') {
      // request.ts 也可能拦截抛出 NSFW_REVIEW，在这里处理
      if (opts.onNsfwReview) {
        const confirmed = await opts.onNsfwReview({ score: 0.6, labels: [] })
        if (confirmed) {
          return uploadImage(file, { ...opts, onNsfwReview: undefined })
        }
      }
    }
    throw err
  }
}

/** 查询任务状态 */
export async function getTask(taskId: string): Promise<TaskInfo> {
  const data = await http.get<any>(`/api/task/${taskId}`)
  const d = data && typeof data === 'object' ? data : {}
  return {
    task_id: String(d.task_id || taskId),
    status: (d.status || 'pending') as TaskInfo['status'],
    message: d.message,
    progress: Number(d.progress) || 0,
    elapsed: Number(d.elapsed) || 0,
    resolution: Number(d.resolution) || undefined,
    inference_steps: Number(d.inference_steps) || undefined,
    nsfw_status: d.nsfw_status,
    layers: Array.isArray(d.layers) ? (d.layers as LayerInfo[]) : [],
    psd_url: d.psd_url,
    original_url: d.original_url,
  }
}

/** 单个图层下载地址（未签名时直接返回，签名时由后端返回） */
export function getLayerUrl(taskId: string, layer: LayerInfo): string {
  const base = getApiBase()
  const name = layer.file_name || `${layer.id}.png`
  return `${base}/api/result/${taskId}/layers/${encodeURIComponent(name)}`
}

/** 下载单个图层（走浏览器 a.download） */
export async function downloadLayer(
  taskId: string,
  layer: LayerInfo
): Promise<void> {
  const url = getLayerUrl(taskId, layer)
  const resp = await fetch(url)
  if (!resp.ok) throw new AppError('NETWORK_ERROR', resp.status)
  const blob = await resp.blob()
  const blobUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = layer.file_name || `${layer.name || layer.id}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
  }
}

/** 下载 PSD */
export async function downloadPSD(taskId: string): Promise<void> {
  const base = getApiBase()
  const url = `${base}/api/result/${taskId}/psd`
  const resp = await fetch(url)
  if (!resp.ok) throw new AppError('NETWORK_ERROR', resp.status)
  const blob = await resp.blob()
  const blobUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `split_${taskId}.psd`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
  }
}

// 兼容之前的 default 导出
const api = {
  healthCheck: () => safeResolve(healthCheck(), { ...DEFAULT_HEALTH }),
  checkNsfw,
  uploadImage,
  getTask,
  getLayerUrl,
  downloadLayer,
  downloadPSD,
}
export default api
