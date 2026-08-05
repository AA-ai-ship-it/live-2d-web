/**
 * 规则引擎：LayerInfo[] → SplitResult
 *
 * 做三件事：
 * 1. 为每个后端图层推断语义角色
 * 2. 根据"部位语义 → 父子规则"自动绑定层级
 * 3. 根据锚点策略计算旋转中心
 */

import type { LayerInfo } from '@/lib/api'
import type { SplitResult, LayerPart, RigTree, RigNode, SemanticRole } from './types'
import { inferSemanticRole, getSemanticEntry, anchorStrategyToNormalized } from './semanticMap'

export interface BuildOptions {
  taskId: string
  canvasWidth?: number
  canvasHeight?: number
  /** 从 LayerInfo 获取图片 URL（由调用方决定如何拼接） */
  getLayerSrc: (layer: LayerInfo) => string
}

export function buildSplitResult(layers: LayerInfo[], opts: BuildOptions): SplitResult {
  const { taskId, canvasWidth, canvasHeight, getLayerSrc } = opts

  // 1. 推断语义角色，建立 role → partId 索引
  const roleIndex = new Map<SemanticRole, string>()
  const partList: LayerPart[] = layers.map((layer) => {
    const role = inferSemanticRole(layer.part_type || layer.name, layer.id)
    if (!roleIndex.has(role)) {
      roleIndex.set(role, layer.id)
    }
    return layerToPart(layer, role, getLayerSrc)
  })

  // 2. head 缺失回退：如果没有 head 但有 face，face 充当 head
  if (!roleIndex.has('head') && roleIndex.has('face')) {
    roleIndex.set('head', roleIndex.get('face')!)
  }

  // 3. 确定 root（body 优先，否则 zIndex 最大的）
  const rootId =
    roleIndex.get('body') ||
    [...partList].sort((a, b) => b.zIndex - a.zIndex)[0]?.id ||
    partList[0]?.id ||
    ''

  // 4. 为每个 part 解析 parent
  for (const part of partList) {
    const entry = getSemanticEntry(part.semanticRole)
    part.parentRole = entry.parentRole

    if (entry.parentRole) {
      // 精确匹配父级角色
      part.parent = roleIndex.get(entry.parentRole) || null
      // 回退：找不到精确父级时挂到 body 或 root
      if (!part.parent && part.id !== rootId) {
        part.parent = roleIndex.get('body') || rootId || null
      }
    } else {
      // 没有 parentRole 的是 root 自身
      part.parent = part.id === rootId ? null : rootId || null
    }
  }

  // 5. 推断画布尺寸
  const maxRight = Math.max(...partList.map((p) => p.x + p.width), 0)
  const maxBottom = Math.max(...partList.map((p) => p.y + p.height), 0)
  const cw = canvasWidth || Math.max(maxRight, 512)
  const ch = canvasHeight || Math.max(maxBottom, 512)

  // 6. 构建 RigTree
  const nodes: Record<string, RigNode> = {}
  for (const part of partList) {
    const pivotX = part.x + part.anchor.x * part.width
    const pivotY = part.y + part.anchor.y * part.height
    nodes[part.id] = {
      id: part.id,
      parentId: part.parent,
      childrenIds: [],
      pivot: { x: pivotX, y: pivotY },
    }
  }
  // 填充 childrenIds
  for (const part of partList) {
    if (part.parent && nodes[part.parent]) {
      nodes[part.parent].childrenIds.push(part.id)
    }
  }

  const rig: RigTree = { root: rootId, nodes }

  const partsById: Record<string, LayerPart> = {}
  for (const p of partList) partsById[p.id] = p

  return {
    version: '1.0',
    taskId,
    canvas: { width: cw, height: ch },
    parts: partList,
    partsById,
    rig,
  }
}

/** LayerInfo → LayerPart（单个图层转换） */
function layerToPart(
  layer: LayerInfo,
  role: SemanticRole,
  getLayerSrc: (layer: LayerInfo) => string,
): LayerPart {
  const entry = getSemanticEntry(role)
  const anchor = anchorStrategyToNormalized(entry.anchor)
  return {
    id: layer.id,
    name: layer.name,
    partType: layer.part_type || layer.name,
    semanticRole: role,
    src: getLayerSrc(layer),
    x: layer.left,
    y: layer.top,
    width: layer.width,
    height: layer.height,
    zIndex: layer.z_index || 0,
    anchor,
    anchorStrategy: entry.anchor,
    parent: null,
    parentRole: entry.parentRole,
    visible: true,
    controllable: entry.controllable,
    confirmed: false,
  }
}

/**
 * 更新单个 part 的锚点（半自动确认模式用）
 * 用户拖拽后调用，重新计算 pivot
 */
export function updatePartAnchor(
  result: SplitResult,
  partId: string,
  anchor: { x: number; y: number },
): void {
  const part = result.partsById[partId]
  if (!part) return
  part.anchor = anchor
  part.confirmed = true
  const node = result.rig.nodes[partId]
  if (node) {
    node.pivot = {
      x: part.x + anchor.x * part.width,
      y: part.y + anchor.y * part.height,
    }
  }
}
