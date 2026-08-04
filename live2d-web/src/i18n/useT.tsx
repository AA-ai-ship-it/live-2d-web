'use client'

/**
 * 轻量 i18n hook
 * 语言状态从 zustand Store 取（唯一可信源）
 * 本 hook 只负责：翻译文案 + 暴露 provider（兼容已有代码）
 */

import en from './en.json'
import ja from './ja.json'
import zhCN from './zh-CN.json'
import zhTW from './zh-TW.json'
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
  useEffect,
} from 'react'
import {
  useAppStore,
  LOCALES,
  type Locale,
  LOCALE_LABELS,
  detectBrowserLocale,
} from '@/store/useAppStore'

// 语言元信息（下拉菜单用）
export interface LocaleMeta {
  code: Locale
  short: string
  label: string
}
export const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN',
  ja: 'JP',
  'zh-CN': '简中',
  'zh-TW': '繁中',
}
export const LOCALE_META: LocaleMeta[] = LOCALES.map((code) => ({
  code,
  short: LOCALE_SHORT[code],
  label: LOCALE_LABELS[code],
}))

// 兼容旧代码：别名导出
export { LOCALES }
export type LocaleCode = Locale

const DICTS: Record<Locale, any> = {
  en,
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

type Dict = typeof en

export function getByPath(obj: any, path: string, fallback?: string): string {
  if (!path || typeof obj !== 'object') return fallback ?? path
  const parts = path.split('.')
  let cur: any = obj
  for (const p of parts) {
    if (cur == null) return fallback ?? path
    cur = cur[p]
  }
  if (cur == null) return fallback ?? path
  return String(cur)
}

export function interpolate(
  text: string,
  params?: Record<string, string | number>
): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (_, k) => {
    return params[k] != null ? String(params[k]) : `{${k}}`
  })
}

export function translate(
  locale: Locale,
  key: string,
  arg2?: Record<string, string | number> | string,
  arg3?: Record<string, string | number> | string
): string {
  let params: Record<string, string | number> | undefined
  let fallback: string | undefined
  // 支持多种形式: t(k), t(k, params), t(k, fallback), t(k, params, fallback), t(k, fallback, params)
  if (typeof arg2 === 'object') {
    params = arg2
    if (typeof arg3 === 'string') fallback = arg3
  } else if (typeof arg2 === 'string') {
    if (typeof arg3 === 'object') {
      // t(k, fallback, params)
      fallback = arg2
      params = arg3
    } else {
      // t(k, fallback)
      fallback = arg2
    }
  }
  const dict: Dict = (DICTS[locale] || DICTS.en) as Dict
  const enDict: Dict = DICTS.en as Dict
  let text = getByPath(dict, key, undefined)
  if (text === undefined) text = getByPath(enDict, key, fallback ?? key)
  return interpolate(text, params)
}

// ---------- Hook ----------

export interface UseTResult {
  locale: Locale
  setLocale: (l: Locale) => void
  locales: Locale[]
  labels: Record<Locale, string>
  t: (
    key: string,
    arg2?: Record<string, string | number> | string,
    arg3?: Record<string, string | number> | string
  ) => string
}

export function useT(): UseTResult {
  const locale = useAppStore((s) => s.locale)
  const setLocale = useAppStore((s) => s.setLocale)
  const t = (
    key: string,
    arg2?: Record<string, string | number> | string,
    arg3?: Record<string, string | number> | string
  ) => translate(locale, key, arg2, arg3)
  return { locale, setLocale, locales: LOCALES, labels: LOCALE_LABELS, t }
}

// 兼容旧代码：alias
export const useI18n = useT

// ---------- Provider（兼容旧代码，实际上状态都在 zustand 里） ----------

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useAppStore((s) => s.locale)
  const setLocale = useAppStore((s) => s.setLocale)

  // 首次加载自动检测浏览器语言
  useEffect(() => {
    const stored = localStorage.getItem('live2d-web-store')
    if (!stored) {
      const detected = detectBrowserLocale('en')
      if (detected !== locale) setLocale(detected)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // <html lang=""> 同步
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18nContext() {
  return useContext(I18nContext)
}
