'use client'

export type ErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'TOO_MANY_REQUESTS'
  | 'SERVER_ERROR'
  | 'NSFW_REJECT'
  | 'NSFW_REVIEW'
  | 'UNKNOWN'

const DEFAULT_MESSAGES: Record<ErrorCode, Record<string, string>> = {
  NETWORK_ERROR: {
    en: 'Network error, please check your connection',
    ja: 'ネットワークエラー、接続を確認してください',
    'zh-CN': '网络错误，请检查连接',
    'zh-TW': '網絡錯誤，請檢查連接',
  },
  TIMEOUT: {
    en: 'Request timeout, please try again',
    ja: 'リクエストがタイムアウトしました',
    'zh-CN': '请求超时，请重试',
    'zh-TW': '請求超時，請重試',
  },
  BAD_REQUEST: {
    en: 'Invalid request',
    ja: '無効なリクエスト',
    'zh-CN': '请求无效',
    'zh-TW': '請求無效',
  },
  UNAUTHORIZED: {
    en: 'Please log in first',
    ja: 'ログインしてください',
    'zh-CN': '请先登录',
    'zh-TW': '請先登錄',
  },
  FORBIDDEN: {
    en: 'Access denied',
    ja: 'アクセスが拒否されました',
    'zh-CN': '无权访问',
    'zh-TW': '無權訪問',
  },
  NOT_FOUND: {
    en: 'Resource not found',
    ja: 'リソースが見つかりません',
    'zh-CN': '资源不存在',
    'zh-TW': '資源不存在',
  },
  TOO_MANY_REQUESTS: {
    en: 'Too many requests, please slow down',
    ja: 'リクエストが多すぎます',
    'zh-CN': '请求过于频繁，请稍后再试',
    'zh-TW': '請求過於頻繁，請稍後再試',
  },
  SERVER_ERROR: {
    en: 'Server error, please try later',
    ja: 'サーバーエラー、後でお試しください',
    'zh-CN': '服务器错误，请稍后再试',
    'zh-TW': '服務器錯誤，請稍後再試',
  },
  NSFW_REJECT: {
    en: 'Content rejected by safety policy',
    ja: 'コンテンツが安全ポリシーで拒否されました',
    'zh-CN': '内容不符合安全政策',
    'zh-TW': '內容不符合安全政策',
  },
  NSFW_REVIEW: {
    en: 'Content needs manual review',
    ja: 'コンテンツの手動確認が必要です',
    'zh-CN': '内容需要人工审核',
    'zh-TW': '內容需要人工審核',
  },
  UNKNOWN: {
    en: 'Something went wrong',
    ja: 'エラーが発生しました',
    'zh-CN': '出现未知错误',
    'zh-TW': '出現未知錯誤',
  },
}

export class AppError extends Error {
  code: ErrorCode
  statusCode: number
  rawMessage?: string

  constructor(code: ErrorCode, statusCode = 0, rawMessage?: string) {
    super(code)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.rawMessage = rawMessage
  }

  getMessage(locale: string = 'en'): string {
    const dict = DEFAULT_MESSAGES[this.code] || DEFAULT_MESSAGES.UNKNOWN
    return dict[locale] || dict.en || this.rawMessage || 'Error'
  }
}

export function httpStatusToCode(status: number): ErrorCode {
  if (status === 400) return 'BAD_REQUEST'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'TOO_MANY_REQUESTS'
  if (status >= 500) return 'SERVER_ERROR'
  return 'UNKNOWN'
}

export function nsfwStatusToCode(status: string): ErrorCode | null {
  if (status === 'NSFW_REJECT') return 'NSFW_REJECT'
  if (status === 'NSFW_REVIEW') return 'NSFW_REVIEW'
  return null
}
