'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api, { TaskInfo, LayerInfo, normalizeLayers, isTaskDone } from '@/lib/api'

const POLL_INTERVAL = 2500
const MAX_POLL_DURATION = 15 * 60 * 1000

export default function ResultPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = params.taskId as string

  const [task, setTask] = useState<TaskInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const [downloadingId, setDownloadingId] = useState('')
  const [downloadingPSD, setDownloadingPSD] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeRef = useRef(0)

  useEffect(() => {
    if (!taskId) {
      setError('Missing task ID')
      setLoading(false)
      return
    }
    startTimeRef.current = Date.now()
    pollTask(taskId)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [taskId])

  const pollTask = (id: string) => {
    api.getTask(id)
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
          return
        }
        timerRef.current = setTimeout(() => pollTask(id), POLL_INTERVAL)
      })
      .catch(() => {
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
    pollTask(taskId)
  }

  const handleDownload = async (layer: LayerInfo) => {
    if (!taskId) return
    setDownloadingId(layer.id)
    try {
      await api.downloadLayer(taskId, layer)
    } catch {
      // Fallback: open in new tab
      window.open(api.getLayerUrl(taskId, layer), '_blank')
    } finally {
      setDownloadingId('')
    }
  }

  const handleDownloadPSD = async () => {
    if (!taskId) return
    setDownloadingPSD(true)
    try {
      await api.downloadPSD(taskId)
    } catch {
      // Fallback
      window.open(`${process.env.NEXT_PUBLIC_API_BASE || ''}/api/result/${taskId}/psd`, '_blank')
    } finally {
      setDownloadingPSD(false)
    }
  }

  // Loading
  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner" />
          <div className="loading-text">{task?.message || 'Queuing...'}</div>
          <div className="loading-hint">AI is splitting layers, estimated 30-60 seconds</div>
          {task && task.elapsed > 0 && (
            <div className="loading-elapsed">Elapsed: {Math.round(task.elapsed)}s</div>
          )}
        </div>
      </div>
    )
  }

  // Failed
  if (task?.status === 'failed' || error) {
    return (
      <div className="container">
        <div className="error-box">
          <span className="error-icon">!</span>
          <span className="error-title">Split Failed</span>
          <div className="error-msg">{error || task?.message || 'Unknown error'}</div>
          {taskId && <span className="error-detail">Task ID: {taskId}</span>}
          {task?.status && <span className="error-detail">Status: {task.status}</span>}
          <button className="retry-btn" onClick={() => router.push('/')}>Retry</button>
        </div>
      </div>
    )
  }

  // Timeout
  if (timedOut) {
    const elapsedSec = task?.elapsed ? Math.round(task.elapsed) : 0
    return (
      <div className="container">
        <div className="error-box">
          <span className="error-icon">⏰</span>
          <span className="error-title">Timeout</span>
          <div className="error-msg">Task has been running for {elapsedSec} seconds</div>
          {task?.message && <span className="error-detail">Current: {task.message}</span>}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
            <button className="retry-btn" onClick={handleContinueWaiting}>Keep Waiting</button>
            <button className="retry-btn secondary" onClick={() => router.push('/')}>Retry</button>
          </div>
        </div>
      </div>
    )
  }

  // Success
  const layers = task ? normalizeLayers(task) : []
  const groups: Record<string, LayerInfo[]> = {}
  layers.forEach((layer) => {
    const g = layer.group || 'Other'
    if (!groups[g]) groups[g] = []
    groups[g].push(layer)
  })

  return (
    <div className="container">
      <div className="result-header">
        <h2>Split Complete</h2>
        <span className="result-meta">
          {layers.length} layers · {Math.round(task?.elapsed || 0)}s
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
                onClick={() => window.open(api.getLayerUrl(taskId, layer), '_blank')}
              >
                <img
                  className="layer-thumb"
                  src={api.getLayerUrl(taskId, layer)}
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
                  {downloadingId === layer.id ? '...' : 'Download'}
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
          {downloadingPSD ? 'Downloading...' : 'Download PSD'}
        </button>
        <button className="action-btn primary" onClick={() => router.push('/')}>
          New Image
        </button>
      </div>
    </div>
  )
}
