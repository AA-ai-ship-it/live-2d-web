/**
 * SplitResult 类型定义
 * 后端拆分结果 → 前端动画引擎标准化格式
 */

// 语义角色：效果系统通过这个匹配部位，不依赖 See-Through 原始标签
export type SemanticRole =
  | 'hair_back' | 'hair_front' | 'hair_side'
  | 'body' | 'head' | 'face'
  | 'eye_left' | 'eye_right' | 'eye_both'
  | 'eyebrow_left' | 'eyebrow_right'
  | 'mouth' | 'nose'
  | 'ear_left' | 'ear_right'
  | 'arm_left' | 'arm_right'
  | 'hand_left' | 'hand_right'
  | 'accessory' | 'other'

// 锚点策略：规则引擎用来推断旋转中心
export type AnchorStrategy =
  | 'top_center'     // 手臂/腿：连接躯干端在顶部
  | 'bottom_center'  // 头发：连接头皮在底部
  | 'center'         // 眼/嘴/鼻：中心
  | 'neck'           // 头部：脖子位置（偏底部）
  | 'none'           // 默认中心

// 可控参数：效果系统读取，知道这个部位能做什么
export interface ControllableParams {
  translate?: boolean
  rotate?: boolean
  scale?: boolean
  blink?: boolean           // 眨眼（眼睛专用）
  physics?: 'pendulum' | 'none'
}

// 单个部位图层（前端渲染 + 动画的基本单元）
export interface LayerPart {
  id: string
  name: string
  partType: string              // See-Through 原始标签
  semanticRole: SemanticRole    // 推断出的语义角色
  src: string                   // 图片 URL
  x: number                     // 在画布中的左上角 x
  y: number
  width: number
  height: number
  zIndex: number
  anchor: { x: number; y: number }       // 归一化锚点 0-1（相对自身 bbox）
  anchorStrategy: AnchorStrategy
  parent: string | null                  // 父级 part id
  parentRole: SemanticRole | null
  visible: boolean
  controllable: ControllableParams
  confirmed: boolean                    // 锚点是否被用户确认（半自动模式）
}

// 层级节点
export interface RigNode {
  id: string
  parentId: string | null
  childrenIds: string[]
  pivot: { x: number; y: number }  // 旋转中心（画布绝对坐标）
}

// 父子层级树
export interface RigTree {
  root: string
  nodes: Record<string, RigNode>
}

// 完整拆分结果（后端 → 前端的"对接协议"）
export interface SplitResult {
  version: string
  taskId: string
  canvas: { width: number; height: number }
  parts: LayerPart[]
  partsById: Record<string, LayerPart>
  rig: RigTree
}

// 效果状态（从 UI 传给动画引擎）
export interface EffectState {
  id: string
  enabled: boolean
  intensity: number  // 0-1
}
