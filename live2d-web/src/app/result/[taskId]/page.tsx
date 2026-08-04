'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/toastStore'
import { getTask, downloadLayer, downloadPSD, isTaskDone, getLayerUrl, LayerInfo } from '@/lib/api'
import { AppError } from '@/lib/errors'
import { useT } from '@/i18n/useT'

const POLL_INTERVAL = 2500
const MAX_POLL_DURATION = 15 * 60 * 1000

export default function ResultPage() {
  const params = useParams()
  const router = useRouter()
  const urlTaskId = params.taskId as string

  const { t, locale } = useT()

  const storeTaskId = useAppStore((s) => s.taskId)
  const task = useAppStore((s) => s.task)
  const layers = useAppStore((s) => s.layers)
  const groups = useAppStore((s) => s.groups)
  const setTask = useAppStore((s) => s.setTask)
  const clearTask = useAppStore((s) => s.clearTask)

  const [loading, setLoading] = useState(true)
  const [timedOut, setTimedOut] = useState(false)
  const [downloadingId, setDownloadingId] = useState('')
  const [downloadingPSD, setDownloadingPSD] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeRef = useRef(0)

  useEffect(() => {
    if (!urlTaskId) {
      toast.error(t('result.missingTaskId', 'Missing task ID'))
      setLoading(false)
      return
    }

    if (storeTaskId === urlTaskId && task && isTaskDone(task)) {
      setLoading(false)
      return
    }

    startTimeRef.current = Date.now()
    pollTask(urlTaskId)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [urlTaskId])

  const pollTask = (id: string) => {
    getTask(id)
      .then((res) => {
        setTask(res)
        setTimedOut(false)
        if (isTaskDone(res) || res.status === 'failed') {
          setLoading(false)
          return
        }
        if (Date.now() - startTimeRef.current > MAX_POLL_DURATION) {
          setTimedOut(true)
          setLoading(false)
          toast.warn(t('result.timeout', 'Task timed out'))
          return
        }
        timerRef.current = setTimeout(() => pollTask(id), POLL_INTERVAL)
      })
      .catch((err) => {
        const msg = err instanceof AppError
          ? err.getMessage(locale)
          : t('result.pollError', 'Failed to check task status')
        toast.error(msg)
        if (Date.now() - startTimeRef.current > MAX_POLL_DURATION) {
          setTimedOut(true)
          setLoading(false)
        } else {
          timerRef.current = setTimeout(() => pollTask(id), POLL_INTERVAL)
        }
      })
  }

  const handleContinueWaiting = () => {
    setTimedOut(false)
    setLoading(true)
    startTimeRef.current = Date.now()
    pollTask(urlTaskId)
  }

  const handleDownload = async (layer: LayerInfo) => {
    if (!urlTaskId) return
    setDownloadingId(layer.id)
    try {
      await downloadLayer(urlTaskId, layer)
    } catch (err) {
      const msg = err instanceof AppError
        ? err.getMessage(locale)
        : t('result.downloadFailed', 'Download failed')
      toast.error(msg)
      window.open(getLayerUrl(urlTaskId, layer), '_blank')
    } finally {
      setDownloadingId('')
    }
  }

  const handleDownloadPSD = async () => {
    if (!urlTaskId) return
    setDownloadingPSD(true)
    try {
      await downloadPSD(urlTaskId)
    } catch (err) {
      const msg = err instanceof AppError
        ? err.getMessage(locale)
        : t('result.psdDownloadFailed', 'PSD download failed')
      toast.error(msg)
      window.open(`${process.env.NEXT_PUBLIC_API_BASE || ''}/api/result/${urlTaskId}/psd`, '_blank')
    } finally {
      setDownloadingPSD(false)
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner" />
          <div className="loading-text">{task?.message || t('result.queuing', 'Queuing...')}</div>
          <div className="loading-hint">{t('result.loadingHint', 'AI is splitting layers, estimated 30-60 seconds')}</div>
          {task && task.elapsed > 0 && (
            <div className="loading-elapsed">{t('result.elapsed', 'Elapsed: {s}s', { s: Math.round(task.elapsed) })}</div>
          )}
        </div>
      </div>
    )
  }

  if (task?.status === 'failed') {
    return (
      <div className="container">
        <div className="error-box">
          <span className="error-icon">!</span>
          <span className="error-title">{t('result.failed', 'Split Failed')}</span>
          <div className="error-msg">{task?.message || t('result.unknownError', 'Unknown error')}</div>
          {urlTaskId && <span className="error-detail">{t('result.taskId', 'Task ID: {id}', { id: urlTaskId })}</span>}
          {task?.status && <span className="error-detail">{t('result.status', 'Status: {s}', { s: task.status })}</span>}
          <button className="retry-btn" onClick={() => { clearTask(); router.push('/') }}>
            {t('result.retry', 'Retry')}
          </button>
        </div>
      </div>
    )
  }

  if (timedOut) {
    const elapsedSec = task?.elapsed ? Math.round(task.elapsed) : 0
    return (
      <div className="container">
        <div className="error-box">
          <span className="error-icon">⏰</span>
          <span className="error-title">{t('result.timeoutTitle', 'Timeout')}</span>
          <div className="error-msg">{t('result.timeoutMsg', 'Task has been running for {s} seconds', { s: elapsedSec })}</div>
          {task?.message && <span className="error-detail">{t('result.current', 'Current: {m}', { m: task.message })}</span>}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
            <button className="retry-btn" onClick={handleContinueWaiting}>
              {t('result.keepWaiting', 'Keep Waiting')}
            </button>
            <button className="retry-btn secondary" onClick={() => { clearTask(); router.push('/') }}>
              {t('result.retry', 'Retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="result-header">
        <h2>{t('result.complete', 'Split Complete')}</h2>
        <span className="result-meta">
          {t('result.layersMeta', '{n} layers · {s}s', { n: layers.length, s: Math.round(task?.elapsed || 0) })}
        </span>
      </div>

      {Object.keys(groups).map((groupName) => (
        <div className="layer-group" key={groupName}>
          <div className="group-header">
            <span className="group-name">{groupName}</span>
            <span className="group-count">{groups[groupName].length}</span>
          </div>
          <div className="layer-grid">
            {groups[groupName].map((layer) => (
              <div
                className="layer-card"
                key={layer.id}
                onClick={() => window.open(getLayerUrl(urlTaskId, layer), '_blank')}
              >
                <img
                  className="layer-thumb"
                  src={getLayerUrl(urlTaskId, layer)}
                  alt={layer.name}
                  loading="lazy"
                />
                <span className="layer-name">{layer.name}</span>
                <span className="layer-type">{layer.part_type}</span>
                <button
                  className="layer-dl-btn"
                  disabled={downloadingId === layer.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownload(layer)
                  }}
                >
                  {downloadingId === layer.id ? '...' : t('result.download', 'Download')}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="bottom-actions">
        <button
          className="action-btn secondary"
          onClick={handleDownloadPSD}
          disabled={downloadingPSD}
        >
          {downloadingPSD ? t('result.downloading', 'Downloading...') : t('result.downloadPSD', 'Download PSD')}
        </button>
        <button className="action-btn primary" onClick={() => { clearTask(); router.push('/') }}>
          {t('result.newImage', 'New Image')}
        </button>
      </div>
    </div>
  )
}
