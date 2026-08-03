/**
 * 轻量 i18n hook
 * - 直接读取 JSON，支持嵌套键（a.b.c）
 * - 支持占位符替换 {name}
 * - 日文上线时新增 ja.json + 切换 locale 即可，无需重构
 */
import { useCallback } from 'react'
import en from './en.json'

type Dict = typeof en

// 预留：日文上线后导入 ja.json，按 locale 切换
const DICTS: Record<string, Dict> = {
  en,
}

const currentLocale = 'en'

/** 按点分键取嵌套值 */
function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

/** 占位符替换，如 "Hi {name}" + { name: 'A' } → "Hi A" */
function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

export function useT() {
  const dict = DICTS[currentLocale]
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const val = get(dict, key)
      if (typeof val !== 'string') {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[i18n] missing key: ${key}`)
        }
        return key
      }
      return interpolate(val, vars)
    },
    [dict]
  )
  return t
}

export type TFunc = ReturnType<typeof useT>
