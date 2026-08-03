'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import api, {
  HealthInfo,
  DEFAULT_HEALTH,
  NSFWCheckResult,
  NSFWReviewError,
  NSFWRejectedErrorErr,
} from '@/lib/api'
import { useT } from '@/i18n/useT'

const RESOLUTIONS = [
  { px: 512, tagKey: 'options.resolution.fastest' },
  { px: 768, tagKey: 'options.resolution.recommended', recommended: true },
  { px: 1024, tagKey: 'options.resolution.hd' },
]

export default function UploadPage() {
  const t = useT()
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
  const [healthExpanded, setHealthExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)

  // NSFW 检测状态
  const [nsfwChecking, setNsfwChecking] = useState(false)
  const [nsfwReview, setNsfwReview] = useState<NSFWCheckResult | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
      setPreviewUrl(URL.createObjectURL(selected))
      setError('')
      setNsfwReview(null)
    }
  }

  // 拖拽上传
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const selected = e.dataTransfer.files?.[0]
    if (selected && selected.type.startsWith('image/')) {
      setFile(selected)
      setPreviewUrl(URL.createObjectURL(selected))
      setError('')
      setNsfwReview(null)
    }
  }

  const checkHealth = async () => {
    setChecking(true)
    try {
      const info = await api.healthCheck()
      setHealth(info)
      // 离线时自动展开详情
      if (!info.online) setHealthExpanded(true)
    } catch {
      setHealth({ ...DEFAULT_HEALTH, error: 'Health check failed' })
      setHealthExpanded(true)
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
      setError(t('error.selectImage'))
      return
    }
    if (!agreed) {
      setError(t('error.agreeTerms'))
      return
    }
    if (!health.online) {
      setError(t('error.backendOffline'))
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
      setError(t('error.uploadFailed', { message: msg }))
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
    return t('error.nsfwRejected', { labels })
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
      {/* ====== Hero ====== */}
      <motion.div
        className="hero"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="brand-row">
          {/* SVG Logo：三层堆叠，象征图层拆分 */}
          <svg className="brand-logo" viewBox="0 0 36 36" fill="none">
            <rect x="6" y="6" width="20" height="20" rx="4" fill="url(#g1)" opacity="0.4" />
            <rect x="10" y="10" width="20" height="20" rx="4" fill="url(#g1)" opacity="0.7" />
            <rect x="14" y="14" width="20" height="20" rx="4" fill="url(#g1)" />
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="36" y2="36">
                <stop stopColor="#7c5cff" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
          </svg>
          <span className="brand-name">{t('brand.name')}</span>
        </div>
        <h1>{t('brand.tagline')}</h1>
        <p className="hero-subtitle">{t('brand.subtitle')}</p>
      </motion.div>

      {/* ====== Health Bar（紧凑状态条）====== */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div
          className="health-bar"
          onClick={() => setHealthExpanded(!healthExpanded)}
        >
          <div className={`dot ${dotClass}`} />
          <div className="health-summary">
            <span>{online ? t('health.online') : t('health.offline')}</span>
            {online && (
              <>
                <span className="sep">·</span>
                <span className={`badge ${gpu_available ? 'ok' : 'bad'}`}>
                  {t('health.gpu')} {gpu_available ? '✓' : '✗'}
                </span>
                <span className="sep">·</span>
                <span className={`badge ${seethrough_available ? 'ok' : 'bad'}`}>
                  {t('health.model')} {seethrough_available ? '✓' : '✗'}
                </span>
                {nsfw_check_enabled && (
                  <>
                    <span className="sep">·</span>
                    <span className={`badge ${nsfw_check_available ? 'ok' : 'muted'}`}>
                      {t('health.nsfw')} {nsfw_check_available ? '✓' : '—'}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          {elapsed > 0 && <span className="health-elapsed">{elapsed}ms</span>}
          <svg
            className={`refresh-icon ${checking ? 'spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            onClick={(e) => { e.stopPropagation(); checkHealth() }}
          >
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </div>

        {/* 展开详情 / 离线错误 */}
        <AnimatePresence>
          {healthExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              {online ? (
                <div className="health-detail">
                  <div className="row">
                    <span className="label">{t('health.gpu')}</span>
                    <span className={gpu_available ? 'ok' : 'bad'}>
                      {gpu_available ? t('health.available') : t('health.unavailable')}
                    </span>
                  </div>
                  <div className="row">
                    <span className="label">{t('health.model')}</span>
                    <span className={seethrough_available ? 'ok' : 'bad'}>
                      {seethrough_available ? t('health.loaded') : t('health.notFound')}
                    </span>
                  </div>
                  <div className="row">
                    <span className="label">{t('health.nsfw')}</span>
                    <span className={nsfw_check_available ? 'ok' : 'val'}>
                      {nsfw_check_available ? t('health.active') : (nsfw_check_enabled ? t('health.unavailable') : t('health.off'))}
                    </span>
                  </div>
                  <div className="row">
                    <span className="label">{t('health.status')}</span>
                    <span className="val">{status || '—'}</span>
                  </div>
                </div>
              ) : (
                hError && (
                  <div className="health-detail">
                    <div className="health-error">{hError}</div>
                    {error_tip && <div className="health-tip">{error_tip}</div>}
                  </div>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ====== Upload Area ====== */}
      <motion.div
        className={`upload-area ${previewUrl ? 'has-image' : ''} ${dragging ? 'dragging' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        whileHover={{ y: -2 }}
      >
        {previewUrl ? (
          <>
            <button
              className="change-btn"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
            >
              {t('upload.change')}
            </button>
            <div className="preview-wrap">
              <img className="preview-img" src={previewUrl} alt="Preview" />
            </div>
          </>
        ) : (
          <div>
            <div className="upload-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <span className="upload-text">{t('upload.hint')}</span>
            <span className="upload-hint">{t('upload.formats')}</span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </motion.div>

      {/* ====== Settings Card ====== */}
      <motion.div
        className="settings-card"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <div className="settings-title">{t('options.title')}</div>

        {/* 分辨率卡片选择器 */}
        <div className="res-grid">
          {RESOLUTIONS.map(r => (
            <div
              key={r.px}
              className={`res-card ${resolution === r.px ? 'active' : ''}`}
              onClick={() => setResolution(r.px)}
            >
              <span className="px">{r.px}px</span>
              <span className={`tag ${r.recommended ? 'recommended' : ''}`}>
                {t(r.tagKey)}
              </span>
            </div>
          ))}
        </div>

        {/* 左右拆分开关 */}
        <div className="option-row">
          <div>
            <span className="option-label">{t('options.tblrSplit.label')}</span>
            <span className="option-desc">{t('options.tblrSplit.desc')}</span>
          </div>
          <div
            className={`switch ${tblrSplit ? 'on' : ''}`}
            onClick={() => setTblrSplit(!tblrSplit)}
          >
            <div className="switch-dot" />
          </div>
        </div>
      </motion.div>

      {error && (
        <motion.div
          className="error-msg"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          {error}
        </motion.div>
      )}

      {/* ====== NSFW 人工复审弹窗 ====== */}
      <AnimatePresence>
        {nsfwReview && (
          <motion.div
            className="nsfw-review-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="nsfw-review-box"
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            >
              <div className="nsfw-review-icon">⚠</div>
              <h3 className="nsfw-review-title">{t('nsfw.title')}</h3>
              <p className="nsfw-review-desc">{t('nsfw.desc')}</p>
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
              <p className="nsfw-review-warning">{t('nsfw.warning')}</p>
              <div className="nsfw-review-actions">
                <button
                  className="nsfw-btn-cancel"
                  onClick={handleCancelReview}
                  disabled={loading}
                >
                  {t('nsfw.cancel')}
                </button>
                <button
                  className="nsfw-btn-force"
                  onClick={handleForceUpload}
                  disabled={loading}
                >
                  {loading ? t('action.uploading') : t('nsfw.continue')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ====== Agreement ====== */}
      <motion.div
        className="agreement-row"
        onClick={() => setAgreed(!agreed)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <div className={`agreement-checkbox ${agreed ? 'checked' : ''}`}>
          {agreed && <span className="check-mark">✓</span>}
        </div>
        <span>{t('terms.agree')}</span>
        <a
          href="/terms"
          className="agreement-link"
          onClick={(e) => e.stopPropagation()}
        >
          {t('terms.link')}
        </a>
      </motion.div>

      {/* ====== Start Button ====== */}
      <motion.button
        className="start-btn"
        onClick={() => startSplit(false)}
        disabled={!file || loading || nsfwChecking || !agreed}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        whileHover={{ y: -2 }}
        whileTap={{ y: 0 }}
      >
        {nsfwChecking ? t('action.checking') : (loading ? t('action.uploading') : t('action.start'))}
        {!loading && !nsfwChecking && (
          <span className="arrow">→</span>
        )}
      </motion.button>
    </div>
  )
}
