/**
 * Web 版后端 API 封装
 * 从 Taro 小程序版移植，wx.* → fetch / FormData
 */

// ========================
// 后端地址配置
// ========================
// 开发：直连 AutoDL
// 生产：用自有域名（Cloudflare / Vercel 代理）
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://u1100513-bdd3-419021b1.westb.seetacloud.com:8443'

// ========================
// 自定义错误类（便于前端 instanceof 判断）
// ========================

/** NSFW 需要人工复审（HTTP 202），前端可让用户选择「坚持上传」 */
export class NSFWReviewError extends Error {
  result: NSFWReviewRequired
  constructor(result: NSFWReviewRequired) {
    super(result.message || 'NSFW review required')
    this.name = 'NSFWReviewError'
    this.result = result
  }
}

/** NSFW 被拒（HTTP 400），不可覆盖 */
export class NSFWRejectedErrorErr extends Error {
  result: NSFWRejectedError
  constructor(result: NSFWRejectedError) {
    super(result.message || 'Image rejected by NSFW detection')
    this.name = 'NSFWRejectedErrorErr'
    this.result = result
  }
}

// ========================
// 类型定义（与小程序版一致）
// ========================

export interface TaskInfo {
  task_id: string
  status: 'pending' | 'running' | 'succeeded' | 'completed' | 'failed'
  message: string
  progress?: number
  result?: {
    psd_file?: string
    preview_images?: PreviewImage[]
    output_dir?: string
  }
  layers?: LayerInfo[]
  image_width: number
  image_height: number
  elapsed: number
}

export interface PreviewImage {
  name: string
  path: string
}

export interface LayerInfo {
  id: string
  name: string
  part_type: string
  group: string
  z_index: number
  bbox: { left: number; top: number; width: number; height: number } | null
  file_name: string
  file_size: number
  source: string
  _path?: string
}

export interface UploadOptions {
  resolution: number
  inferenceSteps: number
  tblrSplit: boolean
  skipNSFWCheck?: boolean  // 人工复审后覆盖提交时设为 true
}

// ========================
// NSFW 检测类型
// ========================

export interface NSFWLabel {
  name: string
  confidence: number  // 0-1
  parent_categories: string[]
}

export interface NSFWCheckResult {
  enabled: boolean       // NSFW 检测是否启用
  checked: boolean       // 是否实际执行了检测
  passed: boolean        // 是否通过（action == "pass"）
  action: 'pass' | 'review' | 'reject' | 'skipped'
  max_confidence: number // 0-1
  labels: NSFWLabel[]
  error: string
}

// /api/split 返回 202 时的响应体（需要人工复审）
export interface NSFWReviewRequired {
  code: 'NSFW_REVIEW_REQUIRED'
  message: string
  nsfw_result: NSFWCheckResult
}

// /api/split 返回 400 时的错误体（NSFW 被拒）
export interface NSFWRejectedError {
  code: 'NSFW_REJECTED'
  message: string
  nsfw_result: NSFWCheckResult
}

export interface HealthInfo {
  online: boolean
  status: string
  seethrough_available: boolean
  gpu_available: boolean
  nsfw_check_enabled: boolean   // NSFW 检测是否启用
  nsfw_check_available: boolean // NSFW 检测是否可用（AWS 凭证已配置）
  elapsed: number
  error: string
  error_tip: string
}

export const DEFAULT_HEALTH: HealthInfo = {
  online: false,
  status: '',
  seethrough_available: false,
  gpu_available: false,
  nsfw_check_enabled: false,
  nsfw_check_available: false,
  elapsed: 0,
  error: '',
  error_tip: '',
}

// ========================
// 工具函数（与小程序版一致）
// ========================

