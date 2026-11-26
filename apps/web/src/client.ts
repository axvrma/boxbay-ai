import { useMutation } from '@tanstack/react-query'
import { create } from 'zustand'
import type { Job } from './model'

const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export const useSession = create<{token: string; setToken: (token: string) => void}>((set) => ({
  token: sessionStorage.getItem('boxbay-token') ?? '',
  setToken: (token) => {
    if (token) sessionStorage.setItem('boxbay-token', token)
    else sessionStorage.removeItem('boxbay-token')
    set({ token })
  },
}))

export async function getEvidence<T>(name: string): Promise<T> {
  const result = await fetch(`${import.meta.env.BASE_URL}evidence/${name}.json`)
  if (!result.ok || !result.headers.get('Content-Type')?.includes('json')) throw new Error('Recorded evidence is unavailable.')
  return result.json()
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useSession.getState().token
  const result = await fetch(`${base}/api/v1${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(24_000),
  })
  const json = result.headers.get('Content-Type')?.includes('json') ? await result.json() : undefined
  if (!result.ok || !json) {
    const field = json?.error?.fields?.[0]
    throw new Error(field ? `${field.path} · ${field.message}`
      : (json?.error?.message ?? 'The AI engine is unavailable. Recorded replay is still available.'))
  }
  return json
}

export async function wake() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await api<{ operator_access: boolean }>('/health') }
    catch (error) {
      if (attempt === 2) throw error
      await new Promise((resolve) => window.setTimeout(resolve, 650 * 2 ** attempt))
    }
  }
  throw new Error('The AI engine could not be reached.')
}

export function useJob<T>(onDone: (output: T) => void) {
  const store = useJobState
  return useMutation({
    mutationFn: async (input: {path: string; payload: object; result: string}) => {
      store.setState({ status: 'Starting AI engine…', id: '' })
      try {
        await wake()
        let job = await api<Job>(input.path, {
          method: 'POST', body: JSON.stringify(input.payload), headers: { 'Idempotency-Key': crypto.randomUUID() },
        })
        store.setState({ id: job.id, status: 'Running simulation…' })
        for (let i = 0; i < 120 && ['queued', 'running'].includes(job.status); i += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, i < 5 ? 400 : 1000))
          job = await api<Job>(`/jobs/${job.id}`)
        }
        if (job.status !== 'complete') throw new Error(job.message ?? `Experiment ${job.status}.`)
        return await api<T>(`${input.result}/${job.id}`)
      } finally {
        store.setState({ status: '', id: '' })
      }
    },
    onSuccess: onDone,
  })
}

export const useJobState = create<{status: string; id: string}>(() => ({ status: '', id: '' }))
export const cancelJob = (id: string) => api<Job>(`/jobs/${id}`, { method: 'DELETE' })

export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
