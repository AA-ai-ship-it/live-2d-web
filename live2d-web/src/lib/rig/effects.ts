/**
 * 3 个 MVP 基础效果：呼吸 / 眨眼 / 摇头
 *
 * 设计要点：
 * - 呼吸只改 body（子级自动跟随父级缩放/位移）
 * - 眨眼是"绝对"效果（直接设 scale.y，不叠加）
 * - 摇头只改 head rotation（子级自动跟随旋转）
 * - 多效果通过加法混合（EffectDriver 先重置基础变换再依次叠加）
 */

import type { EffectDef, EffectContext, EffectRegistry } from './effectSystem'

// 呼吸：正弦驱动 body 微缩放 + 位移
// 周期约 4.2s，振幅由 intensity 控制
const breathEffect: EffectDef = {
  id: 'breath',
  targetRoles: ['body'],
  apply(ctx: EffectContext) {
    const { time, intensity, getDisplaysByRole } = ctx
    const wave = Math.sin(time * 0.0015)

    for (const display of getDisplaysByRole('body')) {
      // 身体微缩放（胸腔起伏）
      display.container.scale.y += wave * 0.012 * intensity
      // 整体微位移
      display.container.y += wave * 1.0 * intensity
    }
  },
}

// 眨眼：状态机驱动 eye 的 scaleY（绝对值）
// open → closing(80ms) → opening(80ms) → open(随机 2-6s)
const blinkEffect: EffectDef = {
  id: 'blink',
  targetRoles: ['eye_left', 'eye_right', 'eye_both'],
  apply(ctx: EffectContext) {
    const { blinkState, intensity, getDisplaysByRole } = ctx
    let eyeScaleY = 1

    if (blinkState.phase === 'closing') {
      // 闭合：1 → 0.1
      eyeScaleY = 1 - (blinkState.timer / 80) * 0.9 * intensity
      if (eyeScaleY < 0.1) eyeScaleY = 0.1
    } else if (blinkState.phase === 'opening') {
      // 睁开：0.1 → 1
      eyeScaleY = 0.1 + (blinkState.timer / 80) * 0.9 * intensity
      if (eyeScaleY > 1) eyeScaleY = 1
    }

    // 直接赋值（不是叠加），因为眨眼是绝对状态
    const roles = ['eye_left', 'eye_right', 'eye_both'] as const
    for (const role of roles) {
      for (const display of getDisplaysByRole(role)) {
        display.container.scale.y = eyeScaleY
      }
    }
  },
}

// 摇头：正弦驱动 head 旋转
// 子级（face/eye/mouth/hair 等）自动跟随旋转
const headTiltEffect: EffectDef = {
  id: 'head_tilt',
  targetRoles: ['head', 'face'],
  apply(ctx: EffectContext) {
    const { time, intensity, getDisplaysByRole } = ctx
    // 慢速摇摆，最大约 2.3°（0.04 rad）
    const angle = Math.sin(time * 0.0007) * 0.04 * intensity

    // 优先旋转 head；如果没有 head（用 face 代替的情况）则旋转 face
    const headDisplays = getDisplaysByRole('head')
    if (headDisplays.length > 0) {
      for (const display of headDisplays) {
        display.container.rotation += angle
      }
    } else {
      for (const display of getDisplaysByRole('face')) {
        display.container.rotation += angle
      }
    }
  },
}

/** 注册所有内置效果 */
export function registerBuiltinEffects(registry: EffectRegistry): void {
  registry.register(breathEffect)
  registry.register(blinkEffect)
  registry.register(headTiltEffect)
}

/** 效果定义元信息（给 UI 用） */
export const BUILTIN_EFFECT_INFO = [
  {
    id: 'breath',
    nameKey: 'animate.effects.breath.name',
    descKey: 'animate.effects.breath.desc',
    category: 'body' as const,
    icon: 'wind',
    defaultIntensity: 0.5,
  },
  {
    id: 'blink',
    nameKey: 'animate.effects.blink.name',
    descKey: 'animate.effects.blink.desc',
    category: 'face' as const,
    icon: 'eye',
    defaultIntensity: 0.6,
  },
  {
    id: 'head_tilt',
    nameKey: 'animate.effects.headTilt.name',
    descKey: 'animate.effects.headTilt.desc',
    category: 'body' as const,
    icon: 'tilt',
    defaultIntensity: 0.4,
  },
] as const
