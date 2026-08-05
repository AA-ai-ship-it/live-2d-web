/**
 * GIF / MP4 导出器
 *
 * GIF：逐帧手动渲染 → gifenc wasm 编码 → Blob
 * MP4/WebM：MediaRecorder + captureStream 实时录制
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { PixiStage } from './PixiStage'
import type { EffectDriver } from './effectSystem'

export interface GifExportOptions {
  width: number
  height: number
  duration: number       // ms
  fps?: number           // 默认 30
  onProgress?: (p: number) => void  // 0-1
}

export interface Mp4ExportOptions {
  duration: number       // ms
  fps?: number           // 默认 30
  mimeType?: string      // 默认自动检测
  onProgress?: (p: number) => void
}

/**
 * 导出 GIF
 * 流程：暂停 Ticker → 逐帧 renderAt → 抓帧 → quantize → writeFrame → finish
 */
export async function exportGif(
  stage: PixiStage,
  driver: EffectDriver,
  opts: GifExportOptions,
): Promise<Blob> {
  const { width, height, duration, fps = 30, onProgress } = opts
  const frameCount = Math.ceil((duration / 1000) * fps)
  const frameDelay = 1000 / fps

  // 暂停自动渲染
  stage.stop()

  // 离屏 canvas 用于抓帧（用导出尺寸，不是 PixiJS 的高 DPI 尺寸）
  const offscreen = document.createElement('canvas')
  offscreen.width = width
  offscreen.height = height
  const offCtx = offscreen.getContext('2d', { willReadFrequently: true })!

  const gif = GIFEncoder()
  const pixiCanvas = stage.getCanvas()

  for (let i = 0; i < frameCount; i++) {
    const time = i * frameDelay

    // 手动驱动效果 + 渲染
    driver.renderAt(time, frameDelay)
    stage.render()

    // 从 PixiJS canvas 抓帧到离屏 canvas
    offCtx.clearRect(0, 0, width, height)
    offCtx.drawImage(pixiCanvas, 0, 0, width, height)

    // 获取像素数据
    const { data } = offCtx.getImageData(0, 0, width, height)

    // 量化 + 索引（256 色）
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)

    // 写入 GIF 帧
    gif.writeFrame(index, width, height, {
      palette,
      delay: Math.round(frameDelay),
    })

    onProgress?.((i + 1) / frameCount)

    // 让出主线程（避免 UI 冻结）
    await new Promise((r) => setTimeout(r, 0))
  }

  gif.finish()

  // 恢复自动渲染
  stage.start()

  return new Blob([gif.bytes().buffer as ArrayBuffer], { type: 'image/gif' })
}

/**
 * 导出 MP4/WebM
 * 使用 MediaRecorder + canvas.captureStream 实时录制
 * 注意：Safari 只支持 video/mp4，Chrome 支持 video/webm
 */
export async function exportVideo(
  stage: PixiStage,
  driver: EffectDriver,
  opts: Mp4ExportOptions,
): Promise<{ blob: Blob; ext: string }> {
  const { duration, fps = 30, onProgress } = opts

  // 检测支持的 MIME 类型
  const mimeType = opts.mimeType || pickVideoMimeType()
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'

  const canvas = stage.getCanvas()
  const stream = canvas.captureStream(fps)

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  })

  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  // 暂停 Ticker，手动控制渲染
  stage.stop()
  recorder.start()

  const frameCount = Math.ceil((duration / 1000) * fps)
  const frameDelay = 1000 / fps

  for (let i = 0; i < frameCount; i++) {
    driver.renderAt(i * frameDelay, frameDelay)
    stage.render()
    onProgress?.((i + 1) / frameCount)
    // MediaRecorder 需要实时帧间隔
    await new Promise((r) => setTimeout(r, frameDelay))
  }

  recorder.stop()
  stage.start()

  // 等待 recorder 写入最后一帧
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  return { blob: new Blob(chunks, { type: mimeType }), ext }
}

function pickVideoMimeType(): string {
  const candidates = [
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t
    }
  }
  return 'video/webm'
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
}
