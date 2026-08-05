/**
 * PixiStage — PixiJS v7 渲染核心
 *
 * 职责：
 * 1. 管理 PixiJS Application 生命周期
 * 2. 从 SplitResult 构建 Container/Sprite 父子树
 * 3. 提供效果系统控制接口（P1-4 对接）
 */

import { Application, Container, Sprite, Assets, Texture, Ticker } from 'pixi.js'
import type { SplitResult, LayerPart, EffectState } from './types'

export interface PartDisplay {
  container: Container
  sprite: Sprite
  part: LayerPart
}

export class PixiStage {
  private app: Application
  private rootContainer: Container
  private displays: Map<string, PartDisplay> = new Map()
  private splitResult: SplitResult | null = null
  private scale: number = 1
  private tickerCallback: ((ticker: Ticker) => void) | null = null

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.app = new Application({
      view: canvas,
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      autoDensity: true,
    })
    this.rootContainer = new Container()
    this.app.stage.addChild(this.rootContainer)
  }

  /**
   * 加载 SplitResult → 构建 Container/Sprite 父子树
   *
   * 坐标系设计：
   * - 每个 Container 的 (0,0) = 部位锚点位置
   * - Sprite 从 (-ax*w, -ay*h) 开始，使图像左上角对齐 part.x/y
   * - 旋转 Container 自然围绕锚点
   * - 子级 Container.x/y = 子锚点绝对坐标 - 父锚点绝对坐标
   */
  async loadSplitResult(result: SplitResult): Promise<void> {
    this.splitResult = result

    // 清空旧内容
    this.rootContainer.removeChildren()
    this.displays.clear()

    // 画布缩放适配
    const scaleX = this.app.screen.width / result.canvas.width
    const scaleY = this.app.screen.height / result.canvas.height
    this.scale = Math.min(scaleX, scaleY)
    this.rootContainer.scale.set(this.scale)

    // 1. 加载所有纹理
    const textureMap = new Map<string, Texture>()
    await Promise.all(
      result.parts.map(async (part) => {
        try {
          const tex = await Assets.load(part.src)
          textureMap.set(part.id, tex)
        } catch (e) {
          console.warn(`[PixiStage] 纹理加载失败: ${part.id}`, e)
        }
      })
    )

    // 2. 为每个 part 创建 Container + Sprite
    for (const part of result.parts) {
      const tex = textureMap.get(part.id)
      if (!tex) continue

      const container = new Container()
      const sprite = new Sprite(tex)

      // Sprite 放在 Container 内，使锚点在 Container 的 (0,0)
      sprite.anchor.set(0)
      sprite.x = -part.anchor.x * part.width
      sprite.y = -part.anchor.y * part.height
      sprite.width = part.width
      sprite.height = part.height

      container.addChild(sprite)
      container.visible = part.visible

      // Container 位置 = 锚点在画布上的绝对坐标
      const anchorAbsX = part.x + part.anchor.x * part.width
      const anchorAbsY = part.y + part.anchor.y * part.height

      // 有 parent 时转为相对父级锚点的坐标
      if (part.parent && result.partsById[part.parent]) {
        const parent = result.partsById[part.parent]
        const parentAnchorAbsX = parent.x + parent.anchor.x * parent.width
        const parentAnchorAbsY = parent.y + parent.anchor.y * parent.height
        container.x = anchorAbsX - parentAnchorAbsX
        container.y = anchorAbsY - parentAnchorAbsY
      } else {
        container.x = anchorAbsX
        container.y = anchorAbsY
      }

      container.zIndex = part.zIndex

      this.displays.set(part.id, { container, sprite, part })
    }

    // 3. 构建父子树（Container 层级）
    for (const part of result.parts) {
      const display = this.displays.get(part.id)
      if (!display) continue

      if (part.parent && this.displays.has(part.parent)) {
        this.displays.get(part.parent)!.container.addChild(display.container)
      } else {
        this.rootContainer.addChild(display.container)
      }
    }

    // 4. 启用 zIndex 排序
    this.rootContainer.sortableChildren = true
    for (const display of Array.from(this.displays.values())) {
      display.container.sortableChildren = true
    }
  }

  /** 获取某个部位的显示对象 */
  getDisplay(partId: string): PartDisplay | undefined {
    return this.displays.get(partId)
  }

  /** 获取所有部位显示对象 */
  getAllDisplays(): PartDisplay[] {
    return Array.from(this.displays.values())
  }

  /** 获取当前 SplitResult */
  getSplitResult(): SplitResult | null {
    return this.splitResult
  }

  /** 获取底层 canvas 元素（GIF 导出用） */
  getCanvas(): HTMLCanvasElement {
    return this.app.view as HTMLCanvasElement
  }

  /** 注册 Ticker 回调（效果系统驱动入口，P1-4 对接） */
  setTickerCallback(cb: ((ticker: Ticker) => void) | null): void {
    if (this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback)
    }
    this.tickerCallback = cb
    if (cb) {
      this.app.ticker.add(cb)
    }
  }

  /** 手动触发一次渲染（GIF 导出用） */
  render(): void {
    this.app.render()
  }

  /** 暂停渲染循环 */
  stop(): void {
    this.app.ticker.stop()
  }

  /** 恢复渲染循环 */
  start(): void {
    this.app.ticker.start()
  }

  /** 销毁，释放资源 */
  destroy(): void {
    if (this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback)
      this.tickerCallback = null
    }
    this.app.destroy(true, { children: true })
    this.displays.clear()
    this.splitResult = null
  }
}
