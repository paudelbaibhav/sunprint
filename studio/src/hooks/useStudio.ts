import { useCallback, useEffect, useRef, useState } from 'react'
import { interrupt, isOnline, listen, queuePrompt, viewUrl, type ComfyEvent, type ImageRef, type Workflow } from '../api/comfy'
import type { EditSettings, MaskOperation } from '../workflows/editImage'
import type { T2ISettings } from '../workflows/textToImage'
import { SHAPES, type VideoSettings } from '../workflows/video'

// A picture with known pixel size: an upload, or anything ComfyUI produced.
export type Picture = ImageRef & { width: number; height: number }

type Made = { prompt: string; seed: number; seconds: number; createdAt: number }

// A video's own ImageRef is the MP4; lastFrame is its final frame as a PNG (thumbnail,
// and where "Continue this video" picks up). duration is the clip length in seconds.
export type VideoInfo = { settings: VideoSettings; duration: number; lastFrame: Picture; start?: Picture; extended?: boolean }

export type Creation = Picture &
  Made &
  (
    | { kind: 't2i'; settings: T2ISettings }
    | { kind: 'edit'; settings: EditSettings; sources: Picture[]; operation?: MaskOperation }
    | ({ kind: 'video' } & VideoInfo)
  )

// operation is set when only a painted area was changed (generative fill or heal).
export type RunRequest =
  | { kind: 't2i'; prompt: string; seed: number; settings: T2ISettings }
  | { kind: 'edit'; prompt: string; seed: number; settings: EditSettings; sources: Picture[]; operation?: MaskOperation }
  // knownLastFrame: for a job that doesn't render frames itself (joining finished clips).
  | ({ kind: 'video'; prompt: string; seed: number; knownLastFrame?: Picture } & Omit<VideoInfo, 'lastFrame'>)

export type Job =
  | { state: 'idle' }
  | { state: 'running'; kind: RunRequest['kind']; stage: string; step: number; steps: number; startedAt: number }
  | { state: 'error'; message: string }

const HISTORY_KEY = 'sunprint.history'
const OLD_T2I_HISTORY_KEY = 'sunprint.t2i.history'
const HISTORY_MAX = 80

function loadHistory(): Creation[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    if (stored) return JSON.parse(stored)
    // Entries from before editing existed are all text-to-image.
    const old = JSON.parse(localStorage.getItem(OLD_T2I_HISTORY_KEY) ?? '[]') as Omit<Creation, 'kind'>[]
    return old.map((c) => ({ ...c, kind: 't2i' }) as Creation)
  } catch {
    return []
  }
}

function saveHistory(items: Creation[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)))
  } catch {
    // storage full or blocked: history just won't survive a reload
  }
}

export function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read the image.'))
    img.src = url
  })
}

// Outputs are collected while the job runs and turned into history entries when it succeeds.
type Pending = RunRequest & {
  id: string
  stages: Record<string, string>
  startedAt: number
  images?: ImageRef[]
  lastFrame?: ImageRef
  resolve: (made: Creation[]) => void
  reject: (err: Error) => void
}

const RESULT_NODES = new Set(['save', 'join'])

