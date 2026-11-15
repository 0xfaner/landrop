import { api, requestJson, requestNoContent } from '../api/http'

export interface Session {
  host: boolean
  authorized: boolean
  maxFileBytes: number
  deviceName?: string
}

export interface PairRequest {
  code: string
  token: string
}

type PairStatus =
  | { status: 'approved'; session: Session }
  | { status: 'pending' | 'rejected' | 'expired' }

interface Device {
  code: string
  name: string
  address: string
  status: 'pending' | 'approved'
}

export type DeviceAction = 'approve' | 'reject' | 'remove'

export function readSession(signal: AbortSignal) {
  return requestJson<Session>('/session', { signal })
}

export function signInHost(token: string, signal: AbortSignal) {
  return requestJson<Session>('/admin/login', { method: 'POST', token, signal })
}

export function requestPair(name: string) {
  return requestJson<PairRequest>('/pair', { method: 'POST', body: JSON.stringify({ name }) })
}

export function pairStatus(token: string, signal: AbortSignal) {
  return requestJson<PairStatus>('/pair/status', { method: 'POST', token, signal })
}

export function listDevices(signal?: AbortSignal) {
  return requestJson<Device[]>('/admin/devices', { signal })
}

export function decideDevice(code: string, action: DeviceAction) {
  return requestNoContent(`/admin/devices/${code}/${action}`, { method: 'POST' })
}

export function readAddresses(signal: AbortSignal) {
  return requestJson<string[]>('/admin/addresses', { signal })
}

export function qrURL(index: number) {
  return `${api}/admin/qr/${index}`
}
