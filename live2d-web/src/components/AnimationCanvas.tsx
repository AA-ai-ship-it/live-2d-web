'use client'

import { useEffect, useRef, useCallback } from 'react'
import { MockLayer, PartType, EffectDef } from '@/lib/mockData'

// ====== 运行时效果状态 ======
export interface EffectState {
  id: string
  enabled: boolean
  intensity: number  // 0-1
}

interface Props {
  layers: MockLayer[]
  effects: EffectState[]
  effectDefs: EffectDef[]
  width?: number
  height?: number
}

// 画布逻辑尺寸（与 mock 数据坐标系一致）
const LOGICAL_W = 512
const LOGICAL_H = 512

// 每帧每图层的变换结果
interface LayerTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number  // rad
  opacity: number
}

function identity(): LayerTransform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }
}

export default function AnimationCanvas({
  layers, effects, effectDefs, width = 512, height = 512,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const animRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  // 眨眼状态机
  const blinkRef = useRef<{ phase: 'open' | 'closing' | 'opening'; timer: number; nextBlink: number }>({
    phase: 'open', timer: 0, nextBlink: 2000 + Math.random() * 3000,
  })
  // 粒子（场景效果）
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[]>([])

  // 预加载图片
  useEffect(() => {
    layers.forEach(layer => {
      if (!imagesRef.current.has(layer.id)) {
        const img = new Image()
        img.src = layer.svg
        img.onload = () => { /* ready */ }
        imagesRef.current.set(layer.id, img)
      }
    })
  }, [layers])

  // 查找效果是否启用
  const getEffect = useCallback((id: string): EffectState | undefined => {
    return effects.find(e => e.id === id && e.enabled)
  }, [effects])

  // 检查图层是否被效果影响
  const isTarget = useCallback((layer: MockLayer, effectId: string): boolean => {
    const def = effectDefs.find(d => d.id === effectId)
    if (!def) return false
    return def.targetParts.includes(layer.partType)
  }, [effectDefs])

  // ====== 动画核心：计算每帧每图层的变换 ======
  const computeTransform = (layer: MockLayer, time: number): LayerTransform => {
    const t = identity()

    // --- Body Sway（全身微摆）---
    const sway = getEffect('body_sway')
    if (sway && isTarget(layer, 'body_sway')) {
      const s = sway.intensity
      t.x += Math.sin(time * 0.0008) * 3 * s
      t.rotation += Math.sin(time * 0.0006) * 0.015 * s
    }

    // --- Breath（呼吸起伏）---
    const breath = getEffect('breath')
    if (breath && isTarget(layer, 'breath')) {
      const b = breath.intensity
      const breathWave = Math.sin(time * 0.0015)
      t.y += breathWave * 1.5 * b
      // 身体轻微拉伸
      if (layer.partType === 'body') {
        t.scaleY += breathWave * 0.01 * b
      }
    }

    // --- Head Tilt（头部微转）---
    const tilt = getEffect('head_tilt')
    if (tilt && isTarget(layer, 'head_tilt')) {
      const ti = tilt.intensity
      // 以脸部中心为轴旋转
      t.rotation += Math.sin(time * 0.0007) * 0.03 * ti
      // 旋转中心偏移（让头部围绕脖子转，不是图层中心）
      // 通过 translate 补偿旋转中心
      const pivotY = layer.h * 0.8 // 旋转轴在底部（脖子位置）
      const cos = Math.cos(t.rotation)
      const sin = Math.sin(t.rotation)
      const dy = pivotY - layer.h / 2
      t.x += -sin * dy
      t.y += (cos - 1) * dy
    }

    // --- Hair Swing（头发摆动）---
    const hairSwing = getEffect('hair_swing')
    if (hairSwing && isTarget(layer, 'hair_swing')) {
      const hs = hairSwing.intensity
      if (layer.partType === 'hair_back') {
        // 后发摆动幅度大，频率低
        t.rotation += Math.sin(time * 0.001) * 0.04 * hs
        t.x += Math.sin(time * 0.001) * 2 * hs
      } else if (layer.partType === 'hair_front') {
        // 前发摆动幅度小，频率略高
        t.rotation += Math.sin(time * 0.0012 + 0.5) * 0.025 * hs
      }
    }

    // --- Accessory Sway（发饰摇晃）---
    const accSway = getEffect('accessory_sway')
    if (accSway && isTarget(layer, 'accessory_sway')) {
      const as = accSway.intensity
      // 发饰延迟跟随头部
      t.rotation += Math.sin(time * 0.0015 + 1.0) * 0.08 * as
      t.x += Math.sin(time * 0.0015 + 1.0) * 1.5 * as
    }

    // --- Blink（眨眼）---
    const blink = getEffect('blink')
    if (blink && isTarget(layer, 'blink')) {
      const blinkState = blinkRef.current
      let eyeScaleY = 1
      if (blinkState.phase === 'closing') {
        eyeScaleY = 1 - blinkState.timer / 80
        if (eyeScaleY < 0.1) eyeScaleY = 0.1
      } else if (blinkState.phase === 'opening') {
        eyeScaleY = 0.1 + blinkState.timer / 80
        if (eyeScaleY > 1) eyeScaleY = 1
      }
      t.scaleY = eyeScaleY
    }

    // --- Mouth Talk（嘴巴开合）---
    const talk = getEffect('mouth_talk')
    if (talk && isTarget(layer, 'mouth_talk')) {
      const tk = talk.intensity
      const talkWave = Math.sin(time * 0.008) * 0.5 + 0.5 // 0-1
      t.scaleY = 0.3 + talkWave * 0.7 * tk
    }

    return t
  }

  // ====== 绘制单个图层 ======
  const drawLayer = (
    ctx: CanvasRenderingContext2D,
    layer: MockLayer,
    img: HTMLImageElement,
    transform: LayerTransform,
    scale: number,
  ) => {
    if (!layer.visible || !img.complete) return

    const cx = (layer.x + layer.w / 2) * scale
    const cy = (layer.y + layer.h / 2) * scale
    const w = layer.w * scale
    const h = layer.h * scale

    ctx.save()
    ctx.globalAlpha = transform.opacity
    ctx.translate(cx + transform.x * scale, cy + transform.y * scale)
    ctx.rotate(transform.rotation)
    ctx.scale(transform.scaleX, transform.scaleY)
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    ctx.restore()
  }

  // ====== 绘制叠加效果（腮红、眼神光、粒子等）=====
  const drawOverlays = (ctx: CanvasRenderingContext2D, time: number, scale: number) => {
    // --- Blush（腮红脉冲）---
    const blush = getEffect('blush')
    if (blush) {
      const pulse = (Math.sin(time * 0.002) + 1) / 2 // 0-1
      const alpha = blush.intensity * (0.15 + pulse * 0.2)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = '#ff6b6b'
      // 左腮红
      const lx = 216 * scale, ly = 195 * scale
      const grad1 = ctx.createRadialGradient(lx, ly, 0, lx, ly, 16 * scale)
      grad1.addColorStop(0, 'rgba(255,107,107,0.8)')
      grad1.addColorStop(1, 'rgba(255,107,107,0)')
      ctx.fillStyle = grad1
      ctx.beginPath()
      ctx.arc(lx, ly, 16 * scale, 0, Math.PI * 2)
      ctx.fill()
      // 右腮红
      const rx = 296 * scale, ry = 195 * scale
      const grad2 = ctx.createRadialGradient(rx, ry, 0, rx, ry, 16 * scale)
      grad2.addColorStop(0, 'rgba(255,107,107,0.8)')
      grad2.addColorStop(1, 'rgba(255,107,107,0)')
      ctx.fillStyle = grad2
      ctx.beginPath()
      ctx.arc(rx, ry, 16 * scale, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // --- Eye Shine（眼神光闪烁）---
    const eyeShine = getEffect('eye_shine')
    if (eyeShine) {
      const shine = (Math.sin(time * 0.003) + 1) / 2
      const alpha = eyeShine.intensity * (0.3 + shine * 0.5)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = '#ffffff'
      // 左眼星光
      const lex = 220 * scale, ley = 160 * scale
      drawStar(ctx, lex, ley, 4 * scale, 2 * scale, 4)
      // 右眼星光
      const rex = 292 * scale, rey = 160 * scale
      drawStar(ctx, rex, rey, 4 * scale, 2 * scale, 4)
      ctx.restore()
    }

    // --- Sparkle BG（背景粒子）---
    const sparkleBg = getEffect('sparkle_bg')
    if (sparkleBg) {
      const particles = particlesRef.current
      // 生成新粒子
      if (Math.random() < 0.1 * sparkleBg.intensity * 3) {
        particles.push({
          x: Math.random() * LOGICAL_W,
          y: Math.random() * LOGICAL_H,
          vx: (Math.random() - 0.5) * 0.3,
          vy: -0.2 - Math.random() * 0.3,
          life: 0,
          maxLife: 2000 + Math.random() * 2000,
          size: 1 + Math.random() * 2,
        })
      }
      // 更新+绘制粒子
      ctx.save()
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life += 16
        p.x += p.vx
        p.y += p.vy
        if (p.life > p.maxLife || p.y < 0) {
          particles.splice(i, 1)
          continue
        }
        const fade = Math.sin((p.life / p.maxLife) * Math.PI)
        ctx.globalAlpha = fade * sparkleBg.intensity
        ctx.fillStyle = '#a78bfa'
        ctx.beginPath()
        ctx.arc(p.x * scale, p.y * scale, p.size * scale, 0, Math.PI * 2)
        ctx.fill()
        // 十字星光
        ctx.globalAlpha = fade * sparkleBg.intensity * 0.5
        ctx.strokeStyle = '#c4b5fd'
        ctx.lineWidth = 0.5 * scale
        ctx.beginPath()
        ctx.moveTo(p.x * scale - p.size * 2 * scale, p.y * scale)
        ctx.lineTo(p.x * scale + p.size * 2 * scale, p.y * scale)
        ctx.moveTo(p.x * scale, p.y * scale - p.size * 2 * scale)
        ctx.lineTo(p.x * scale, p.y * scale + p.size * 2 * scale)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  // 画十字星
  const drawStar = (ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number, points: number) => {
    ctx.beginPath()
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }

  // ====== 主循环 ======
  const animate = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const time = performance.now() - startTimeRef.current
    const scale = width / LOGICAL_W

    // 清屏
    ctx.clearRect(0, 0, width, height)

    // 棋盘格透明背景
    drawCheckerBg(ctx, width, height)

    // 按 zIndex 降序排列（底层先画）
    const sorted = [...layers].sort((a, b) => b.zIndex - a.zIndex)

    // 更新眨眼状态机
    const blink = getEffect('blink')
    if (blink) {
      const bs = blinkRef.current
      bs.timer += 16
      if (bs.phase === 'open' && bs.timer >= bs.nextBlink) {
        bs.phase = 'closing'
        bs.timer = 0
      } else if (bs.phase === 'closing' && bs.timer >= 80) {
        bs.phase = 'opening'
        bs.timer = 0
      } else if (bs.phase === 'opening' && bs.timer >= 80) {
        bs.phase = 'open'
        bs.timer = 0
        bs.nextBlink = 2000 + Math.random() * 4000
      }
    }

    // 绘制每个图层
    for (const layer of sorted) {
      const img = imagesRef.current.get(layer.id)
      if (!img) continue
      const transform = computeTransform(layer, time)
      drawLayer(ctx, layer, img, transform, scale)
    }

    // 绘制叠加效果
    drawOverlays(ctx, time, scale)

    animRef.current = requestAnimationFrame(animate)
  }, [layers, effects, effectDefs, width, height, getEffect, isTarget])

  useEffect(() => {
    startTimeRef.current = performance.now()
    animRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animRef.current)
  }, [animate])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}

// 棋盘格背景
function drawCheckerBg(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const size = 20
  ctx.save()
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      const isEven = ((x / size) + (y / size)) % 2 === 0
      ctx.fillStyle = isEven ? '#0f0f1e' : '#131326'
      ctx.fillRect(x, y, size, size)
    }
  }
  ctx.restore()
}
