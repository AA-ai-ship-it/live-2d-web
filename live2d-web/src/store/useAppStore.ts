'use client'

/**
 * 状态管理：统一 Store 入口
 *
 * 数据所有权：
 *  - 跨页面共享的状态 → 放这里
 *  - 单页面私有（上传进度、轮询计时器等）→ 页面内 useState/useRef
 *  - UI 小提示（toast）→ toastStore.ts 独立管理
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import type { HealthInfo, TaskInfo, LayerInfo, NsfwResult } from '@/lib/api'
import {
  DEFAULT_HEALTH,
  normalizeLayers,
  groupLayers,
  healthCheck as apiHealthCheck,
} from '@/lib/api'
import type { EffectInstance } from '@/lib/mockData'

// ========== Locale ==========

export type Locale = 'en' | 'ja' | 'zh-CN' | 'zh-TW'
export const LOCALES: Locale[] = ['en', 'ja', 'zh-CN', 'zh-TW']
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
}

export function detectBrowserLocale(default_: Locale = 'en'): Locale {
  if (typeof navigator === 'undefined') return default_
  const raw = (navigator.language || default_).toLowerCase()
  if (raw.startsWith('zh')) {
    return raw.includes('tw') || raw.includes('hk') || raw.includes('hant')
      ? 'zh-TW'
      : 'zh-CN'
  }
  if (raw.startsWith('ja')) return 'ja'
  return 'en'
}

// ========== Task ==========

export interface TaskState {
  taskId: string | null
  task: TaskInfo | null
  layers: LayerInfo[]
  groups: Record<string, LayerInfo[]>
}

// ========== Animation ==========

export interface AnimateState {
  activeEffects: Record<string, boolean>
  effectIntensity: Record<string, number> // 0-100
}

// ========== Full Store ==========

interface AppStore extends TaskState, AnimateState {
  // 基础：语言
  locale: Locale
  setLocale: (l: Locale) => void

  // 健康检查
  health: HealthInfo
  lastHealthCheckAt: number
  loadHealth: (force?: boolean) => Promise<HealthInfo>

  // NSFW
  nsfw: NsfwResult | null
  setNsfw: (r: NsfwResult | null) => void

  // 任务
  setTask: (task: TaskInfo) => void
  clearTask: () => void
  updateLayer: (id: string, patch: Partial<LayerInfo>) => void

  // 动画效果
  toggleEffect: (effectId: string) => void
  setEffectIntensity: (effectId: string, v: number) => void
  setActiveEffectsFromPreset: (effects: EffectInstance[]) => void
  resetAnimate: () => void
}

const HEALTH_TTL = 10 * 1000 // 健康检查缓存 10s

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // ---- Locale ----
      locale: detectBrowserLocale('en'),
      setLocale: (l) => set({ locale: l }),

      // ---- Health ----
      health: { ...DEFAULT_HEALTH },
      lastHealthCheckAt: 0,
      loadHealth: async (force = false) => {
        const now = Date.now()
        if (!force && now - get().lastHealthCheckAt < HEALTH_TTL) {
          return get().health
        }
        const h = await apiHealthCheck()
        set({ health: h, lastHealthCheckAt: now })
        return h
      },

      // ---- NSFW ----
      nsfw: null,
      setNsfw: (r) => set({ nsfw: r }),

      // ---- Task ----
      taskId: null,
      task: null,
      layers: [],
      groups: {},
      setTask: (t) => {
        const layers = normalizeLayers(t)
        const groups = groupLayers(layers)
        set({ taskId: t.task_id, task: t, layers, groups })
      },
      clearTask: () =>
        set({ taskId: null, task: null, layers: [], groups: {} }),
      updateLayer: (id, patch) =>
        set((s) => {
          const layers = s.layers.map((l) =>
            l.id === id ? { ...l, ...patch } : l
          )
          const groups = groupLayers(layers)
          return { layers, groups }
        }),

      // ---- Animate ----
      activeEffects: {},
      effectIntensity: {},
      toggleEffect: (id) =>
        set((s) => ({
          activeEffects: { ...s.activeEffects, [id]: !s.activeEffects[id] },
        })),
      setEffectIntensity: (id, v) =>
        set((s) => ({
          effectIntensity: {
            ...s.effectIntensity,
            [id]: Math.max(0, Math.min(100, v)),
          },
        })),
      setActiveEffectsFromPreset: (effs) => {
        const active: Record<string, boolean> = {}
        const intensity: Record<string, number> = {}
        for (const e of effs) {
          active[e.id] = !!e.defaultActive
          intensity[e.id] = e.defaultIntensity ?? 100
        }
        set({ activeEffects: active, effectIntensity: intensity })
      },
      resetAnimate: () =>
        set({ activeEffects: {}, effectIntensity: {} }),
    }),
    {
      name: 'live2d-web-store',
      storage: createJSONStorage(() => localStorage),
      // 只持久化这几个字段，其他页面刷新后重置
      partialize: (s) => ({
        locale: s.locale,
        health: s.health,
        lastHealthCheckAt: s.lastHealthCheckAt,
        activeEffects: s.activeEffects,
        effectIntensity: s.effectIntensity,
      }),
    }
  )
)

export default useAppStore
