'use client'

/**
 * 轻量 i18n hook
 * - 直接读取 JSON，支持嵌套键（a.b.c）
 * - 支持占位符替换 {name}
 * - 运行时切换 locale（localStorage 持久化）
 */
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import en from './en.json'
import ja from './ja.json'
import zhCN from './zh-CN.json'
import zhTW from './zh-TW.json'

type Dict = typeof en

const DICTS: Record<string, Dict> = {
  en,
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

export const LOCALES = [
  { code: 'en',    label: 'English',    short: 'EN' },
  { code: 'ja',    label: '日本語',      short: 'JA' },
  { code: 'zh-CN', label: '简体中文',    short: 'CN' },
  { code: 'zh-TW', label: '繁體中文',    short: 'TW' },
] as const

export type LocaleCode = typeof LOCALES[number]['code']

const STORAGE_KEY = 'live2d-locale'

function getInitialLocale(): LocaleCode {
  if (typeof window === 'undefined') return 'en'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && saved in DICTS) return saved as LocaleCode
  // 浏览器语言检测
  const browser = navigator.language
  if (browser.startsWith('ja')) return 'ja'
  if (browser.startsWith('zh-TW') || browser.startsWith('zh-HK') || browser.startsWith('zh-MO')) return 'zh-TW'
  if (browser.startsWith('zh')) return 'zh-CN'
  return 'en'
}

/** 按点分键取嵌套值 */
function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

/** 占位符替换 */
function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

// ====== Context ======
interface I18nContextValue {
  locale: LocaleCode
  setLocale: (code: LocaleCode) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(getInitialLocale)

  const setLocale = useCallback((code: LocaleCode) => {
    setLocaleState(code)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, code)
      document.documentElement.lang = code
    }
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTS[locale] ?? DICTS.en
      const val = get(dict, key)
      if (typeof val !== 'string') {
        // fallback to English
        const fallback = get(DICTS.en, key)
        if (typeof fallback === 'string') return interpolate(fallback, vars)
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[i18n] missing key: ${key}`)
        }
        return key
      }
      return interpolate(val, vars)
    },
    [locale]
  )

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useT() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    // SSR fallback
    return (key: string, vars?: Record<string, string | number>) => {
      const val = get(DICTS.en, key)
      return typeof val === 'string' ? interpolate(val, vars) : key
    }
  }
  return ctx.t
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    return {
      locale: 'en' as LocaleCode,
      setLocale: () => {},
      t: (key: string) => key,
    }
  }
  return ctx
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string