const LAYER_GROUPS: Record<string, string> = {
  'front hair': 'Hair', 'back hair': 'Hair',
  'headwear': 'Head Accessories', 'head': 'Head',
  'face': 'Face', 'irides': 'Eyes', 'eyebrow': 'Eyes',
  'eyewhite': 'Eyes', 'eyelash': 'Eyes', 'eyewear': 'Eyes',
  'ears': 'Ears', 'earwear': 'Ears',
  'nose': 'Nose', 'mouth': 'Mouth',
  'neck': 'Neck', 'neckwear': 'Neck',
  'topwear': 'Top', 'handwear': 'Hands',
  'bottomwear': 'Bottom', 'legwear': 'Legs', 'footwear': 'Feet',
  'tail': 'Extras', 'wings': 'Extras', 'objects': 'Extras',
  'src_img': 'Source', 'src_head': 'Source', 'reconstruction': 'Source',
}

export function normalizeLayers(task: TaskInfo): LayerInfo[] {
  if (task.result?.preview_images?.length) {
    const excludeNames = new Set(['src_img', 'src_head', 'reconstruction'])
    return task.result.preview_images
      .filter(img => {
        if (img.name.endsWith('_depth')) return false
        if (excludeNames.has(img.name)) return false
        return true
      })
      .map((img, idx) => ({
        id: img.name,
        name: img.name,
        part_type: img.name,
        group: LAYER_GROUPS[img.name] || 'Other',
        z_index: idx,
        bbox: null,
        file_name: img.path.split('/').pop() || `${img.name}.png`,
        file_size: 0,
        source: 'seethrough',
        _path: img.path,
      }))
  }
  return task.layers || []
}

export function isTaskDone(task: TaskInfo): boolean {
  return task.status === 'succeeded' || task.status === 'completed'
}

export function getLayerImageUrl(taskId: string, layer: LayerInfo): string {
  const customPath = (layer as any)._path
  if (customPath) {
    const encoded = customPath.split('/').map(encodeURIComponent).join('/')
    return `${API_BASE}/static/tasks/${taskId}/output/${encoded}`
  }
  return `${API_BASE}/api/task/${taskId}/layers/${layer.id}/download`
}

// ========================
// API 方法（fetch 替代 wx.request）
// ========================

