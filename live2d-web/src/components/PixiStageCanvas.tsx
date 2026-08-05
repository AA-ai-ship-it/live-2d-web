'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { PixiStage } from '@/lib/rig/PixiStage'
import type { SplitResult, EffectState } from '@/lib/rig/types'

interface Props {
  splitResult: SplitResult | null
  effects: EffectState[]
  width?: number
  height?: number
  onReady?: (stage: PixiStage) => void
  className?: string
}

export default function PixiStageCanvas({
  splitResult,
  effects,
  width = 512,
  height = 512,
  onReady,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<PixiStage | null>(null)
  const onReadyRef = useRef(onReady)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 保持 onReady ref 最新
  onReadyRef.current = onReady

  // 初始化 PixiStage（仅一次）
  useEffect(() => {
    if (!canvasRef.current) return

    const stage = new PixiStage(canvasRef.current, width, height)
    stageRef.current = stage
    onReadyRef.current?.(stage)

    return () => {
      stage.destroy()
      stageRef.current = null
    }
  }, [width, height])

  // 加载 SplitResult
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !splitResult) return

    let cancelled = false
    setLoading(true)
    setError(null)

    stage
      .loadSplitResult(splitResult)
      .then(() => {
        if (!cancelled) setLoading(false)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'Failed to load layers')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [splitResult])

  // 暴露 stage 给父组件（每次 effects 变化时同步引用）
  const handleCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node
  }, [])

  return (
    <div
      className={`pixi-stage-wrapper ${className || ''}`}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <canvas
        ref={handleCanvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {loading && (
        <div className="pixi-overlay pixi-overlay--loading">
          <div className="pixi-spinner" />
          <span>Loading layers…</span>
        </div>
      )}
      {error && (
        <div className="pixi-overlay pixi-overlay--error">
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
