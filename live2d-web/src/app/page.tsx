'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useT } from '@/i18n/useT'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/toastStore'
import {
  uploadImage as apiUploadImage,
  checkNsfw as apiCheckNsfw,
  DEFAULT_HEALTH,
  type NsfwResult,
} from '@/lib/api'
import { AppError } from '@/lib/errors'

const RESOLUTIONS = [
  { px: 512, tagKey: 'options.resolution.fastest' },
  { px: 768, tagKey: 'options.resolution.recommended', recommended: true },
  { px: 1024, tagKey: 'options.resolution.hd' },
]

export default function UploadPage() {
  const { t, locale } = useT()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- Zustand Store（跨页面共享） ----
  const health = useAppStore((s) => s.health)
  const nsfw = useAppStore((s) => s.nsfw)
  const setNsfw = useAppStore((s) => s.setNsfw)
  const setTask = useAppStore((s) => s.setTask)
  const clearTask = useAppStore((s) => s.clearTask)
  const loadHealth = useAppStore((s) => s.loadHealth)

  // ---- 页面私有 State ----
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [resolution, setResolution] = useState(768)
  const [tblrSplit, setTblrSplit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [healthExpanded, setHealthExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [nsfwChecking, setNsfwChecking] = useState(false)
  const [nsfwReviewPopup, setNsfwReviewPopup] = useState<NsfwResult | null>(
    null
  )

  // ---- Derived ----
  const online = health.status !== 'offline'
  const gpuAvailable = health.gpu_ok
  const modelLoaded = health.model_loaded
  const dotClass = online ? (gpuAvailable ? 'green' : 'yellow') : 'red'
  const nsfwEnabled = !!nsfw || !!health.nsfw_check_available ? true : false

  // ---- 首次加载健康检查（带节流）----
  useEffect(() => {
    loadHealth(false).catch(() => {})
  }, [loadHealth])

  // ---- 文件变更 ----
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
      setPreviewUrl(URL.createObjectURL(selected))
      setNsfwReviewPopup(null)
      clearTask()
      setNsfw(null)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const selected = e.dataTransfer.files?.[0]
    if (selected && selected.type.startsWith('image/')) {
      setFile(selected)
      setPreviewUrl(URL.createObjectURL(selected))
      setNsfwReviewPopup(null)
      clearTask()
      setNsfw(null)
    }
  }

  // ---- 手动刷新健康检查 ----
  const checkHealth = useCallback(async () => {
    setChecking(true)
    try {
      const info = await loadHealth(true)
      if (info.status === 'offline') setHealthExpanded(true)
    } catch {
      /* ignore */
    } finally {
      setChecking(false)
    }
  }, [loadHealth])

  // ---- 启动拆分（含 NSFW 预检 + Review 交互）----
  const startSplit = async (skipNSFW = false) => {
    if (!file) {
      toast.error(t('error.selectImage'))
      return
    }
    if (!agreed) {
      toast.warn(t('error.agreeTerms'))
      return
    }
    if (!online) {
      toast.error(t('error.backendOffline'))
      return
    }

    setLoading(true)

    try {
      // 第一步：前端 NSFW 预检（快，避免浪费带宽）
      if (!skipNSFW && (nsfw || nsfwEnabled || gpuAvailable)) {
        setNsfwChecking(true)
        try {
          const nsfwRes = await apiCheckNsfw(file)
          setNsfw(nsfwRes)
          setNsfwChecking(false)

          if (nsfwRes.status === 'NSFW_REJECT') {
            toast.error(
              `${t('error.nsfwRejected')}${
                nsfwRes.message ? ': ' + nsfwRes.message : ''
              }`
            )
            setLoading(false)
            return
          }
          if (nsfwRes.status === 'NSFW_REVIEW') {
            // 进入人工复审态
            setNsfwReviewPopup(nsfwRes)
            setLoading(false)
            return
          }
        } catch (err) {
          setNsfwChecking(false)
          // 预检失败不阻断，由后端二次检测兜底
          console.warn('[NSFW] pre-check failed, relying on backend', err)
        }
      }

      // 第二步：上传 + 启动拆分
      const init = await apiUploadImage(file, {
        resolution,
        inference_steps: 20,
        tblr_split: tblrSplit,
        onNsfwReview: async ({ score, labels }) => {
          // 后端返回 NSFW_REVIEW 时的二次确认
          const confirmed = window.confirm(
            `${t('nsfw.title')} (score: ${(score * 100).toFixed(
              0
            )}%)\n${t('nsfw.continue')}?`
          )
          return confirmed
        },
      })

      // 写入 Store，结果页/动画实验室直接读
      setTask({
        task_id: init.task_id,
        status: 'processing',
        message: init.message,
        elapsed: 0,
        resolution,
        inference_steps: 20,
        nsfw_status: nsfw?.status || nsfwReviewPopup?.status || 'PASS',
      })
      router.push(`/result/${init.task_id}`)
    } catch (err) {
      setLoading(false)
      if (err instanceof AppError) {
        if (err.code === 'NSFW_REJECT') {
          toast.error(
            err.getMessage(locale) +
              (err.rawMessage ? ': ' + err.rawMessage : '')
          )
          return
        }
        if (err.code === 'NSFW_REVIEW') {
          setNsfwReviewPopup({
            status: 'NSFW_REVIEW',
            score: 0.6,
            labels: [],
            message: err.rawMessage,
          })
          return
        }
        toast.error(err.getMessage(locale))
        return
      }
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(t('error.uploadFailed', { message: msg }))
    }
  }

  // ---- 用户坚持上传（人工覆盖 NSFW review）----
  const handleForceUpload = () => {
    setNsfwReviewPopup(null)
    startSplit(true)
  }

  // ---- UI ----
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

      {/* ====== Health Bar ====== */}
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
            <span>
              {online
                ? t('health.online')
                : t('health.offline')}
            </span>
            {online && (
              <>
                <span className="sep">·</span>
                <span className={`badge ${gpuAvailable ? 'ok' : 'bad'}`}>
                  {t('health.gpu')} {gpuAvailable ? '✓' : '✗'}
                </span>
                <span className="sep">·</span>
                <span className={`badge ${modelLoaded ? 'ok' : 'bad'}`}>
                  {t('health.model')} {modelLoaded ? '✓' : '✗'}
                </span>
                <span className="sep">·</span>
                <span className="badge muted">
                  {t('health.queue')} {health.queue_size}/{health.queue_limit}
                </span>
              </>
            )}
          </div>
          <span className="health-elapsed">
            {health.avg_split_seconds > 0
              ? `${health.avg_split_seconds}s/task`
              : ''}
          </span>
          <svg
            className={`refresh-icon ${checking ? 'spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            onClick={(e) => {
              e.stopPropagation()
              checkHealth()
            }}
          >
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </div>

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
                    <span className={gpuAvailable ? 'ok' : 'bad'}>
                      {gpuAvailable
                        ? t('health.available')
                        : t('health.unavailable')}
                    </span>
                  </div>
                  <div className="row">
                    <span className="label">{t('health.model')}</span>
                    <span className={modelLoaded ? 'ok' : 'bad'}>
                      {modelLoaded ? t('health.loaded') : t('health.notFound')}
                    </span>
                  </div>
                  <div className="row">
                    <span className="label">{t('health.nsfw')}</span>
                    <span className="val">
                      {nsfwEnabled ? t('health.active') : t('health.off')}
                    </span>
                  </div>
                  <div className="row">
                    <span className="label">GPU VRAM</span>
                    <span className="val">
                      {health.gpu_memory_used_gb.toFixed(1)} / {health.gpu_memory_gb.toFixed(1)} GB
                    </span>
                  </div>
                  <div className="row">
                    <span className="label">{t('health.status')}</span>
                    <span className="val">
                      {health.status} · v{health.version}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="health-detail">
                  <div className="health-error">
                    {t('health.offlineTip')}
                  </div>
                  <div className="health-tip">
                    {t('health.offlineHint')}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ====== Upload Area ====== */}
      <motion.div
        className={`upload-area ${previewUrl ? 'has-image' : ''} ${dragging ? 'dragging' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
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
              onClick={(e) => {
                e.stopPropagation()
                fileInputRef.current?.click()
              }}
            >
              {t('upload.change')}
            </button>
            <div className="preview-wrap">
              <img
                className="preview-img"
                src={previewUrl}
                alt="Preview"
              />
            </div>
          </>
        ) : (
          <div>
            <div className="upload-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
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
        <div className="res-grid">
          {RESOLUTIONS.map((r) => (
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
        <div className="option-row">
          <div>
            <span className="option-label">
              {t('options.tblrSplit.label')}
            </span>
            <span className="option-desc">
              {t('options.tblrSplit.desc')}
            </span>
          </div>
          <div
            className={`switch ${tblrSplit ? 'on' : ''}`}
            onClick={() => setTblrSplit(!tblrSplit)}
          >
            <div className="switch-dot" />
          </div>
        </div>
      </motion.div>

      {/* ====== NSFW 人工复审弹窗 ====== */}
      <AnimatePresence>
        {nsfwReviewPopup && (
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
              {nsfwReviewPopup.score > 0 && (
                <div className="nsfw-labels">
                  <div className="nsfw-label-item">
                    <span className="nsfw-label-name">
                      {t('nsfw.riskScore')}
                    </span>
                    <span className="nsfw-label-conf">
                      {(nsfwReviewPopup.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  {(nsfwReviewPopup.labels || []).slice(0, 4).map((l, i) => (
                    <div className="nsfw-label-item" key={i}>
                      <span className="nsfw-label-name">{l}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="nsfw-review-warning">{t('nsfw.warning')}</p>
              <div className="nsfw-review-actions">
                <button
                  className="nsfw-btn-cancel"
                  onClick={() => setNsfwReviewPopup(null)}
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
        {nsfwChecking
          ? t('action.checking')
          : loading
            ? t('action.uploading')
            : t('action.start')}
        {!loading && !nsfwChecking && <span className="arrow">→</span>}
      </motion.button>

      {/* ====== Animation Lab 入口 ====== */}
      <motion.div
        className="animate-entry"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
      >
        <button
          className="animate-link-btn"
          onClick={() => router.push('/animate')}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 3l14 9-14 9V3z" />
          </svg>
          <span>Animation Lab (Demo)</span>
        </button>
      </motion.div>
    </div>
  )
}
