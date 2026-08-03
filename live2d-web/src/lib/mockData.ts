/**
 * Mock 数据 —— 动画实验室原型用
 * 模拟 AI 拆分后的图层（SVG data URL，无需外部图片文件）
 */

// ====== 类型定义 ======
export type PartType =
  | 'hair_back' | 'body' | 'face' | 'ear' | 'eye' | 'eyebrow'
  | 'mouth' | 'nose' | 'hair_front' | 'accessory' | 'cloth'

export interface MockLayer {
  id: string
  name: string
  partType: PartType
  svg: string         // SVG 字符串
  x: number           // 在 512x512 画布中的左上角 x
  y: number           // 在 512x512 画布中的左上角 y
  w: number
  h: number
  zIndex: number      // 越大越底层
  visible: boolean
}

// ====== 辅助：SVG → data URL ======
function svgUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// ====== 生成各部位的 SVG ======
// 画布逻辑尺寸 512×512，角色居中

const hairBackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="320" viewBox="0 0 280 320">
  <path d="M140 10 C60 10 20 80 20 160 C20 240 40 300 60 310 L100 310 L80 200 C70 150 80 80 140 60 C200 80 210 150 200 200 L180 310 L220 310 C240 300 260 240 260 160 C260 80 220 10 140 10Z" fill="#3b2a5e" opacity="0.9"/>
  <path d="M60 280 Q50 300 55 310 L100 310 L90 270 Z" fill="#3b2a5e"/>
  <path d="M220 280 Q230 300 225 310 L180 310 L190 270 Z" fill="#3b2a5e"/>
</svg>`

const bodySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="180" viewBox="0 0 200 180">
  <path d="M50 20 C50 10 70 5 100 5 C130 5 150 10 150 20 L155 160 C155 170 145 175 100 175 C55 175 45 170 45 160 Z" fill="#e8d5c4"/>
  <path d="M60 30 C60 20 80 15 100 15 C120 15 140 20 140 30 L140 80 L60 80 Z" fill="#f5e6d3"/>
  <!-- 衣服领口 -->
  <path d="M55 70 C70 85 130 85 145 70 L150 160 C150 168 142 172 100 172 C58 172 50 168 50 160 Z" fill="#6b46c1" opacity="0.85"/>
  <path d="M85 72 Q100 85 115 72 L115 90 L85 90 Z" fill="#e8d5c4"/>
</svg>`

const faceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="170" viewBox="0 0 160 170">
  <ellipse cx="80" cy="85" rx="62" ry="75" fill="#f5e6d3"/>
  <!-- 腮红 -->
  <ellipse cx="40" cy="105" rx="12" ry="8" fill="#ff9999" opacity="0.25"/>
  <ellipse cx="120" cy="105" rx="12" ry="8" fill="#ff9999" opacity="0.25"/>
</svg>`

const earLeftSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
  <path d="M18 5 C8 5 4 15 4 22 C4 30 10 33 16 31 C22 29 22 15 18 5Z" fill="#f0dcc8"/>
  <path d="M12 12 C8 16 8 24 12 26" stroke="#d4b896" stroke-width="1.5" fill="none"/>
</svg>`

const earRightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
  <path d="M6 5 C16 5 20 15 20 22 C20 30 14 33 8 31 C2 29 2 15 6 5Z" fill="#f0dcc8"/>
  <path d="M12 12 C16 16 16 24 12 26" stroke="#d4b896" stroke-width="1.5" fill="none"/>
</svg>`

const eyeLeftSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30">
  <ellipse cx="20" cy="15" rx="16" ry="11" fill="white"/>
  <ellipse cx="20" cy="14" rx="10" ry="9" fill="#6b3fa0"/>
  <ellipse cx="20" cy="14" rx="5" ry="6" fill="#4a2080"/>
  <circle cx="17" cy="11" r="3" fill="white" opacity="0.9"/>
  <circle cx="22" cy="16" r="1.5" fill="white" opacity="0.6"/>
  <!-- 上眼睑 -->
  <path d="M4 13 Q20 4 36 13" stroke="#2a1a3e" stroke-width="2.5" fill="none" stroke-linecap="round"/>
</svg>`

const eyeRightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30">
  <ellipse cx="20" cy="15" rx="16" ry="11" fill="white"/>
  <ellipse cx="20" cy="14" rx="10" ry="9" fill="#6b3fa0"/>
  <ellipse cx="20" cy="14" rx="5" ry="6" fill="#4a2080"/>
  <circle cx="17" cy="11" r="3" fill="white" opacity="0.9"/>
  <circle cx="22" cy="16" r="1.5" fill="white" opacity="0.6"/>
  <path d="M4 13 Q20 4 36 13" stroke="#2a1a3e" stroke-width="2.5" fill="none" stroke-linecap="round"/>
