import type { Dispatch, SetStateAction } from 'react'
import {
  ESTIMATES,
  SHAPES,
  VIDEO_RECOMMENDED,
  WINDOW_FRAMES,
  frameCount,
  windowCount,
  type VideoLength,
  type VideoSettings,
  type VideoShape,
} from '../workflows/video'
import { Choice, FineTune, PrefixInput, SamplerSelect, SchedulerSelect, Slider } from './controls'

type Props = {
  settings: VideoSettings
  onChange: Dispatch<SetStateAction<VideoSettings>>
  continuingFrom: number | null // length of the video being continued, in seconds
  disabled: boolean
}

const LENGTH_VALUES = [5, 10, 15] as VideoLength[]
const LENGTHS = LENGTH_VALUES.map((n) => ({ value: n, label: `${n} s` }))
const ADDS = LENGTH_VALUES.map((n) => ({ value: n, label: `+${n} s` }))

export function VideoSettingsPanel({ settings: s, onChange, continuingFrom, disabled }: Props) {
  const continuing = continuingFrom !== null
  const set = <K extends keyof VideoSettings>(key: K, value: VideoSettings[K]) => onChange((prev) => ({ ...prev, [key]: value }))
  const isRecommended = (Object.keys(VIDEO_RECOMMENDED) as (keyof typeof VIDEO_RECOMMENDED)[]).every(
    (k) => s[k] === VIDEO_RECOMMENDED[k],
  )
  const estimate = ESTIMATES[s.length]
  const windows = windowCount(frameCount(s.length), s.overlap)

  return (
    <fieldset className="settings" disabled={disabled}>
      <legend className="visually-hidden">Video settings</legend>

      {continuing && (
        <p className="mode-note">
          Continues your {continuingFrom} s video from its last frame and joins the new part on, making one{' '}
          {continuingFrom + s.length} s video. You can keep continuing as long as you like.
        </p>
      )}

      <Choice
        label={continuing ? 'Add' : 'Length'}
        options={continuing ? ADDS : LENGTHS}
        value={s.length}
        onChange={(v) => set('length', v)}
        note={
          continuing
            ? 'Long chains slowly drift in colour and detail. Describe the same subject and setting each time to keep them consistent.'
            : undefined
        }
      />

      <div className="field">
        <span className="field-label">Shape</span>
        <div className="video-shapes">
          {(Object.keys(SHAPES) as VideoShape[]).map((id) => {
            const shape = SHAPES[id]
            const long = Math.max(shape.width, shape.height)
            return (
              <button
                key={id}
                type="button"
                className="video-shape"
                aria-pressed={s.shape === id}
                onClick={() => set('shape', id)}
                disabled={continuing && s.shape !== id}
              >
                <span className="shape-glyph-box" aria-hidden="true">
                  <span className="shape-glyph" style={{ width: (30 * shape.width) / long, height: (30 * shape.height) / long }} />
                </span>
                <span className="video-shape-text">
                  <span className="video-shape-name">{shape.label}</span>
                  <span className="video-shape-detail">{shape.detail}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="estimate">
        <div className="estimate-head">
          <span className="field-label">On this laptop</span>
          <span className="note">{estimate.measured ? 'Measured' : 'Estimated'}</span>
        </div>
        <p className="estimate-time">About {estimate.minutes} minutes</p>
        <p className="note estimate-detail">
          {continuing
            ? `Making the new ${s.length} s part takes about as long as a new ${s.length} s clip; joining it on adds only seconds.`
            : estimate.detail}
        </p>
        <p className="warn">
          The GPU runs near 87 °C for the whole render. Raise the laptop or use a cooling pad, and close heavy apps: memory
          gets tight.
        </p>
      </div>

      <FineTune storageKey="sunprint.video.fineTuneOpen" state={isRecommended ? 'Recommended for video' : 'Custom'}>
        <Slider
          label="Steps"
          value={s.steps}
          min={1}
          max={20}
          step={1}
          onChange={(v) => set('steps', v)}
          note="The Turbo model is tuned for 4. Each extra step adds about a quarter to the generating time."
        />
        <div className="pair">
          <SamplerSelect value={s.sampler} onChange={(v) => set('sampler', v)} />
          <SchedulerSelect value={s.scheduler} onChange={(v) => set('scheduler', v)} />
        </div>
        <Slider
          label="Shift"
          value={s.shift}
          min={1}
          max={16}
          step={0.5}
          onChange={(v) => set('shift', v)}
          note="Higher shift favours big, stable motion; lower keeps more fine detail."
        />
        <Slider
          label="Window overlap (frames)"
          value={s.overlap}
          min={8}
          max={60}
          step={1}
          onChange={(v) => set('overlap', v)}
          note={`Longer clips are made in ${WINDOW_FRAMES}-frame windows; this ${s.length} s clip uses ${windows}. More overlap blends better but takes longer.`}
        />
        <PrefixInput value={s.prefix} fallback="video/seg" folders onChange={(v) => set('prefix', v)} />
        <button
          type="button"
          className="text-button"
          onClick={() => onChange((prev) => ({ ...prev, ...VIDEO_RECOMMENDED }))}
          disabled={isRecommended}
        >
          Reset to recommended for video
        </button>
      </FineTune>
    </fieldset>
  )
}
