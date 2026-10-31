import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  COMFORTABLE_PIXELS,
  LIMITS,
  MODELS,
  SHAPES,
  snapToStep,
  type ModelId,
  type T2ISettings,
} from '../workflows/textToImage'
import { Choice, FineTune, GuidanceControls, PrefixInput, SamplerSelect, SchedulerSelect, Slider } from './controls'

type Props = {
  settings: T2ISettings
  onChange: Dispatch<SetStateAction<T2ISettings>>
  disabled: boolean
}

const BATCH_OPTIONS = [1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))

export function T2ISettingsPanel({ settings: s, onChange, disabled }: Props) {
  const set = <K extends keyof T2ISettings>(key: K, value: T2ISettings[K]) => onChange((prev) => ({ ...prev, [key]: value }))

  const model = MODELS[s.model]
  const megapixels = (s.width * s.height) / 1e6
  const rec = model.recommended
  const isRecommended =
    s.steps === rec.steps &&
    s.cfg === rec.cfg &&
    s.sampler === rec.sampler &&
    (s.model === 'klein' || (s.scheduler === rec.scheduler && s.shift === rec.shift))

  const chooseModel = (id: ModelId) => {
    if (id !== s.model) onChange((prev) => ({ ...prev, model: id, ...MODELS[id].recommended }))
  }

  return (
    <fieldset className="settings" disabled={disabled}>
      <legend className="visually-hidden">Image settings</legend>

      <div className="field">
        <span className="field-label" id="model-label">
          Model
        </span>
        <div className="models" role="radiogroup" aria-labelledby="model-label">
          {Object.values(MODELS).map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={s.model === m.id}
              className="model"
              onClick={() => chooseModel(m.id)}
            >
              <span className="model-name">{m.name}</span>
              <span className="model-blurb">{m.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Shape</span>
        <div className="shape-row">
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              type="button"
              className="shape"
              aria-pressed={s.width === shape.width && s.height === shape.height}
              onClick={() => onChange((prev) => ({ ...prev, width: shape.width, height: shape.height }))}
            >
              <span className="shape-glyph-box" aria-hidden="true">
                <span
                  className="shape-glyph"
                  style={{
                    width: (30 * shape.width) / Math.max(shape.width, shape.height),
                    height: (30 * shape.height) / Math.max(shape.width, shape.height),
                  }}
                />
              </span>
              <span className="shape-name">{shape.label}</span>
            </button>
          ))}
        </div>

        <div className="size-row">
          <SizeInput label="Width" value={s.width} onCommit={(v) => set('width', v)} />
          <button
            type="button"
            className="swap"
            onClick={() => onChange((prev) => ({ ...prev, width: prev.height, height: prev.width }))}
            aria-label="Swap width and height"
            title="Swap width and height"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M5 7h11l-3-3M15 13H4l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <SizeInput label="Height" value={s.height} onCommit={(v) => set('height', v)} />
          <span className="megapixels">{megapixels.toFixed(2)} MP</span>
        </div>
        {s.width * s.height > COMFORTABLE_PIXELS && (
          <p className="warn">Above about 1.5 MP this laptop gets slow and may run out of memory.</p>
        )}
      </div>

      <Choice
        label="Images per run"
        options={BATCH_OPTIONS}
        value={s.batch}
        onChange={(v) => set('batch', v)}
        note={s.batch > 1 ? `You get ${s.batch} different variations. Each extra image adds roughly the same time again.` : undefined}
      />

      <FineTune storageKey="sunprint.t2i.fineTuneOpen" state={isRecommended ? `Recommended for ${model.name}` : 'Custom'}>
        <Slider
          label="Steps"
          value={s.steps}
          min={LIMITS.steps.min}
          max={LIMITS.steps.max}
          step={1}
          onChange={(v) => set('steps', v)}
          note={`More steps take longer. ${model.name} is tuned for ${rec.steps}.`}
        />
        <GuidanceControls
          cfg={s.cfg}
          negative={s.negative}
          min={LIMITS.cfg.min}
          max={LIMITS.cfg.max}
          step={LIMITS.cfg.step}
          onCfg={(v) => set('cfg', v)}
          onNegative={(v) => set('negative', v)}
        />
        <div className="pair">
          <SamplerSelect value={s.sampler} onChange={(v) => set('sampler', v)} />
          {s.model === 'zimage' && <SchedulerSelect value={s.scheduler} onChange={(v) => set('scheduler', v)} />}
        </div>
        {s.model === 'zimage' && (
          <Slider
            label="Shift"
            value={s.shift}
            min={LIMITS.shift.min}
            max={LIMITS.shift.max}
            step={LIMITS.shift.step}
            onChange={(v) => set('shift', v)}
            note="Higher shift spends more steps on overall layout, lower on fine detail."
          />
        )}
        <PrefixInput value={s.prefix} fallback="t2i" onChange={(v) => set('prefix', v)} />
        <button
          type="button"
          className="text-button"
          onClick={() => onChange((prev) => ({ ...prev, ...rec }))}
          disabled={isRecommended}
        >
          Reset to recommended for {model.name}
        </button>
      </FineTune>
    </fieldset>
  )
}

function SizeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  // Follow outside changes (shape buttons, swap) without an effect.
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setDraft(String(value))
  }
  const commit = () => {
    const snapped = snapToStep(Number(draft) || value)
    setDraft(String(snapped))
    if (snapped !== value) onCommit(snapped)
  }
  return (
    <label className="size-input">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={LIMITS.size.min}
        max={LIMITS.size.max}
        step={LIMITS.size.step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  )
}