</svg>`

const eyebrowLeftSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="8" viewBox="0 0 36 8">
  <path d="M2 6 Q18 0 34 5" stroke="#3b2a5e" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`

const eyebrowRightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="8" viewBox="0 0 36 8">
  <path d="M2 5 Q18 0 34 6" stroke="#3b2a5e" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`

const mouthSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="14" viewBox="0 0 24 14">
  <path d="M4 4 Q12 12 20 4" stroke="#c47070" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M6 4 Q12 8 18 4" fill="#e88080" opacity="0.3"/>
</svg>`

const noseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">
  <path d="M4 1 L3 5 L5 5 Z" fill="#d4b896" opacity="0.5"/>
</svg>`

const hairFrontSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <path d="M100 5 C40 5 20 40 15 90 L20 110 C25 80 35 60 50 55 C45 70 48 90 52 100 C55 75 65 50 80 48 C75 65 78 85 82 95 C85 70 95 45 100 42 C105 45 115 70 118 95 C122 85 125 65 120 48 C135 50 145 75 148 100 C152 90 155 70 150 55 C165 60 175 80 180 110 L185 90 C180 40 160 5 100 5Z" fill="#4a3470"/>
  <!-- 高光 -->
  <path d="M80 20 Q100 10 120 20" stroke="#6b5a9e" stroke-width="2" fill="none" opacity="0.5"/>
</svg>`

const accessorySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
  <path d="M15 4 L17 11 L24 11 L18 15 L20 22 L15 18 L10 22 L12 15 L6 11 L13 11 Z" fill="#22d3ee" opacity="0.8"/>
  <circle cx="15" cy="14" r="3" fill="#fff" opacity="0.6"/>
