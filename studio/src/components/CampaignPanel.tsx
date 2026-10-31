import { useRef, useState } from 'react'
import { uploadImage, viewUrl } from '../api/comfy'
import type { Campaign, CampaignProgress, ShotState } from '../hooks/useCampaign'
import { measure, type Job, type Picture } from '../hooks/useStudio'
import { FORMATS, STILL_MINUTES, campaignMinutes, type CampaignFormat, type Shot } from '../workflows/campaign'
import type { VideoLength } from '../workflows/video'

type Props = {
  campaign: Campaign
  progress: CampaignProgress
  job: Job
  online: boolean
  error: string | null
  onDismissError: () => void
  onProduct: (p: Picture | null) => void
  onText: (patch: Partial<Pick<Campaign, 'productText' | 'look'>>) => void
  onFormat: (f: CampaignFormat) => void
  onShot: (id: string, patch: Partial<Shot>) => void
  onAddShot: () => void
  onRemoveShot: (id: string) => void
  onMoveShot: (id: string, by: -1 | 1) => void
  onResetShots: () => void
  onCreateStills: () => void
  onMakeAd: () => void
  onStop: () => void
}

const LENGTHS: VideoLength[] = [5, 10, 15]

export function CampaignPanel(props: Props) {
  const { campaign: c, progress, job, online, error } = props
  const busy = progress !== null || job.state === 'running'
  const missingStills = c.shots.filter((s) => !s.still).length
  const totalSeconds = c.shots.reduce((sum, s) => sum + s.length, 0)
  const videoMinutes = campaignMinutes(c.shots)
  const ready = online && !busy && !!c.product && c.productText.trim().length > 0 && c.shots.length > 0

  return (
    <section className="campaign" aria-label="Make an ad from a product photo">
      <ProductPicker product={c.product} onProduct={props.onProduct} disabled={busy} />

      <label className="field">
        <span className="field-label">What is it?</span>
        <input
          type="text"
          className="text-input"
          value={c.productText}
          onChange={(e) => props.onText({ productText: e.target.value })}
          placeholder="olive green 2 litre water bottle with a black lid and cream latch"
          disabled={busy}
        />
        <span className="note">Name the colours and parts. Every shot uses this to keep the product the same.</span>
      </label>

      <label className="field">
        <span className="field-label">Brand look (optional)</span>
        <input
          type="text"
          className="text-input"
          value={c.look}
          onChange={(e) => props.onText({ look: e.target.value })}
          placeholder="fresh, sporty, bright natural light"
          disabled={busy}
        />
      </label>

      <div className="field">
        <span className="field-label">Format</span>
        <div className="video-shapes">
          {(Object.keys(FORMATS) as CampaignFormat[]).map((f) => (
            <button key={f} type="button" className="video-shape" aria-pressed={c.format === f} onClick={() => props.onFormat(f)} disabled={busy}>
              <span className="shape-glyph-box" aria-hidden="true">
                <span className="shape-glyph" style={f === 'portrait' ? { width: 17, height: 30 } : { width: 30, height: 17 }} />
              </span>
              <span className="video-shape-text">
                <span className="video-shape-name">{FORMATS[f].label}</span>
                <span className="video-shape-detail">{FORMATS[f].detail}</span>
              </span>
            </button>
          ))}
        </div>
        {c.shots.some((s) => s.still) && <span className="note">Changing the product or format starts the stills again.</span>}
      </div>

      <div className="field">
        <div className="shots-head">
          <span className="field-label">
            Shots ({c.shots.length}, {totalSeconds} s)
          </span>
          <button type="button" className="text-button" onClick={props.onResetShots} disabled={busy}>
            Use the 4-shot ad
          </button>
        </div>
        <ol className="shot-list">
          {c.shots.map((s, i) => (
            <ShotEditor
              key={s.id}
              shot={s}
              index={i}
              count={c.shots.length}
              active={progress?.shotId === s.id}
              disabled={busy}
              onShot={props.onShot}
              onRemove={props.onRemoveShot}
              onMove={props.onMoveShot}
            />
          ))}
        </ol>
        <button type="button" className="attach" onClick={props.onAddShot} disabled={busy}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Add a shot
        </button>
      </div>

      <div className="estimate">
        <div className="estimate-head">
          <span className="field-label">On this laptop</span>
        </div>
        <p className="estimate-time">
          Stills about {Math.max(1, missingStills * STILL_MINUTES)} min, video about {videoMinutes} min
        </p>
        <p className="note estimate-detail">
          Stills first, so you can check each shot before the long video step. Then every shot is animated and the clips are
          joined into one {totalSeconds} s ad without re-encoding.
        </p>
        <p className="warn">The GPU runs hot for the whole video step. Raise the laptop and close heavy apps.</p>
      </div>

      {busy && progress ? (
        <div className="campaign-progress" aria-live="polite">
          <p className="campaign-progress-title">
            {progress.phase === 'still'
              ? `Making still ${progress.index} of ${progress.total}`
              : progress.phase === 'clip'
                ? `Animating shot ${progress.index} of ${progress.total}`
                : 'Joining the shots into one video'}
          </p>
          <p className="note">
            {job.state === 'running' ? `${job.stage}${job.step > 0 ? `, step ${job.step} of ${job.steps}` : ''}` : 'Starting'}
          </p>
          <button type="button" className="action stop" onClick={props.onStop}>
            Stop
          </button>
        </div>
      ) : (
        <div className="action-dock">
          {missingStills > 0 ? (
            <button type="button" className="action" onClick={props.onCreateStills} disabled={!ready}>
              {missingStills === c.shots.length ? `Create ${c.shots.length} stills` : `Create ${missingStills} missing stills`}
            </button>
          ) : (
            <button type="button" className="action" onClick={props.onMakeAd} disabled={!ready}>
              Make the {totalSeconds} s ad video
            </button>
          )}
          <p className="hint">
            {!c.product
              ? 'Start with a clear photo of the product.'
              : !c.productText.trim()
                ? 'Describe the product in a few words.'
                : missingStills > 0
                  ? 'Check the stills on the right, redo any you don’t like, then make the video.'
                  : 'You can redo any still first; only changed shots are animated again.'}
          </p>
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={props.onDismissError}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  )
}

function ShotEditor(props: {
  shot: ShotState
  index: number
  count: number
  active: boolean
  disabled: boolean
  onShot: (id: string, patch: Partial<Shot>) => void
  onRemove: (id: string) => void
  onMove: (id: string, by: -1 | 1) => void
}) {
  const { shot: s, index, count, active, disabled, onShot, onRemove, onMove } = props
  return (
    <li className="shot" data-active={active || undefined}>
      <div className="shot-top">
        <span className="shot-number">{index + 1}</span>
        <input
          className="shot-title"
          value={s.title}
          onChange={(e) => onShot(s.id, { title: e.target.value })}
          aria-label={`Shot ${index + 1} name`}
          disabled={disabled}
        />
        <div className="segmented shot-length" role="radiogroup" aria-label={`Shot ${index + 1} length`}>
          {LENGTHS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={s.length === n} onClick={() => onShot(s.id, { length: n })} disabled={disabled}>
              {n} s
            </button>
          ))}
        </div>
      </div>
      <label className="shot-field">
        <span>Still: camera angle and setting</span>
        <textarea rows={2} value={s.scene} onChange={(e) => onShot(s.id, { scene: e.target.value })} disabled={disabled} />
      </label>
      <label className="shot-field">
        <span>Video: what moves (one slow camera move)</span>
        <textarea rows={2} value={s.motion} onChange={(e) => onShot(s.id, { motion: e.target.value })} disabled={disabled} />
      </label>
      <div className="shot-actions">
        <button type="button" className="text-button" onClick={() => onMove(s.id, -1)} disabled={disabled || index === 0}>
          Move up
        </button>
        <button type="button" className="text-button" onClick={() => onMove(s.id, 1)} disabled={disabled || index === count - 1}>
          Move down
        </button>
        <button type="button" className="text-button danger" onClick={() => onRemove(s.id)} disabled={disabled || count === 1}>
          Remove
        </button>
      </div>
    </li>
  )
}

