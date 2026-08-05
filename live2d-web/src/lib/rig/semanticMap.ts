/**
 * 47 部位语义映射表 + 锚点策略 + 父子规则
 *
 * 核心：See-Through 原始标签 → SemanticRole → parentRole + anchor + controllable
 * 这张表是全项目核心资产，效果系统、渲染引擎、规则引擎都依赖它。
 */

import type { SemanticRole, AnchorStrategy, ControllableParams } from './types'

// 语义角色 → 父级角色 + 锚点策略 + 可控参数
interface SemanticEntry {
  parentRole: SemanticRole | null
  anchor: AnchorStrategy
  controllable: ControllableParams
}

const SEMANTIC_MAP: Record<SemanticRole, SemanticEntry> = {
  hair_back:    { parentRole: 'head', anchor: 'bottom_center', controllable: { rotate: true, physics: 'pendulum' } },
  hair_front:   { parentRole: 'head', anchor: 'bottom_center', controllable: { rotate: true, physics: 'pendulum' } },
  hair_side:    { parentRole: 'head', anchor: 'top_center',    controllable: { rotate: true, physics: 'pendulum' } },
  body:         { parentRole: null,   anchor: 'center',         controllable: { translate: true, scale: true } },
  head:         { parentRole: 'body', anchor: 'neck',           controllable: { rotate: true, translate: true } },
  face:         { parentRole: 'head', anchor: 'center',         controllable: {} },
  eye_left:     { parentRole: 'head', anchor: 'center',         controllable: { scale: true, blink: true } },
  eye_right:    { parentRole: 'head', anchor: 'center',         controllable: { scale: true, blink: true } },
  eye_both:     { parentRole: 'head', anchor: 'center',         controllable: { scale: true, blink: true } },
  eyebrow_left: { parentRole: 'head', anchor: 'bottom_center',  controllable: { translate: true, rotate: true } },
  eyebrow_right:{ parentRole: 'head', anchor: 'bottom_center',  controllable: { translate: true, rotate: true } },
  mouth:        { parentRole: 'head', anchor: 'center',         controllable: { scale: true } },
  nose:         { parentRole: 'head', anchor: 'center',         controllable: {} },
  ear_left:     { parentRole: 'head', anchor: 'center',         controllable: { rotate: true } },
  ear_right:    { parentRole: 'head', anchor: 'center',         controllable: { rotate: true } },
  arm_left:     { parentRole: 'body', anchor: 'top_center',     controllable: { rotate: true } },
  arm_right:    { parentRole: 'body', anchor: 'top_center',     controllable: { rotate: true } },
  hand_left:    { parentRole: 'arm_left',  anchor: 'top_center', controllable: { rotate: true } },
  hand_right:   { parentRole: 'arm_right', anchor: 'top_center', controllable: { rotate: true } },
  accessory:    { parentRole: 'head', anchor: 'center',         controllable: { rotate: true, physics: 'pendulum' } },
  other:        { parentRole: 'body', anchor: 'center',         controllable: {} },
}

export function getSemanticEntry(role: SemanticRole): SemanticEntry {
  return SEMANTIC_MAP[role] || SEMANTIC_MAP.other
}

/**
 * 从 part_type 字符串推断语义角色
 * 基于规则匹配，覆盖 See-Through 输出的 90+ 部位标签变体
 */
export function inferSemanticRole(partType: string, id: string): SemanticRole {
  const pt = (partType || '').toLowerCase()
  const idL = (id || '').toLowerCase()

  const isLeft = pt.includes('left') || idL.includes('left') || idL.includes('_l_') || idL.endsWith('_l')
  const isRight = pt.includes('right') || idL.includes('right') || idL.includes('_r_') || idL.endsWith('_r')

  // 头发（注意顺序：hair_back/hair_front 要在通用 hair 之前）
  if (pt.includes('hair_back') || pt.includes('hairback')) return 'hair_back'
  if (pt.includes('hair_front') || pt.includes('hairfront')) return 'hair_front'
  if (pt.includes('hair_side') || pt.includes('hairside')) return 'hair_side'
  if (pt.includes('ahoge')) return 'hair_front'
  if (pt.startsWith('hair')) return 'hair_back'

  // 眉毛（必须在眼睛之前检查，因为 eyebrow 包含 "eye"）
  if (pt.includes('eyebrow') || pt.includes('brow')) {
    return isLeft ? 'eyebrow_left' : isRight ? 'eyebrow_right' : 'eyebrow_left'
  }

  // 眼睛
  if (pt.includes('eye') || pt.includes('iris') || pt.includes('pupil') || pt.includes('eyelash') || pt.includes('eyewhite')) {
    return isLeft ? 'eye_left' : isRight ? 'eye_right' : 'eye_both'
  }

  // 嘴 / 鼻 / 腮红
  if (pt.includes('mouth') || pt.includes('lip') || pt.includes('teeth') || pt.includes('tongue')) return 'mouth'
  if (pt.includes('nose')) return 'nose'
  if (pt.includes('blush')) return 'face'

  // 脸 / 头
  if (pt.includes('face')) return 'face'
  if (pt.includes('head')) return 'head'

  // 躯干
  if (pt.includes('neck')) return 'body'
  if (pt.includes('body') || pt.includes('torso') || pt.includes('chest') || pt.includes('breast') ||
      pt.includes('shirt') || pt.includes('cloth') || pt.includes('collar')) return 'body'

  // 手臂
  if (pt.includes('arm') || pt.includes('shoulder') || pt.includes('sleeve')) {
    return isLeft ? 'arm_left' : isRight ? 'arm_right' : 'arm_left'
  }

  // 手
  if (pt.includes('hand') || pt.includes('finger') || pt.includes('glove') || pt.includes('handwear')) {
    return isLeft ? 'hand_left' : isRight ? 'hand_right' : 'hand_left'
  }

  // 耳朵（排除 earwear/earring 等配饰）
  if (pt.startsWith('ear') && !pt.includes('wear') && !pt.includes('ring')) {
    return isLeft ? 'ear_left' : isRight ? 'ear_right' : 'ear_left'
  }

  // 腿部暂不参与 MVP 动画
  if (pt.includes('leg') || pt.includes('thigh') || pt.includes('calf') || pt.includes('knee') ||
      pt.includes('foot') || pt.includes('skirt') || pt.includes('pants') || pt.includes('sock') ||
      pt.includes('footwear')) return 'other'

  // 其余归配饰
  return 'accessory'
}

/**
 * 锚点策略 → 归一化锚点坐标（相对 bbox 0-1）
 * 用户可后续通过半自动 UI 调整
 */
export function anchorStrategyToNormalized(strategy: AnchorStrategy): { x: number; y: number } {
  switch (strategy) {
    case 'top_center':    return { x: 0.5, y: 0.0 }
    case 'bottom_center': return { x: 0.5, y: 1.0 }
    case 'neck':          return { x: 0.5, y: 0.85 }
    case 'center':        return { x: 0.5, y: 0.5 }
    case 'none':          return { x: 0.5, y: 0.5 }
    default:              return { x: 0.5, y: 0.5 }
  }
}
