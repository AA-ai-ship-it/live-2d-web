/**
 * 效果系统：Effect 接口 + 注册表 + Ticker 驱动循环
 *
 * 设计思路：
 * - 每个效果是一个纯函数：f(ctx) → 修改 Container 属性
 * - 每帧先重置所有 Container 到基础变换，再依次叠加效果
 * - 多效果用"加法混合"（呼吸的位移 + 物理的旋转 = 最终矩阵）
 */

import type { PixiStage, PartDisplay } from './PixiStage'
import type { SplitResult, EffectState, SemanticRole } from './types'

// 眨眼状态机（多个效果共享）
export interface BlinkState {
  phase: 'open' | 'closing' | 'opening'
  timer: number
  nextBlink: number
}

// 效果运行时上下文
export interface EffectContext {
  time: number           // 从动画开始的毫秒数
  deltaTime: number      // 上一帧间隔（ms）
  result: SplitResult
  stage: PixiStage
  intensity: number      // 0-1
  blinkState: BlinkState
  /** 辅助：按语义角色查找部位显示对象 */
  getDisplaysByRole: (role: SemanticRole) => PartDisplay[]
}

// 效果定义
export interface EffectDef {
  id: string
  targetRoles: SemanticRole[]
  apply: (ctx: EffectContext) => void
}

// 基础变换（每帧重置用）
interface BaseTransform {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

// 效果注册表
export class EffectRegistry {
  private effects = new Map<string, EffectDef>()

  register(def: EffectDef): void {
    this.effects.set(def.id, def)
  }

  get(id: string): EffectDef | undefined {
    return this.effects.get(id)
  }

  getAll(): EffectDef[] {
    return Array.from(this.effects.values())
  }
}

// 效果驱动器：连接 PixiJS Ticker 和效果函数
export class EffectDriver {
  private stage: PixiStage
  private registry: EffectRegistry
  private activeEffects: EffectState[] = []
  private startTime: number = 0
  private baseTransforms = new Map<string, BaseTransform>()
  private lastFrameTime: number = 0

  blinkState: BlinkState = {
    phase: 'open',
    timer: 0,
    nextBlink: 2000 + Math.random() * 3000,
  }

  constructor(stage: PixiStage, registry: EffectRegistry) {
    this.stage = stage
    this.registry = registry
    this.startTime = performance.now()
    this.lastFrameTime = this.startTime

    this.stage.setTickerCallback(() => {
      this.tick()
    })
  }

  /** 设置当前活跃效果列表 */
  setEffects(effects: EffectState[]): void {
    this.activeEffects = effects.filter((e) => e.enabled)
  }

  /** 当 SplitResult 加载完成后调用，捕获基础变换 */
  captureBaseTransforms(): void {
    this.baseTransforms.clear()
    for (const display of this.stage.getAllDisplays()) {
      this.baseTransforms.set(display.part.id, {
        x: display.container.x,
        y: display.container.y,
        rotation: display.container.rotation,
        scaleX: display.container.scale.x,
        scaleY: display.container.scale.y,
      })
    }
    // 重置计时器
    this.startTime = performance.now()
    this.lastFrameTime = this.startTime
  }

  /** 获取当前时间（ms，用于 GIF 导出同步） */
  getTime(): number {
    return performance.now() - this.startTime
  }

  private tick(): void {
    const now = performance.now()
    const time = now - this.startTime
    const deltaTime = now - this.lastFrameTime
    this.lastFrameTime = now
    this.renderAt(time, deltaTime)
  }

  /** 在指定时间点渲染一帧（GIF 导出用，不依赖 Ticker） */
  renderAt(time: number, deltaTime: number = 16): void {
    const result = this.stage.getSplitResult()
    if (!result) return

    // 1. 重置所有 Container 到基础变换
    for (const display of this.stage.getAllDisplays()) {
      const base = this.baseTransforms.get(display.part.id)
      if (base) {
        display.container.x = base.x
        display.container.y = base.y
        display.container.rotation = base.rotation
        display.container.scale.set(base.scaleX, base.scaleY)
      }
    }

    // 2. 更新眨眼状态机
    this.updateBlinkState(deltaTime)

    // 3. 依次应用每个活跃效果（加法混合）
    for (const effectState of this.activeEffects) {
      const def = this.registry.get(effectState.id)
      if (!def) continue

      const ctx: EffectContext = {
        time,
        deltaTime,
        result,
        stage: this.stage,
        intensity: effectState.intensity,
        blinkState: this.blinkState,
        getDisplaysByRole: (role) => this.getDisplaysByRole(role, result),
      }

      try {
        def.apply(ctx)
      } catch (e) {
        console.warn(`[EffectDriver] 效果 ${effectState.id} 执行出错:`, e)
      }
    }
  }

  private getDisplaysByRole(role: SemanticRole, result: SplitResult): PartDisplay[] {
    return result.parts
      .filter((p) => p.semanticRole === role)
      .map((p) => this.stage.getDisplay(p.id))
      .filter((d): d is PartDisplay => !!d)
  }

  private updateBlinkState(deltaTime: number): void {
    const bs = this.blinkState
    bs.timer += deltaTime

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
}
