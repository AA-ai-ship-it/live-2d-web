'use client'

/**
 * 彗星背景组件
 * - 固定定位在最底层 (z-index: -1)
 * - 6 颗彗星从网页外部左上角进入，顺时针弧形扫过，从右下角出去
 * - 每颗彗星有独立的弧线偏移、速度、颜色
 * - 纯 Canvas 2D，RAF 循环，离屏时自动重生
 * - 零依赖，不阻挡任何页面交互（pointer-events: none）
 */
import { useEffect, useRef } from 'react'

interface Comet {
  t: number           // 路径进度 0~1
  speed: number       // 每帧 t 的增量
  arcOffset: number   // 弧线偏移量（决定弧度大小）
  arcDir: 1 | -1      // 弧线方向（上弯 / 下弯）
  length: number      // 拖尾长度（像素）
  size: number        // 头部大小
  alpha: number       // 整体透明度
  color: [number, number, number]
}

const COLORS: [number, number, number][] = [
  [167, 139, 250],
  [124, 92, 255],
  [34, 211, 238],
  [255, 255, 255],
]

const rand = (min: number, max: number) => Math.random() * (max - min) + min
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

/**
 * 路径函数：给定进度 t (0~1)，返回彗星坐标
 * 路径为从外部左上角到外部右下角的弧形扫过
 * arcOffset 控制弧度大小，arcDir 控制弯曲方向
 */
function getPathPos(
  t: number,
  w: number,
  h: number,
  arcOffset: number,
  arcDir: 1 | -1,
) {
  const startX = -80
  const startY = -80
  const endX = w + 80
  const endY = h + 80

  // 线性插值（对角线方向）
  const baseX = startX + (endX - startX) * t
  const baseY = startY + (endY - startY) * t

  // 弧线偏移：sin(π*t) 在中间达到峰值
  // arcDir=1 向下弯，arcDir=-1 向上弯
  const arc = arcDir * arcOffset * Math.sin(Math.PI * t)

  // 垂直于运动方向的偏移
  // 运动方向单位向量
  const dirX = (endX - startX)
  const dirY = (endY - startY)
  const dirLen = Math.hypot(dirX, dirY)
  const nx = -dirY / dirLen   // 垂直方向
  const ny = dirX / dirLen

  return {
    x: baseX + nx * arc,
    y: baseY + ny * arc,
  }
}

/**
 * 路径切线方向（用于计算拖尾方向）
 */
function getPathDir(
  t: number,
  w: number,
  h: number,
  arcOffset: number,
  arcDir: 1 | -1,
) {
  const dt = 0.001
  const p1 = getPathPos(t, w, h, arcOffset, arcDir)
  const p2 = getPathPos(Math.min(t + dt, 1), w, h, arcOffset, arcDir)
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.hypot(dx, dy) || 1
  return { dx: dx / len, dy: dy / len }
}

function createComet(w: number, h: number, startFresh = false): Comet {
  const arcDir: 1 | -1 = Math.random() > 0.5 ? 1 : -1

  return {
    t: startFresh ? rand(0, 0.3) : 0,
    speed: rand(0.003, 0.006),
    arcOffset: rand(Math.min(w, h) * 0.15, Math.min(w, h) * 0.35),
    arcDir,
    length: rand(100, 260),
    size: rand(1.4, 2.8),
    alpha: rand(0.4, 0.9),
    color: pick(COLORS),
  }
}

export default function CometBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const comets: Comet[] = []
    const COMET_COUNT = 6
    let raf = 0

    const resize = () => {
      canvas!.width = Math.floor(window.innerWidth * dpr)
      canvas!.height = Math.floor(window.innerHeight * dpr)
      canvas!.style.width = window.innerWidth + 'px'
      canvas!.style.height = window.innerHeight + 'px'
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const init = () => {
      resize()
      comets.length = 0
      for (let i = 0; i < COMET_COUNT; i++) {
        comets.push(createComet(window.innerWidth, window.innerHeight, true))
      }
    }

    const step = () => {
      const w = window.innerWidth
      const h = window.innerHeight

      ctx!.clearRect(0, 0, w, h)
      ctx!.globalCompositeOperation = 'lighter'

      for (let i = 0; i < comets.length; i++) {
        const c = comets[i]

        // 1) 更新进度
        c.t += c.speed

        // 2) 头部位置
        const head = getPathPos(c.t, w, h, c.arcOffset, c.arcDir)

        // 3) 拖尾方向（沿路径切线反向）
        const dir = getPathDir(c.t, w, h, c.arcOffset, c.arcDir)
        const tailX = head.x - dir.dx * c.length
        const tailY = head.y - dir.dy * c.length

        // 4) 绘制拖尾
        const grad = ctx!.createLinearGradient(tailX, tailY, head.x, head.y)
        const [r, g, b] = c.color
        grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${c.alpha * 0.25})`)
        grad.addColorStop(1, `rgba(${r},${g},${b},${c.alpha})`)

        ctx!.strokeStyle = grad
        ctx!.lineWidth = c.size
        ctx!.lineCap = 'round'
        ctx!.beginPath()
        ctx!.moveTo(tailX, tailY)
        ctx!.lineTo(head.x, head.y)
        ctx!.stroke()

        // 5) 头部亮点
        ctx!.beginPath()
        ctx!.fillStyle = `rgba(255,255,255,${Math.min(1, c.alpha + 0.1)})`
        ctx!.arc(head.x, head.y, c.size * 0.7, 0, Math.PI * 2)
        ctx!.fill()

        // 6) 外层光晕
        const glow = ctx!.createRadialGradient(head.x, head.y, 0, head.x, head.y, c.size * 5)
        glow.addColorStop(0, `rgba(${r},${g},${b},${c.alpha * 0.6})`)
        glow.addColorStop(1, `rgba(${r},${g},${b},0)`)
        ctx!.fillStyle = glow
        ctx!.beginPath()
        ctx!.arc(head.x, head.y, c.size * 5, 0, Math.PI * 2)
        ctx!.fill()

        // 7) 完成路径则重生
        if (c.t > 1) {
          comets[i] = createComet(w, h, false)
        }
      }

      ctx!.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(step)
    }

    init()
    step()

    const onResize = () => resize()
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
      }}
    />
  )
}
