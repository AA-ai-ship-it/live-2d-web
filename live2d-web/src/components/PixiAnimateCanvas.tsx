'use client'

import { useEffect, useRef, useState } from 'react'
import { PixiStage } from '@/lib/rig/PixiStage'
import { EffectRegistry, EffectDriver } from '@/lib/rig/effectSystem'
import { registerBuiltinEffects } from '@/lib/rig/effects'
import { buildSplitResult } from '@/lib/rig/rigBuilder'
import type { LayerInfo } from '@/lib/api'
import { getLayerUrl } from '@/lib/api'
import type { MockLayer } from '@/lib/mockData'

interface Props {
  layers: LayerInfo[] | MockLayer[]
  taskId: string
  effects: Array<{ id: string; enabled: boolean; intensity: number }>
  width?: number
  height?: number
  onReady?: (api: { stage: PixiStage; driver: EffectDriver }) => void
}

// MockLayer → LayerInfo 适配
function isLayerInfo(l: LayerInfo | MockLayer): l is LayerInfo {
  return 'part_type' in l || 'file_name' in l
}

function normalizeLayers(layers: Array<LayerInfo | MockLayer>): LayerInfo[] {
  return layers.map((l) => {
    if (isLayerInfo(l)) return l
    return {
      id: l.id,
      name: l.name,
      part_type: l.partType,
      file_name: '',
      width: l.w,
      height: l.h,
      left: l.x,
      top: l.y,
      z_index: l.zIndex,
      url: l.svg,
    }
  })
}

export default function PixiAnimateCanvas({
  layers,
  taskId,
  effects,
  width = 512,
  height = 512,
  onReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<PixiStage | null>(null)
  const driverRef = useRef<EffectDriver | null>(null)
  const onReadyRef = useRef(onReady)
  const effectsRef = useRef(effects)
  const baseReadyRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 同步最新 effects 到 ref，供异步回调读取，避免闭包陈旧值
  effectsRef.current = effects
  onReadyRef.current = onReady

  // 初始化 PixiStage + EffectDriver（仅一次）
  useEffect(() => {
    if (!canvasRef.current) return

    const stage = new PixiStage(canvasRef.current, width, height)
    const registry = new EffectRegistry()
    registerBuiltinEffects(registry)
    const driver = new EffectDriver(stage, registry)

    stageRef.current = stage
    driverRef.current = driver
    onReadyRef.current?.({ stage, driver })

    return () => {
      stage.destroy()
      stageRef.current = null
      driverRef.current = null
    }
  }, [width, height])

  // 加载 layers → SplitResult
  useEffect(() => {
    const stage = stageRef.current
    const driver = driverRef.current
    if (!stage || !driver || layers.length === 0) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const normalized = normalizeLayers(layers)
    const result = buildSplitResult(normalized, {
      taskId,
      getLayerSrc: (layer) => layer.url || getLayerUrl(taskId, layer),
    })

    stage
      .loadSplitResult(result)
      .then(() => {
        if (cancelled) return
        driver.captureBaseTransforms()
        baseReadyRef.current = true
        driver.setEffects(effectsRef.current)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || 'Failed to load layers')
        setLoading(false)
      })

    return () => {
      cancelled = true
      baseReadyRef.current = false
    }
  }, [layers, taskId])

  // 更新效果列表（仅在 base transforms 就绪后生效，否则等待加载完成）
  useEffect(() => {
    if (baseReadyRef.current) {
      driverRef.current?.setEffects(effects)
    }
  }, [effects])

  return (
    <div
      className="pixi-stage-wrapper"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
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
