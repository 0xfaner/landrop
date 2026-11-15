export const api = '/api/v1'

type RequestOptions = RequestInit & { token?: string }

export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function errorResponse(data: unknown, fallback: string) {
  if (typeof data !== 'object' || data === null || !('error' in data) || typeof data.error !== 'string') {
    return fallback
  }
  return data.error
}

async function send(path: string, { token, headers, ...options }: RequestOptions = {}) {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('X-LanDrop', '1')
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`)
  const response = await fetch(api + path, { ...options, headers: requestHeaders })
  if (!response.ok) {
    const fallback = `Request failed (HTTP ${response.status})`
    const data: unknown = await response.json().catch(() => null)
    throw new RequestError(errorResponse(data, fallback), response.status)
  }
  return response
}

function mediaType(response: Response) {
  return response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
}

export async function requestNoContent(path: string, options?: RequestOptions): Promise<void> {
  const response = await send(path, options)
  if (response.status !== 204) {
    throw new RequestError(`Expected an empty response (HTTP ${response.status})`, response.status)
  }
}

export async function requestJson<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await send(path, options)
  if (mediaType(response) !== 'application/json') {
    throw new RequestError(`Expected a JSON response (HTTP ${response.status})`, response.status)
  }
  const data: unknown = await response.json()
  return data as T
}

export async function requestText(path: string, options?: RequestOptions): Promise<string> {
  const response = await send(path, options)
  if (mediaType(response) !== 'text/plain') {
    throw new RequestError(`Expected a text response (HTTP ${response.status})`, response.status)
  }
  return response.text()
}
