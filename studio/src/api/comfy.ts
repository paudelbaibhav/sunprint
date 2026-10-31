// Thin client for the ComfyUI HTTP + websocket API (proxied under /api by Vite).

export type ImageRef = { filename: string; subfolder: string; type: string }

export type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>

export type ComfyEvent =
  | { type: 'execution_start'; prompt_id: string }
  | { type: 'executing'; prompt_id: string; node: string | null }
  | { type: 'progress'; prompt_id: string; node: string; value: number; max: number }
  | { type: 'executed'; prompt_id: string; node: string; output: { images?: ImageRef[] } }
  | { type: 'execution_success'; prompt_id: string }
  | { type: 'execution_error'; prompt_id: string; node_type: string; exception_message: string }
  | { type: 'execution_interrupted'; prompt_id: string }

export const clientId = crypto.randomUUID()

export async function isOnline(): Promise<boolean> {
  try {
    const res = await fetch('/api/system_stats', { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

// Combo options come either as [list, opts] (legacy) or ['COMBO', { options }] (v3 nodes).
function comboOptions(spec: unknown): string[] {
  if (!Array.isArray(spec)) return []
  if (Array.isArray(spec[0])) return spec[0] as string[]
  return ((spec[1] as { options?: string[] } | undefined)?.options ?? []) as string[]
}

export async function samplerOptions(): Promise<{ samplers: string[]; schedulers: string[] }> {
  const res = await fetch('/api/object_info/KSampler')
  if (!res.ok) throw new Error(`object_info failed (HTTP ${res.status})`)
  const required = (await res.json()).KSampler.input.required
  return { samplers: comboOptions(required.sampler_name), schedulers: comboOptions(required.scheduler) }
}

// Custom nodes only load when ComfyUI starts; this tells whether one is available.
export async function hasNode(name: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/object_info/${name}`)
    return res.ok && name in (await res.json())
  } catch {
    return false
  }
}

type NodeErrors = Record<string, { class_type: string; errors: { message: string; details: string }[] }>

export async function queuePrompt(prompt: Workflow): Promise<string> {
  const res = await fetch('/api/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: clientId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const nodeErrors = Object.values((body.node_errors ?? {}) as NodeErrors)
      .flatMap((n) => n.errors.map((e) => `${n.class_type}: ${e.details || e.message}`))
    throw new Error(nodeErrors[0] ?? body.error?.message ?? `ComfyUI refused the job (HTTP ${res.status}).`)
  }
  return body.prompt_id as string
}

// Stores the file in ComfyUI's input folder. ComfyUI renames on clashes and
// reuses an existing file when the content is identical.
export async function uploadImage(file: File, opts: { overwrite?: boolean } = {}): Promise<ImageRef> {
  const form = new FormData()
  form.append('image', file)
  form.append('type', 'input')
  if (opts.overwrite) form.append('overwrite', 'true')
  const res = await fetch('/api/upload/image', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Couldn't upload ${file.name} (HTTP ${res.status}).`)
  const body = await res.json()
  return { filename: body.name, subfolder: body.subfolder ?? '', type: body.type ?? 'input' }
}

// Value for a LoadImage node: input files by name, other folders annotated ("x.png [output]").
export function loadImageName(img: ImageRef): string {
  const path = img.subfolder ? `${img.subfolder}/${img.filename}` : img.filename
  return img.type === 'input' ? path : `${path} [${img.type}]`
}

export async function interrupt(): Promise<void> {
  await fetch('/api/interrupt', { method: 'POST' })
}

export function viewUrl(img: ImageRef): string {
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type })
  return `/api/view?${q}`
}

// Keeps one websocket open and reconnects when ComfyUI restarts.
export function listen(onEvent: (e: ComfyEvent) => void): () => void {
  let ws: WebSocket | null = null
  let retry: number | undefined
  let closed = false

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/ws?clientId=${clientId}`)
    ws.onmessage = (msg) => {
      if (typeof msg.data !== 'string') return // binary live-preview frames
      const { type, data } = JSON.parse(msg.data)
      onEvent({ type, ...data } as ComfyEvent)
    }
    ws.onclose = () => {
      if (!closed) retry = window.setTimeout(open, 2000)
    }
  }

  open()
  return () => {
    closed = true
    window.clearTimeout(retry)
    ws?.close()
  }
}