const api = {
  /**
   * NSFW 内容检测（上传前预检）
   *
   * 调用后端 /api/check_nsfw，返回 AWS Rekognition 检测结果。
   * 前端根据 action 决定后续动作：
   *   - "pass" / "skipped" → 直接上传分割
   *   - "review" → 显示警告，用户可选择「取消」或「坚持上传」（后者用 skipNSFWCheck=true）
   *   - "reject" → 拒绝上传，不可覆盖
   */
  async checkNSFW(file: File): Promise<NSFWCheckResult> {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(`${API_BASE}/api/check_nsfw`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`NSFW check failed (HTTP ${res.status}): ${text}`)
    }

    return await res.json() as NSFWCheckResult
  },

  /**
   * 上传图片并启动分割
   *
   * NSFW 预检流程：
   *   - skipNSFWCheck=false（默认）：后端执行 NSFW 检测
   *     - 返回 200 → 正常拿到 task_id
   *     - 返回 202 → 需要人工复审（抛出 NSFWReviewError，含检测结果）
   *     - 返回 400 → NSFW 被拒（抛出 NSFWRejectedError，不可覆盖）
   *   - skipNSFWCheck=true：跳过检测（仅用于人工复审后的覆盖提交）
   */
  async uploadImage(file: File, options: UploadOptions): Promise<{ task_id: string; status: string }> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('resolution', String(options.resolution))
    formData.append('inference_steps', String(options.inferenceSteps))
    formData.append('tblr_split', options.tblrSplit ? 'true' : 'false')
    if (options.skipNSFWCheck) {
      formData.append('skip_nsfw_check', 'true')
    }

    const res = await fetch(`${API_BASE}/api/split`, {
      method: 'POST',
      body: formData,
    })

    // 200 → 正常成功
    if (res.ok) {
      const data = await res.json()
      if (!data.task_id) {
        throw new Error(`Response missing task_id: ${JSON.stringify(data)}`)
      }
      return data
    }

    // 202 → NSFW 需要人工复审
    if (res.status === 202) {
      const data = await res.json() as NSFWReviewRequired
      throw new NSFWReviewError(data)
    }

    // 400 → 可能是 NSFW 被拒，也可能是其他参数错误
    if (res.status === 400) {
      // 先读 body 文本（避免 res.json() 和 res.text() 重复消费）
      const text = await res.text().catch(() => '')
      let data: any
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = {}
      }
      // 检查是否是 NSFW 拒绝错误（FastAPI HTTPException 包成 {detail: {...}}）
      const detail = data.detail || data
      if (detail && detail.code === 'NSFW_REJECTED') {
        throw new NSFWRejectedErrorErr(detail as NSFWRejectedError)
      }
      throw new Error(`Upload failed (HTTP 400): ${text || JSON.stringify(detail)}`)
    }

    // 其他错误
    const text = await res.text().catch(() => '')
    throw new Error(`Upload failed (HTTP ${res.status}): ${text}`)
  },

  /**
   * 查询任务状态（带重试）
   * wx.request → fetch
   */
  async getTask(taskId: string, maxRetry = 3): Promise<TaskInfo> {
    let lastError: Error | null = null

    for (let i = 0; i < maxRetry; i++) {
      try {
        const res = await fetch(`${API_BASE}/api/task/${taskId}`, {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) {
          return await res.json() as TaskInfo
        }
        console.warn(`[getTask] HTTP ${res.status}, retry ${i + 1}/${maxRetry}`)
      } catch (err) {
        console.warn(`[getTask] Error, retry ${i + 1}/${maxRetry}:`, err)
        lastError = err as Error
      }
      if (i < maxRetry - 1) {
        await new Promise(r => setTimeout(r, 1500))
      }
    }
    throw lastError || new Error('Failed after retries')
  },

  /**
   * 获取图层图片 URL
   */
  getLayerUrl(taskId: string, layer: LayerInfo | string): string {
    if (typeof layer === 'string') {
      return `${API_BASE}/api/task/${taskId}/layers/${layer}/download`
    }
    return getLayerImageUrl(taskId, layer)
  },

  /**
   * 下载图层（浏览器直接触发下载）
   * wx.downloadFile → <a download>
   */
  async downloadLayer(taskId: string, layer: LayerInfo): Promise<void> {
    const url = this.getLayerUrl(taskId, layer)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = layer.file_name || `${layer.name}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  },

  /**
   * 下载 PSD 文件
   */
  async downloadPSD(taskId: string): Promise<void> {
    const url = `${API_BASE}/api/result/${taskId}/psd`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`PSD download failed (HTTP ${res.status})`)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `live2d_layers_${taskId}.psd`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  },

  /**
   * 健康检查
   * wx.request → fetch，保留完整的错误诊断逻辑
   */
  async healthCheck(): Promise<HealthInfo> {
    const t0 = Date.now()
    try {
      const res = await fetch(`${API_BASE}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(25000),
      })
      const elapsed = Date.now() - t0

      if (res.ok) {
        const d = await res.json()
        return {
          online: true,
          status: String(d.status || d.state || 'ok'),
          seethrough_available: !!(d.seethrough_available || d.seethrough_ok || d.seethrough),
          gpu_available: !!(d.gpu_available || d.gpu_ok || d.gpu),
          nsfw_check_enabled: !!d.nsfw_check_enabled,
          nsfw_check_available: !!d.nsfw_check_available,
          elapsed,
          error: '',
          error_tip: '',
        }
      }

      return {
        ...DEFAULT_HEALTH,
        elapsed,
        error: `HTTP ${res.status}`,
        error_tip: 'Backend responded abnormally, it may be starting up. Try again in 30 seconds.',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      let tip = 'Troubleshooting steps:'

      if (msg.includes('timeout') || msg.includes('abort')) {
        tip = 'Connection timeout. The backend may be starting up. Wait 30s and retry.'
      } else if (msg.includes('fetch') || msg.includes('network')) {
        tip = 'Network error. Check if the backend URL is correct and the service is running.'
      }

      return {
        ...DEFAULT_HEALTH,
        elapsed: Date.now() - t0,
        error: msg,
        error_tip: tip,
      }
    }
  },
}

export default api
