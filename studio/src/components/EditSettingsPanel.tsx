import type { Dispatch, SetStateAction } from 'react'
import { LIMITS } from '../workflows/textToImage'
import { DETAIL_OPTIONS, EDIT_RECOMMENDED, type EditSettings } from '../workflows/editImage'
import { Choice, FineTune, GuidanceControls, PrefixInput, SamplerSelect, Slider } from './controls'

type Props = {
  settings: EditSettings
  onChange: Dispatch<SetStateAction<EditSettings>>
  references: number
  masked: boolean
  disabled: boolean
}

const BATCH_OPTIONS = [1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))

export function EditSettingsPanel({ settings: s, onChange, references, masked, disabled }: Props) {
  const set = <K extends keyof EditSettings>(key: K, value: EditSettings[K]) => onChange((prev) => ({ ...prev, [key]: value }))
  const isRecommended = (Object.keys(EDIT_RECOMMENDED) as (keyof typeof EDIT_RECOMMENDED)[]).every(
    (k) => s[k] === EDIT_RECOMMENDED[k],
  )

  return (
    <fieldset className="settings" disabled={disabled}>
      <legend className="visually-hidden">Edit settings</legend>

      <p className="mode-note">
        {masked
          ? 'Only the area you painted changes; every other pixel stays exactly as it is. Generate fills it with what you describe, Remove erases it and fills in the background.'
          : `Editing with FLUX.2 Klein. The result keeps the shape of image 1${references > 1 ? '; refer to your pictures as image 1 and image 2.' : '.'}`}
      </p>

      <Choice
        label="Detail"
        options={DETAIL_OPTIONS.map((d) => ({ value: d.megapixels, label: `${d.label} ${d.megapixels} MP` }))}
        value={s.megapixels}
        onChange={(v) => set('megapixels', v)}
        note={s.megapixels > 1 ? 'High detail is slower and uses more memory on this laptop.' : undefined}
      />

      <Choice
        label="Images per run"
        options={BATCH_OPTIONS}
        value={s.batch}
        onChange={(v) => set('batch', v)}
        note={s.batch > 1 ? `You get ${s.batch} different takes on the edit. Each extra image adds roughly the same time again.` : undefined}
      />

      <FineTune storageKey="sunprint.edit.fineTuneOpen" state={isRecommended ? 'Recommended for editing' : 'Custom'}>
        <Slider
          label="Steps"
          value={s.steps}
          min={LIMITS.steps.min}
          max={LIMITS.steps.max}
          step={1}
          onChange={(v) => set('steps', v)}
          note={`More steps take longer. Klein is tuned for ${EDIT_RECOMMENDED.steps}.`}
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
        <SamplerSelect value={s.sampler} onChange={(v) => set('sampler', v)} />
        {masked && (
          <>
            <Slider
              label="Widen selection (px)"
              value={s.grow}
              min={0}
              max={48}
              step={1}
              onChange={(v) => set('grow', v)}
              note="Grows the painted area a little so edges of the old object don't show."
            />
            <Slider
              label="Soft edge (px)"
              value={s.feather}
              min={0}
              max={32}
              step={1}
              onChange={(v) => set('feather', v)}
              note="How gradually the new part blends into the original. 0 is a hard edge."
            />
          </>
        )}
        {references > 1 && (
          <Slider
            label="Image 2 detail (MP)"
            value={s.ref2Megapixels}
            min={0.25}
            max={1}
            step={0.05}
            onChange={(v) => set('ref2Megapixels', v)}
            note="Image 2 is only a reference, so it's read at lower detail to save memory."
          />
        )}
        <PrefixInput value={s.prefix} fallback="edit" onChange={(v) => set('prefix', v)} />
        <button
          type="button"
          className="text-button"
          onClick={() => onChange((prev) => ({ ...prev, ...EDIT_RECOMMENDED }))}
          disabled={isRecommended}
        >
          Reset to recommended for editing
        </button>
      </FineTune>
    </fieldset>
  )
}