function ProductPicker({ product, onProduct, disabled }: { product: Picture | null; onProduct: (p: Picture | null) => void; disabled: boolean }) {
  const picker = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<{ preview: string; status: 'uploading' | 'error'; message?: string } | null>(null)
  const [dragging, setDragging] = useState(false)

  const take = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    const preview = URL.createObjectURL(file)
    setState({ preview, status: 'uploading' })
    try {
      const [size, ref] = await Promise.all([measure(preview), uploadImage(file)])
      onProduct({ ...ref, ...size })
      setState(null)
    } catch (err) {
      setState({ preview, status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const shown = state?.preview ?? (product ? viewUrl(product) : null)

  return (
    <div
      className="product-picker"
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) void take(e.dataTransfer.files[0])
      }}
      onPaste={(e) => !disabled && void take(e.clipboardData.files[0])}
    >
      <span className="field-label">Product photo</span>
      {shown ? (
        <div className="product-card">
          <img src={shown} alt="Product" />
          <div className="product-card-text">
            <span className="note">
              {state?.status === 'uploading'
                ? 'Uploading…'
                : state?.status === 'error'
                  ? state.message
                  : 'Every shot is built from this photo.'}
            </span>
            <div className="shot-actions">
              <button type="button" className="text-button" onClick={() => picker.current?.click()} disabled={disabled}>
                Replace
              </button>
              <button type="button" className="text-button danger" onClick={() => onProduct(null)} disabled={disabled}>
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" className="product-drop" onClick={() => picker.current?.click()} disabled={disabled}>
          <span className="product-drop-title">Add a product photo</span>
          <span className="note">Drop it here, paste it, or click to choose. A clear, well lit photo works best.</span>
        </button>
      )}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void take(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