export function useStudio() {
  const [online, setOnline] = useState<boolean | null>(null)
  const [job, setJob] = useState<Job>({ state: 'idle' })
  const [history, setHistory] = useState<Creation[]>(loadHistory)
  const [current, setCurrent] = useState<Creation | null>(() => loadHistory()[0] ?? null)

  // The job we are waiting for; events for any other prompt are ignored.
  const pending = useRef<Pending | null>(null)

  useEffect(() => {
    let alive = true
    const check = async () => {
      const ok = await isOnline()
      if (alive) setOnline(ok)
    }
    check()
    const t = window.setInterval(check, 4000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  const addResults = useCallback(async (p: Pending): Promise<Creation[]> => {
    const images = p.images ?? []
    if (!images.length) return []
    const seconds = Math.round((Date.now() - p.startedAt) / 1000)
    const base = { prompt: p.prompt, seed: p.seed, seconds, createdAt: Date.now() }
    let made: Creation[]
    if (p.kind === 'video') {
      const size = { width: SHAPES[p.settings.shape].width, height: SHAPES[p.settings.shape].height }
      const lastFrame = p.lastFrame ? { ...p.lastFrame, ...size } : (p.knownLastFrame ?? { ...images[0], ...size })
      made = images.map((clip) => ({
        ...clip,
        ...size,
        ...base,
        kind: 'video' as const,
        settings: p.settings,
        duration: p.duration,
        lastFrame,
        start: p.start,
        extended: p.extended,
      }))
    } else {
      made = await Promise.all(
        images.map(async (img) => {
          // Text-to-image size is known up front; an edit follows image 1's shape.
          const size =
            p.kind === 't2i'
              ? { width: p.settings.width, height: p.settings.height }
              : await measure(viewUrl(img)).catch(() => ({ width: p.sources[0].width, height: p.sources[0].height }))
          const entry = { ...img, ...size, ...base }
          return p.kind === 't2i'
            ? { ...entry, kind: 't2i' as const, settings: p.settings }
            : { ...entry, kind: 'edit' as const, settings: p.settings, sources: p.sources, operation: p.operation }
        }),
      )
    }
    setCurrent(made[0])
    setHistory((h) => {
      const next = [...made, ...h]
      saveHistory(next)
      return next
    })
    return made
  }, [])

  // Events that arrive before run() knows its prompt id (a very short job can finish before
  // the /prompt reply lands) are kept briefly and replayed once the id is known.
  const early = useRef<ComfyEvent[]>([])
  const handle = useRef<(e: ComfyEvent) => void>(() => {})

  useEffect(() => {
    handle.current = (e: ComfyEvent) => {
      const p = pending.current
      if (!p || e.prompt_id !== p.id) {
        early.current = [...early.current.slice(-100), e]
        return
      }

      switch (e.type) {
        case 'executing':
          if (e.node && p.stages[e.node])
            setJob((j) => (j.state === 'running' ? { ...j, stage: p.stages[e.node!] } : j))
          break
        case 'progress':
          if (e.node === 'sampler')
            setJob((j) => (j.state === 'running' ? { ...j, stage: p.stages.sampler, step: e.value, steps: e.max } : j))
          break
        case 'executed':
          if (RESULT_NODES.has(e.node) && e.output.images?.length) p.images = e.output.images
          if (e.node === 'lastframe' && e.output.images?.length) p.lastFrame = e.output.images[0]
          break
        case 'execution_success':
          pending.current = null
          setJob({ state: 'idle' })
          addResults(p).then(p.resolve, p.reject)
          break
        case 'execution_interrupted':
          pending.current = null
          setJob({ state: 'idle' })
          p.reject(new Error('Stopped.'))
          break
        case 'execution_error': {
          pending.current = null
          const message = `${e.node_type} failed: ${e.exception_message.trim()}`
          setJob({ state: 'error', message })
          p.reject(new Error(message))
          break
        }
      }
    }
    return listen((e) => handle.current(e))
  }, [addResults])

  // Resolves with the new history entries when the job succeeds; rejects when it fails or is
  // stopped. Callers that don't need the result can ignore the promise.
  const run = useCallback((request: RunRequest, workflow: Workflow, stages: Record<string, string>) => {
    const startedAt = Date.now()
    setJob({ state: 'running', kind: request.kind, stage: 'Waiting for ComfyUI', step: 0, steps: request.settings.steps, startedAt })
    const done = new Promise<Creation[]>((resolve, reject) => {
      queuePrompt(workflow).then(
        (id) => {
          pending.current = { ...request, id, stages, startedAt, resolve, reject }
          const missed = early.current.filter((e) => e.prompt_id === id)
          early.current = []
          missed.forEach((e) => handle.current(e))
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          setJob({ state: 'error', message })
          reject(new Error(message))
        },
      )
    })
    done.catch(() => {}) // failures are already shown through `job`
    return done
  }, [])

  const stop = useCallback(() => {
    void interrupt()
  }, [])

  const dismissError = useCallback(() => setJob({ state: 'idle' }), [])

  return { online, job, history, current, setCurrent, run, stop, dismissError }
}
