'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import api, {
  HealthInfo,
  DEFAULT_HEALTH,
  NSFWCheckResult,
  NSFWReviewError,
  NSFWRejectedErrorErr,
} from '@/lib/api'

const RESOLUTIONS = [
  { label: '512px (Fastest)', value: 512 },
  { label: '768px (Recommended)', value: 768 },
  { label: '1024px (HD)', value: 1024 },
]

export default function UploadPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [resolution, setResolution] = useState(768)
  const [tblrSplit, setTblrSplit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [health, setHealth] = useState<HealthInfo>({ ...DEFAULT_HEALTH })
  const [checking, setChecking] = useState(false)

  // NSFW 检测状态
  const [nsfwChecking, setNsfwChecking] = useState(false)
  // review 态：用户需要确认是否坚持上传
  const [nsfwReview, setNsfwReview] = useState<NSFWCheckResult | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
      setPreviewUrl(URL.createObjectURL(selected))
      setError('')
      // 切换图片时清空之前的 NSFW 复审状态
      setNsfwReview(null)
    }
  }

  const checkHealth = async () => {
    setChecking(true)
    try {
      const info = await api.healthCheck()
      setHealth(info)
    } catch {
      setHealth({ ...DEFAULT_HEALTH, error: 'Health check failed' })
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    checkHealth()
  }, [])

  /**
   * 启动分割流程（含 NSFW 预检）
   *
   * 流程：
   * 1. 前端先调 /api/check_nsfw 预检（快速反馈，避免浪费上传带宽）
   * 2. 根据结果：
   *    - pass / skipped → 直接调 /api/split
   *    - review → 显示警告，用户确认后用 skip_nsfw_check=true 调 /api/split
   *    - reject → 拒绝，不可覆盖
   * 3. /api/split 内部会再做一次 NSFW 检测（防止前端绕过）
   *    - 返回 202 → 同 review 流程
   *    - 返回 400 NSFW_REJECTED → 同 reject 流程
   */
  const startSplit = async (skipNSFW = false) => {
    if (!file) {
      setError('Please select an image first')
      return
    }
    if (!agreed) {
      setError('Please read and agree to the Terms of Service')
      return
    }
    if (!health.online) {
      setError('Backend is offline. Click "Check Status" to verify.')
      return
    }

    setLoading(true)
    setError('')

    try {
      // ====== 第一步：前端 NSFW 预检（仅当未跳过时）======
      if (!skipNSFW && health.nsfw_check_enabled) {
        setNsfwChecking(true)
        try {
          const nsfwResult = await api.checkNSFW(file)
          setNsfwChecking(false)

          if (nsfwResult.action === 'reject') {
            // 高置信度 NSFW：直接拒绝，不可覆盖
            setError(formatNSFWError(nsfwResult))
            setLoading(false)
            return
          }

          if (nsfwResult.action === 'review') {
            // 中等置信度：进入人工复审态，等用户确认
            setNsfwReview(nsfwResult)
            setLoading(false)
            return
          }

          // pass / skipped → 继续上传
        } catch (nsfwErr) {
          setNsfwChecking(false)
          // NSFW 预检失败不阻断流程，交给后端二次检测
          console.warn('[NSFW] Pre-check failed, will rely on backend check:', nsfwErr)
        }
      }

      // ====== 第二步：上传分割 ======
      const result = await api.uploadImage(file, {
        resolution,
        inferenceSteps: 20,
        tblrSplit,
        skipNSFWCheck: skipNSFW,  // 人工复审覆盖时跳过后端检测
      })
      router.push(`/result/${result.task_id}`)

    } catch (err) {
      // 后端返回 202：NSFW 需要人工复审
      if (err instanceof NSFWReviewError) {
        setNsfwReview(err.result.nsfw_result)
        setLoading(false)
        return
      }

      // 后端返回 400 NSFW_REJECTED：拒绝，不可覆盖
      if (err instanceof NSFWRejectedErrorErr) {
        setError(formatNSFWError(err.result.nsfw_result))
        setLoading(false)
        return
      }

      // 其他错误
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Upload failed: ${msg}`)
    } finally {
      setLoading(false)
      setNsfwChecking(false)
    }
  }

  // 格式化 NSFW 拒绝错误信息
  const formatNSFWError = (result: NSFWCheckResult): string => {
    const labels = result.labels.map(l =>
      `${l.name} (${Math.round(l.confidence * 100)}%)`
    ).join(', ')
    return `Image rejected: NSFW content detected [${labels}]. Please upload a different image.`
  }

  // 用户点击「坚持上传」（人工覆盖）
  const handleForceUpload = () => {
    setNsfwReview(null)
    startSplit(true)
  }

  // 用户点击「取消」
  const handleCancelReview = () => {
    setNsfwReview(null)
    setLoading(false)
  }

  const { online, gpu_available, seethrough_available, status, elapsed,
          error: hError, error_tip, nsfw_check_enabled, nsfw_check_available } = health
  const dotClass = online ? (gpu_available ? 'green' : 'yellow') : 'red'

  return (
    <div className="container">
      <div className="header">
        <h1>Live2D AI Layer Splitter</h1>
        <p>Upload an anime character image, AI splits it into transparent layers</p>
      </div>

      {/* Health Check */}
      <div className={`health-card ${dotClass}`}>
        <div className="health-row">
          <div className={`health-dot ${dotClass}`} />
          <span className="health-title">{online ? 'Backend Online' : 'Backend Offline'}</span>
          {elapsed > 0 && <span className="health-elapsed">{elapsed}ms</span>}
        </div>
        {online && (
          <div className="health-details">
            <div className="health-detail-row">
              <span className="detail-label">GPU</span>
              <span className={gpu_available ? 'detail-ok' : 'detail-bad'}>
                {gpu_available ? '✓ Available' : '✗ Unavailable'}
              </span>
            </div>
            <div className="health-detail-row">
              <span className="detail-label">Model</span>
              <span className={seethrough_available ? 'detail-ok' : 'detail-bad'}>
                {seethrough_available ? '✓ Loaded' : '✗ Not found'}
              </span>
            </div>
            <div className="health-detail-row">
              <span className="detail-label">NSFW</span>
              <span className={nsfw_check_available ? 'detail-ok' : (nsfw_check_enabled ? 'detail-bad' : 'detail-value')}>
                {nsfw_check_available ? '✓ Active' : (nsfw_check_enabled ? '✗ Unavailable' : 'Off')}
              </span>
            </div>
            <div className="health-detail-row">
              <span className="detail-label">Status</span>
              <span className="detail-value">{status || '-'}</span>
            </div>
          </div>
        )}
        {!online && hError && (
          <div>
            <div className="health-error">{hError}</div>
            {error_tip && <div className="health-tip">{error_tip}</div>}
          </div>
        )}
      </div>

      <button
        className="check-btn"
        onClick={checkHealth}
        disabled={checking}
      >
        {checking ? 'Checking...' : 'Check Backend Status'}
      </button>

      {/* Upload Area */}
      <div
        className={`upload-area ${previewUrl ? 'has-image' : ''}`}
        onClick={() => fileInputRef.current?.click()}
      >
        {previewUrl ? (
          <img className="preview-img" src={previewUrl} alt="Preview" />
        ) : (
          <div>
            <span className="placeholder-icon">+</span>
            <span className="placeholder-text">Click to upload image</span>
            <span className="placeholder-hint">Supports JPG / PNG / WebP · No NSFW content</span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {/* Options */}
      <div className="options">
        <div className="option-row">
          <span className="option-label">Resolution</span>
          <select
            value={resolution}
            onChange={(e) => setResolution(Number(e.target.value))}
          >
            {RESOLUTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        <div className="option-row">
          <span className="option-label">Left/Right Split</span>
          <div
            className={`switch ${tblrSplit ? 'on' : ''}`}
            onClick={() => setTblrSplit(!tblrSplit)}
          >
            <div className="switch-dot" />
          </div>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {/* NSFW 人工复审弹窗 */}
      {nsfwReview && (
        <div className="nsfw-review-overlay">
          <div className="nsfw-review-box">
            <div className="nsfw-review-icon">⚠</div>
            <h3 className="nsfw-review-title">Content Review Required</h3>
            <p className="nsfw-review-desc">
              The image was flagged by automated NSFW detection.
              Please review the detected labels below and decide whether to proceed.
            </p>
            <div className="nsfw-labels">
              {nsfwReview.labels.map((label, idx) => (
                <div className="nsfw-label-item" key={idx}>
                  <span className="nsfw-label-name">{label.name}</span>
                  <span className="nsfw-label-conf">
                    {Math.round(label.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
            <p className="nsfw-review-warning">
              ⚠ Continuing will log this action. Repeated violations may result in account suspension.
            </p>
            <div className="nsfw-review-actions">
              <button
                className="nsfw-btn-cancel"
                onClick={handleCancelReview}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="nsfw-btn-force"
                onClick={handleForceUpload}
                disabled={loading}
              >
                {loading ? 'Uploading...' : 'Continue Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agreement */}
      <div
        className="agreement-row"
        onClick={() => setAgreed(!agreed)}
      >
        <div className={`agreement-checkbox ${agreed ? 'checked' : ''}`}>
          {agreed && <span className="check-mark">✓</span>}
        </div>
        <span>I have read and agree to the</span>
        <a
          href="/terms"
          className="agreement-link"
          onClick={(e) => e.stopPropagation()}
        >
          Terms of Service
        </a>
      </div>

      <button
        className="start-btn"
        onClick={() => startSplit(false)}
        disabled={!file || loading || nsfwChecking || !agreed}
      >
        {nsfwChecking ? 'Checking content...' : (loading ? 'Uploading...' : 'Start Splitting')}
      </button>
    </div>
  )
}
