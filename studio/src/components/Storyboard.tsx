import type { RefObject } from 'react'
import { viewUrl } from '../api/comfy'
import type { Campaign, CampaignProgress, ShotState } from '../hooks/useCampaign'
import type { Job } from '../hooks/useStudio'
import { formatSize } from '../workflows/campaign'
import { VideoPrint } from './Video'

export type BoardView = { kind: 'board' } | { kind: 'ad' } | { kind: 'clip'; shotId: string }

type Props = {
  campaign: Campaign
  progress: CampaignProgress
  job: Job
  view: BoardView
  onView: (v: BoardView) => void
  onRedoStill: (id: string) => void
  canRedo: boolean
  videoRef: RefObject<HTMLVideoElement | null>
}

// The right side of a campaign: one frame per shot, or the finished ad / a shot's clip.
export function Storyboard({ campaign: c, progress, job, view, onView, onRedoStill, canRedo, videoRef }: Props) {
  const size = formatSize(c.format)
  const clipShot = view.kind === 'clip' ? c.shots.find((s) => s.id === view.shotId) : undefined

  if (view.kind === 'ad' && c.ad) {
    return (
      <div className="board-player">
        <div className="print-area">
          <VideoPrint src={viewUrl(c.ad)} width={c.ad.width} height={c.ad.height} videoRef={videoRef} label="Your ad" />
        </div>
        <div className="caption">
          <p className="caption-prompt">Your {c.ad.duration} s ad for the {c.productText || 'product'}</p>
          <p className="caption-meta">
            {c.shots.length} shots, {c.ad.width}×{c.ad.height}, saved as {c.ad.subfolder}/{c.ad.filename}
          </p>
          <div className="caption-actions">
            <a href={viewUrl(c.ad)} download={c.ad.filename}>
              Download MP4
            </a>
            <button type="button" onClick={() => onView({ kind: 'board' })}>
              Back to the shots
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (clipShot?.clip) {
    return (
      <div className="board-player">
        <div className="print-area">
          <VideoPrint src={viewUrl(clipShot.clip)} width={size.width} height={size.height} videoRef={videoRef} label={clipShot.title} />
        </div>
        <div className="caption">
          <p className="caption-prompt">
            Shot: {clipShot.title}, {clipShot.length} s
          </p>
          <div className="caption-actions">
            <button type="button" onClick={() => onView({ kind: 'board' })}>
              Back to the shots
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="board">
      <div className="board-head">
        <span className="field-label">Storyboard</span>
        {c.ad && (
          <button type="button" className="text-button" onClick={() => onView({ kind: 'ad' })}>
            Watch the ad ({c.ad.duration} s)
          </button>
        )}
      </div>
      <ol className="board-grid" data-format={c.format}>
        {c.shots.map((s, i) => (
          <ShotFrame
            key={s.id}
            shot={s}
            index={i}
            size={size}
            progress={progress}
            job={job}
            onRedo={() => onRedoStill(s.id)}
            onWatch={() => onView({ kind: 'clip', shotId: s.id })}
            canRedo={canRedo}
          />
        ))}
      </ol>
    </div>
  )
}

function ShotFrame(props: {
  shot: ShotState
  index: number
  size: { width: number; height: number }
  progress: CampaignProgress
  job: Job
  onRedo: () => void
  onWatch: () => void
  canRedo: boolean
}) {
  const { shot: s, index, size, progress, job, onRedo, onWatch, canRedo } = props
  const active = progress?.shotId === s.id
  const working = active && job.state === 'running'
  const exposure = working && job.steps ? job.step / job.steps : 0
  const status = active
    ? progress?.phase === 'still'
      ? 'Making the still'
      : 'Animating'
    : s.clip
      ? 'Clip ready'
      : s.still
        ? 'Still ready'
        : 'Not made yet'

  return (
    <li className="board-shot" data-active={active || undefined}>
      <div className="board-frame" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        {s.still && <img src={viewUrl(s.still)} alt={`${s.title} still`} className="board-still" />}
        {working && (
          <div className="exposure" style={{ ['--exposure' as string]: exposure }}>
            <div className="exposure-light" />
            <p className="exposure-text">
              <span className="exposure-stage">{job.state === 'running' ? job.stage : ''}</span>
            </p>
          </div>
        )}
        {!s.still && !working && <span className="board-empty">{s.title}</span>}
      </div>
      <div className="board-caption">
        <span className="board-title">
          {index + 1}. {s.title}, {s.length} s
        </span>
        <span className="board-status" data-state={s.clip ? 'clip' : s.still ? 'still' : 'none'}>
          {status}
        </span>
        <span className="board-actions">
          {s.clip && !active && (
            <button type="button" className="text-button" onClick={onWatch}>
              Watch clip
            </button>
          )}
          {s.still && !active && (
            <button type="button" className="text-button" onClick={onRedo} disabled={!canRedo}>
              Redo still
            </button>
          )}
        </span>
      </div>
    </li>
  )
}