</svg>`

// ====== 图层列表（zIndex 大 = 底层）======
export const MOCK_LAYERS: MockLayer[] = [
  { id: 'hair_back',   name: 'Back Hair',    partType: 'hair_back',   svg: svgUrl(hairBackSvg),   x: 116, y: 60,  w: 280, h: 320, zIndex: 100, visible: true },
  { id: 'body',        name: 'Body',         partType: 'body',         svg: svgUrl(bodySvg),       x: 156, y: 210, w: 200, h: 180, zIndex: 90,  visible: true },
  { id: 'face',        name: 'Face',         partType: 'face',         svg: svgUrl(faceSvg),       x: 176, y: 90,  w: 160, h: 170, zIndex: 80,  visible: true },
  { id: 'ear_left',    name: 'Ear (L)',      partType: 'ear',          svg: svgUrl(earLeftSvg),    x: 168, y: 160, w: 24,  h: 36,  zIndex: 75,  visible: true },
  { id: 'ear_right',   name: 'Ear (R)',      partType: 'ear',          svg: svgUrl(earRightSvg),   x: 320, y: 160, w: 24,  h: 36,  zIndex: 75,  visible: true },
  { id: 'eye_left',    name: 'Eye (L)',      partType: 'eye',          svg: svgUrl(eyeLeftSvg),    x: 200, y: 155, w: 40,  h: 30,  zIndex: 60,  visible: true },
  { id: 'eye_right',   name: 'Eye (R)',      partType: 'eye',          svg: svgUrl(eyeRightSvg),   x: 272, y: 155, w: 40,  h: 30,  zIndex: 60,  visible: true },
  { id: 'eyebrow_left',name: 'Eyebrow (L)',  partType: 'eyebrow',      svg: svgUrl(eyebrowLeftSvg),x: 202, y: 138, w: 36,  h: 8,   zIndex: 55,  visible: true },
  { id: 'eyebrow_right',name:'Eyebrow (R)',  partType: 'eyebrow',      svg: svgUrl(eyebrowRightSvg),x:274, y: 138, w: 36,  h: 8,   zIndex: 55,  visible: true },
  { id: 'nose',        name: 'Nose',         partType: 'nose',         svg: svgUrl(noseSvg),       x: 252, y: 175, w: 8,   h: 8,   zIndex: 50,  visible: true },
  { id: 'mouth',       name: 'Mouth',        partType: 'mouth',        svg: svgUrl(mouthSvg),      x: 244, y: 195, w: 24,  h: 14,  zIndex: 50,  visible: true },
  { id: 'hair_front',  name: 'Front Hair',   partType: 'hair_front',   svg: svgUrl(hairFrontSvg),  x: 156, y: 60,  w: 200, h: 120, zIndex: 40,  visible: true },
  { id: 'accessory',   name: 'Accessory',    partType: 'accessory',    svg: svgUrl(accessorySvg),  x: 296, y: 72,  w: 30,  h: 30,  zIndex: 30,  visible: true },
]

// ====== 效果定义 ======
export type EffectCategory = 'face' | 'body' | 'hair' | 'scene'

export interface EffectDef {
  id: string
  nameKey: string         // i18n key
  descKey: string
  category: EffectCategory
  targetParts: PartType[] // 影响哪些部位类型
  icon: string            // emoji 或 SVG path
  defaultIntensity: number // 0-1
}

export const EFFECT_DEFS: EffectDef[] = [
  // ---- Face ----
  {
    id: 'blink',
    nameKey: 'animate.effects.blink.name',
    descKey: 'animate.effects.blink.desc',
    category: 'face',
    targetParts: ['eye'],
    icon: 'eye',
    defaultIntensity: 0.6,
  },
  {
    id: 'eye_shine',
    nameKey: 'animate.effects.eyeShine.name',
    descKey: 'animate.effects.eyeShine.desc',
    category: 'face',
    targetParts: ['eye'],
    icon: 'sparkle',
    defaultIntensity: 0.5,
  },
  {
    id: 'blush',
    nameKey: 'animate.effects.blush.name',
    descKey: 'animate.effects.blush.desc',
    category: 'face',
    targetParts: ['face'],
    icon: 'heart',
    defaultIntensity: 0.4,
  },
  {
    id: 'mouth_talk',
    nameKey: 'animate.effects.talk.name',
    descKey: 'animate.effects.talk.desc',
    category: 'face',
    targetParts: ['mouth'],
    icon: 'chat',
    defaultIntensity: 0.5,
  },
  // ---- Body ----
  {
    id: 'breath',
    nameKey: 'animate.effects.breath.name',
    descKey: 'animate.effects.breath.desc',
    category: 'body',
    targetParts: ['body', 'face', 'eye', 'eyebrow', 'nose', 'mouth'],
    icon: 'wind',
    defaultIntensity: 0.5,
  },
  {
    id: 'head_tilt',
    nameKey: 'animate.effects.headTilt.name',
    descKey: 'animate.effects.headTilt.desc',
    category: 'body',
    targetParts: ['face', 'eye', 'eyebrow', 'nose', 'mouth', 'ear', 'hair_front'],
    icon: 'tilt',
    defaultIntensity: 0.4,
  },
  {
    id: 'body_sway',
    nameKey: 'animate.effects.sway.name',
    descKey: 'animate.effects.sway.desc',
    category: 'body',
    targetParts: ['body', 'face', 'eye', 'eyebrow', 'nose', 'mouth', 'ear', 'hair_front', 'hair_back', 'accessory'],
    icon: 'sway',
    defaultIntensity: 0.3,
  },
  // ---- Hair ----
  {
    id: 'hair_swing',
    nameKey: 'animate.effects.hairSwing.name',
    descKey: 'animate.effects.hairSwing.desc',
    category: 'hair',
    targetParts: ['hair_front', 'hair_back'],
    icon: 'leaf',
    defaultIntensity: 0.5,
  },
  {
    id: 'accessory_sway',
    nameKey: 'animate.effects.accessorySway.name',
    descKey: 'animate.effects.accessorySway.desc',
    category: 'hair',
    targetParts: ['accessory'],
    icon: 'star',
    defaultIntensity: 0.4,
  },
  // ---- Scene ----
  {
    id: 'sparkle_bg',
    nameKey: 'animate.effects.sparkleBg.name',
    descKey: 'animate.effects.sparkleBg.desc',
    category: 'scene',
    targetParts: [],
    icon: 'sparkles',
    defaultIntensity: 0.3,
  },
]

// ====== 导出格式 ======
export type ExportFormat = 'gif' | 'live2d' | 'video'

export const EXPORT_FORMATS: { id: ExportFormat; nameKey: string; icon: string }[] = [
  { id: 'gif',     nameKey: 'animate.export.gif',     icon: 'GIF' },
  { id: 'live2d',  nameKey: 'animate.export.live2d',  icon: 'L2D' },
  { id: 'video',   nameKey: 'animate.export.video',   icon: 'MP4' },
]
