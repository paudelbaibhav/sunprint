import { useEffect, useState, type RefObject } from 'react'
import type { Job } from '../hooks/useStudio'

// The film edge that marks a video frame (and a video being made) apart from a still print.
export function Perforations({ width, height }: { width: number; height: number }) {
  return (
    <div className="perforations" aria-hidden="true">
      {Array.from({ length: width >= height ? 24 : 9 }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  )
}

const PHASES = ['Loading the video model', 'Generating motion', 'Turning it into frames', 'Saving the MP4']

function phaseIndex(stage: string): number {
  if (stage === 'Generating motion') return 1
  if (stage === 'Turning it into frames') return 2
  if (stage.startsWith('Saving') || stage === 'Joining the clips') return 3
  return 0
}

function useElapsed(startedAt: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return Math.max(0, now - startedAt)
}

type ProgressProps = {
  job: Extract<Job, { state: 'running' }>
  prompt: string
  summary: string
  estimateMinutes: number
  notify: boolean
  onNotify: () => void
  onStop: () => void
}

// Left column while a video renders: where it is, how long is left, and how to leave it running.
export function VideoProgress({ job, prompt, summary, estimateMinutes, notify, onNotify, onStop }: ProgressProps) {
  const elapsedMs = useElapsed(job.startedAt)
  const minutes = Math.floor(elapsedMs / 60000)
  const left = Math.round(estimateMinutes - elapsedMs / 60000)
  const current = phaseIndex(job.stage)
  const phases = job.stage === 'Joining the clips' ? [...PHASES.slice(0, 3), 'Joining the clips'] : PHASES

  return (
    <section className="video-progress" aria-label="Video progress" aria-live="polite">
      <div className="video-progress-head">
        <span className="field-label">Making your video</span>
        <p className="video-progress-prompt">{prompt}</p>
        <p className="note">{summary}</p>
      </div>

      <div>
        <p className="video-progress-left">{left >= 1 ? `About ${left} min left` : 'Almost done'}</p>
        <p className="note">
          {minutes} min elapsed of about {estimateMinutes}
        </p>
      </div>

      <ol className="phases">
        {phases.map((label, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'waiting'
          const detail =
            state === 'done'
              ? 'done'
              : i === 1 && state === 'active' && job.step > 0
                ? `step ${job.step} of ${job.steps}`
                : state === 'active'
                  ? 'working'
                  : ''
          return (
            <li key={label} className="phase" data-state={state}>
              <span className="phase-dot" />
              <span className="phase-label">{label}</span>
              <span className="phase-detail">{detail}</span>
              {i === 1 && state === 'active' && job.steps > 0 && (
                <span className="phase-bar">
                  <span style={{ width: `${(job.step / job.steps) * 100}%` }} />
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <div className="video-progress-actions">
        <button type="button" className="action stop" onClick={onStop}>
          Stop
        </button>
        <button type="button" className="notify" aria-pressed={notify} onClick={onNotify}>
          {notify ? 'We’ll notify you' : 'Notify me when done'}
        </button>
      </div>
    </section>
  )
}

type PrintProps = {
  src: string
  width: number
  height: number
  videoRef: RefObject<HTMLVideoElement | null>
  label: string
}

// A finished clip in the film frame, with simple play / seek controls.
export function VideoPrint({ src, width, height, videoRef, label }: PrintProps) {
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

  return (
    <figure className="print film" style={{ aspectRatio: 'auto', ['--ratio' as string]: width / height }}>
      <Perforations width={width} height={height} />
      <div className="print-surface" style={{ aspectRatio: `${width} / ${height}` }}>
        <video
          key={src}
          ref={videoRef}
          className="print-video"
          src={src}
          aria-label={label}
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration)
            setTime(0)
          }}
          onClick={toggle}
        />
        {!playing && (
          <button type="button" className="big-play" onClick={toggle} aria-label="Play">
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
      <div className="player-bar">
        <button type="button" className="player-toggle" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d={playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z'} fill="currentColor" />
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1 / 24}
          value={time}
          onChange={(e) => {
            const v = videoRef.current
            if (v) v.currentTime = Number(e.target.value)
          }}
          aria-label="Position in the video"
        />
        <span className="player-time">
          {clock(time)} / {clock(duration)}
        </span>
      </div>
      <Perforations width={width} height={height} />
    </figure>
  )
}
