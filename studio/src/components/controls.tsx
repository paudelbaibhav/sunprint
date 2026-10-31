import { useEffect, useState, type ReactNode } from 'react'
import { samplerOptions } from '../api/comfy'

// Controls shared by the create and edit settings panels.

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  note?: string
}) {
  const { label, value, min, max, step, onChange, note } = props
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <div className="field slider">
      <label className="slider-head">
        <span className="field-label">{label}</span>
        <input
          type="number"
          className="slider-number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => e.target.value !== '' && onChange(clamp(Number(e.target.value)))}
        />
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      {note && <p className="note">{note}</p>}
    </div>
  )
}

export function Choice<T extends string | number>(props: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  note?: ReactNode
}) {
  const { label, options, value, onChange, note } = props
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {note && <p className="note">{note}</p>}
    </div>
  )
}

export function SamplerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { samplers } = useSamplerOptions()
  return <OptionSelect label="Sampler" value={value} options={samplers} onChange={onChange} />
}

export function SchedulerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { schedulers } = useSamplerOptions()
  return <OptionSelect label="Scheduler" value={value} options={schedulers} onChange={onChange} />
}

function OptionSelect(props: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const { label, value, options, onChange } = props
  const list = options.includes(value) ? options : [value, ...options]
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

// Loaded once from ComfyUI and shared by every select on the page.
let cached: Promise<{ samplers: string[]; schedulers: string[] }> | null = null

function useSamplerOptions() {
  const [options, setOptions] = useState<{ samplers: string[]; schedulers: string[] }>({ samplers: [], schedulers: [] })
  useEffect(() => {
    let alive = true
    const load = () => {
      cached ??= samplerOptions()
      cached
        .then((o) => alive && setOptions(o))
        .catch(() => {
          cached = null // backend still starting: try again shortly
          if (alive) window.setTimeout(load, 4000)
        })
    }
    load()
    return () => {
      alive = false
    }
  }, [])
  return options
}

export function FineTune(props: { storageKey: string; state: string; children: ReactNode }) {
  const { storageKey, state, children } = props
  const [open, setOpen] = useState(() => localStorage.getItem(storageKey) === '1')
  return (
    <details
      className="fine-tune"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open
        setOpen(next)
        localStorage.setItem(storageKey, next ? '1' : '0')
      }}
    >
      <summary>
        Fine-tune
        <span className="summary-state">{state}</span>
      </summary>
      <div className="fine-tune-body">{children}</div>
    </details>
  )
}

export function GuidanceControls(props: {
  cfg: number
  negative: string
  min: number
  max: number
  step: number
  onCfg: (v: number) => void
  onNegative: (v: string) => void
}) {
  const { cfg, negative, onCfg, onNegative } = props
  return (
    <>
      <Slider
        label="Guidance"
        value={cfg}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={onCfg}
        note={
          cfg > 1
            ? 'Above 1 every step runs twice, so it takes about twice as long.'
            : 'At 1 the model follows its own tuning and ignores the negative prompt.'
        }
      />
      <label className="field">
        <span className="field-label">Avoid in the image</span>
        <textarea
          className="negative"
          rows={2}
          value={negative}
          onChange={(e) => onNegative(e.target.value)}
          placeholder={cfg > 1 ? 'blurry, watermark, extra fingers' : 'Raise guidance above 1 to use this'}
          disabled={cfg <= 1}
        />
      </label>
    </>
  )
}

export function PrefixInput(props: { value: string; fallback: string; onChange: (v: string) => void; folders?: boolean }) {
  const { value, fallback, onChange, folders } = props
  const clean = (v: string) => (folders ? v.replace(/[^\w/-]/g, '').replace(/\/{2,}/g, '/').replace(/^\//, '') : v.replace(/[^\w-]/g, ''))
  return (
    <label className="field">
      <span className="field-label">File name starts with</span>
      <input type="text" value={value} onChange={(e) => onChange(clean(e.target.value))} placeholder={fallback} />
    </label>
  )
}
