'use client'

import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warn' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration: number // ms, 0 = 不自动关闭
}

interface ToastState {
  items: ToastItem[]
  show: (
    type: ToastType,
    message: string,
    duration?: number
  ) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],

  show: (type, message, duration = 3000) => {
    const id = Math.random().toString(36).slice(2, 9)
    set((s) => ({ items: [...s.items, { id, type, message, duration }] }))
    if (duration > 0) {
      setTimeout(() => {
        get().dismiss(id)
      }, duration)
    }
    return id
  },

  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  clear: () => set({ items: [] }),
}))

/** 快捷调用，任何地方都能用（不需要组件内 hook） */
export const toast = {
  success: (msg: string, dur?: number) => useToastStore.getState().show('success', msg, dur),
  error: (msg: string, dur?: number) => useToastStore.getState().show('error', msg, dur),
  warn: (msg: string, dur?: number) => useToastStore.getState().show('warn', msg, dur),
  info: (msg: string, dur?: number) => useToastStore.getState().show('info', msg, dur),
}
