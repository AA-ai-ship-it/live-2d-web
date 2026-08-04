'use client'

import { AppError, ErrorCode, httpStatusToCode } from './errors'

export interface RequestOptions extends RequestInit {
  timeout?: number
  /** 如果返回非 2xx 是否抛出 AppError（默认 true） */
  throwOnHttpError?: boolean
  /** 是否尝试解析 JSON（默认 true），false 则原样返回 Response */
  parseJson?: boolean
  /** token 获取器（后续用户系统接入时用） */
  tokenGetter?: () => string | null | Promise<string | null>
}

export const DEFAULT_TIMEOUT = Number(
  process.env.NEXT_PUBLIC_REQUEST_TIMEOUT || 30000
)
export const UPLOAD_TIMEOUT = 5 * 60 * 1000 // 上传 5 分钟

const BASE_URL = (() => {
  const raw = process.env.NEXT_PUBLIC_API_BASE || ''
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
})()

/** 获取后端 API 的基础地址（集中管理，避免散落） */
export function getApiBase(): string {
  return BASE_URL
}

function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${BASE_URL}${normalized}`
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('TIMEOUT', 0, `timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    promise
      .then((v) => {
        clearTimeout(timer)
        resolve(v)
      })
      .catch((e) => {
        clearTimeout(timer)
        reject(e)
      })
  })
}

/** 通用请求包装器 */
export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT,
    throwOnHttpError = true,
    parseJson = true,
    tokenGetter,
    headers,
    ...rest
  } = options

  const url = buildUrl(path)
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  }

  // token 自动附加（如有）
  if (tokenGetter) {
    const token = await tokenGetter()
    if (token) finalHeaders['Authorization'] = `Bearer ${token}`
  }

  try {
    const resp = await withTimeout(
      fetch(url, { ...rest, headers: finalHeaders }),
      timeout
    )

    // HTTP 状态码拦截
    if (throwOnHttpError && !resp.ok) {
      const code: ErrorCode = httpStatusToCode(resp.status)
      let rawMsg: string | undefined
      try {
        const data = await resp.json()
        rawMsg = data?.message || data?.msg || data?.error
      } catch {
        /* ignore */
      }
      throw new AppError(code, resp.status, rawMsg)
    }

    if (!parseJson) return resp as unknown as T

    // 尝试解析 JSON，再检查业务 code
    const text = await resp.text()
    if (!text) return undefined as unknown as T

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      return text as unknown as T
    }

    // 业务 code 约定：{ code: number, message, data } 或 { status: 'failed', message }
    if (data && typeof data === 'object') {
      const bizCode = data.code ?? (data.status === 'failed' ? 400 : null)
      if (typeof bizCode === 'number' && bizCode >= 400) {
        const ec = httpStatusToCode(bizCode)
        throw new AppError(ec, bizCode, data.message)
      }
      // NSFW 业务状态
      if (data.nsfw_status === 'NSFW_REJECT') {
        throw new AppError('NSFW_REJECT', 400, data.message)
      }
      if (data.nsfw_status === 'NSFW_REVIEW') {
        throw new AppError('NSFW_REVIEW', 200, data.message)
      }
    }

    return data as T
  } catch (err) {
    if (err instanceof AppError) throw err
    // 网络错误
    if (
      err instanceof TypeError &&
      (err.message.includes('fetch') ||
        err.message.includes('Network') ||
        err.message === 'Failed to fetch')
    ) {
      throw new AppError('NETWORK_ERROR', 0, err.message)
    }
    // 兜底
    throw new AppError(
      'UNKNOWN',
      0,
      err instanceof Error ? err.message : String(err)
    )
  }
}

/** 快捷方法 */
export const http = {
  get: <T = unknown>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'GET' }),

  post: <T = unknown>(
    path: string,
    body?: unknown,
    opts?: RequestOptions
  ) => {
    const headers: Record<string, string> = {}
    let finalBody: BodyInit | undefined
    if (body instanceof FormData) {
      finalBody = body
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      finalBody = JSON.stringify(body)
    }
    return request<T>(path, {
      ...opts,
      method: 'POST',
      headers: { ...headers, ...(opts?.headers as object | undefined) },
      body: finalBody,
    })
  },

  put: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) =>
    http.post<T>(path, body, { ...opts, method: 'PUT' }),

  delete: <T = unknown>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
}
