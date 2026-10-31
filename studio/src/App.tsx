import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { uploadImage, viewUrl } from './api/comfy'
import { Composer, type Attachment } from './components/Composer'
import { EditSettingsPanel } from './components/EditSettingsPanel'
import { MaskPainter, type MaskHandle } from './components/MaskPainter'
import { T2ISettingsPanel } from './components/T2ISettingsPanel'
import { Perforations, VideoPrint, VideoProgress } from './components/Video'
import { VideoSettingsPanel } from './components/VideoSettingsPanel'
import { CampaignPanel } from './components/CampaignPanel'
import { Storyboard, type BoardView } from './components/Storyboard'
import { useCampaign } from './hooks/useCampaign'
import { measure, useStudio, type Creation, type Job, type Picture } from './hooks/useStudio'
import {
  DEFAULT_EDIT_SETTINGS,
  EDIT_STAGES,
  MAX_REFERENCES,
  editImage,
  maskInstruction,
  type EditSettings,
  type MaskOperation,
} from './workflows/editImage'
import { DEFAULT_SETTINGS, MODELS, STAGES, randomSeed, textToImage, type T2ISettings } from './workflows/textToImage'
import {
  DEFAULT_VIDEO_SETTINGS,
  ESTIMATES,
  FPS,
  SHAPES,
  VIDEO_STAGES,
  frameCount,
  videoWorkflow,
  type VideoSettings,
} from './workflows/video'

type Mode = 'image' | 'video' | 'campaign'

const MODE_LABELS: Record<Mode, string> = { image: 'Image', video: 'Video', campaign: 'Campaign' }
type VideoCreation = Extract<Creation, { kind: 'video' }>

function usePersisted<T>(key: string, defaults: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === null) return defaults
      const parsed = JSON.parse(stored)
      return typeof defaults === 'object' && defaults !== null ? { ...defaults, ...parsed } : parsed
    } catch {
      return defaults
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // settings just won't be remembered
    }
  }, [key, value])
  return [value, setValue] as const
}

function attachmentOf(p: Picture): Attachment {
  const ref = { filename: p.filename, subfolder: p.subfolder, type: p.type }
  return { id: crypto.randomUUID(), preview: viewUrl(ref), width: p.width, height: p.height, name: p.filename, status: 'ready', ref }
}

const readyPictures = (list: Attachment[]): Picture[] =>
  list.flatMap((a) => (a.status === 'ready' ? [{ ...a.ref, width: a.width, height: a.height }] : []))

export default function App() {
  const { online, job, history, current, setCurrent, run, stop, dismissError } = useStudio()
  const [mode, setMode] = usePersisted<Mode>('sunprint.mode', 'image')
  const [prompt, setPrompt] = useState(current?.prompt ?? '')
  const [settings, setSettings] = usePersisted<T2ISettings>('sunprint.t2i.settings', DEFAULT_SETTINGS)
  const [editSettings, setEditSettings] = usePersisted<EditSettings>('sunprint.edit.settings', DEFAULT_EDIT_SETTINGS)
  const [videoSettings, setVideoSettings] = usePersisted<VideoSettings>('sunprint.video.settings', DEFAULT_VIDEO_SETTINGS)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const ad = useCampaign(run, stop, videoSettings)
  const [boardView, setBoardView] = useState<BoardView>({ kind: 'board' })
  // A freshly finished ad opens in the player.
  const [seenAd, setSeenAd] = useState(ad.campaign.ad?.filename)
  if (ad.campaign.ad?.filename !== seenAd) {
    setSeenAd(ad.campaign.ad?.filename)
    if (ad.campaign.ad) setBoardView({ kind: 'ad' })
  }
  const [startFrames, setStartFrames] = useState<Attachment[]>([])
  const [continueOf, setContinueOf] = useState<VideoCreation | null>(null)
  const [notify, setNotify] = useState(false)
  // What the running video is, captured at submit (the composer is free again once it starts).
  const [videoJob, setVideoJob] = useState<{ prompt: string; summary: string; minutes: number } | null>(null)
  const [newSeed, setNewSeed] = useState(true)
  const [seed, setSeed] = useState(current?.seed ?? randomSeed())
  const [peek, setPeek] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [hasMask, setHasMask] = useState(false)
  const [maskError, setMaskError] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const painter = useRef<MaskHandle>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const video = mode === 'video'
  const campaignMode = mode === 'campaign'
  const editing = mode === 'image' && attachments.length > 0
  const running = job.state === 'running'
  const videoRunning = job.state === 'running' && job.kind === 'video'
  const inputs = video ? startFrames : attachments
  const ready = online === true && !running && inputs.every((a) => a.status === 'ready')
  const canCreate = ready && prompt.trim().length > 0
  const batch = editing ? editSettings.batch : settings.batch
  const image1 = attachments[0]

  // A selection belongs to one picture: a new image 1 starts with none.
  const [maskFor, setMaskFor] = useState<string | undefined>(undefined)
  if (image1?.id !== maskFor) {
    setMaskFor(image1?.id)
    setHasMask(false)
    setSelecting(false)
  }
  const masked = editing && hasMask

  // Tell the person when a long video finishes, if they asked.
  const wasVideoRunning = useRef(false)
  useEffect(() => {
    if (wasVideoRunning.current && !videoRunning && job.state === 'idle' && notify && 'Notification' in window) {
      if (Notification.permission === 'granted') new Notification('Sunprint', { body: 'Your video is ready.' })
      setNotify(false)
    }
    wasVideoRunning.current = videoRunning
  }, [videoRunning, job.state, notify])

  const toggleNotify = () => {
    if (!notify && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    setNotify((v) => !v)
  }

  const addFilesTo = (setList: Dispatch<SetStateAction<Attachment[]>>, room: number, max: number, files: File[]) => {
    const update = (id: string, patch: Partial<Attachment>) =>
      setList((list) => list.map((a) => (a.id === id ? ({ ...a, ...patch } as Attachment) : a)))
    for (const file of files.slice(0, Math.max(0, room))) {
      const id = crypto.randomUUID()
      const preview = URL.createObjectURL(file)
      setList((list) =>
        list.length >= max ? list : [...list, { id, preview, width: 0, height: 0, name: file.name, status: 'uploading' }],
      )
      measure(preview).then((size) => update(id, size), () => {})
      uploadImage(file).then(
        (ref) => update(id, { status: 'ready', ref }),
        (err: Error) => update(id, { status: 'error', message: err.message }),
      )
    }
  }

  const addFiles = (files: File[]) =>
    video
      ? addFilesTo(setStartFrames, 1 - startFrames.length, 1, files)
      : addFilesTo(setAttachments, MAX_REFERENCES - attachments.length, MAX_REFERENCES, files)

  const removeAttachment = (id: string) => {
    const drop = (list: Attachment[]) => {
      const gone = list.find((a) => a.id === id)
      if (gone?.preview.startsWith('blob:')) URL.revokeObjectURL(gone.preview)
      return list.filter((a) => a.id !== id)
    }
    if (video) {
      setStartFrames(drop)
      setContinueOf(null) // the last frame is what a continuation starts from
    } else {
      setAttachments(drop)
    }
  }

  const nextSeed = () => {
    const s = newSeed ? randomSeed() : seed
    setSeed(s)
    return s
  }

  // Generate (fill with the prompt) or Remove (heal) inside the painted area only.
  const submitMasked = async (operation: MaskOperation) => {
    if (!ready || (operation === 'fill' && !prompt.trim())) return
    setMaskError(null)
    try {
      const blob = await painter.current?.exportMask()
      if (!blob) throw new Error('Could not read the selection.')
      const mask = await uploadImage(new File([blob], 'sunprint_mask.png', { type: 'image/png' }), { overwrite: true })
      const s = nextSeed()
      setSelecting(false)
      const sources = readyPictures(attachments)
      const text = operation === 'heal' ? 'Removed the selected area' : prompt.trim()
      void run(
        { kind: 'edit', prompt: text, seed: s, settings: editSettings, sources, operation },
        editImage(maskInstruction(operation, prompt), s, sources, editSettings, mask),
        EDIT_STAGES,
      )
    } catch (err) {
      setMaskError(err instanceof Error ? err.message : String(err))
    }
  }

  const runVideo = (text: string, s: number, vs: VideoSettings, start: Picture | undefined, from: VideoCreation | null) => {
    const vsFinal = from ? { ...vs, shape: from.settings.shape } : vs
    const duration = from ? from.duration + vs.length : vs.length
    const shape = SHAPES[vsFinal.shape]
    setVideoJob({
      prompt: text,
      summary: `${duration} s, ${shape.label.toLowerCase()} ${shape.width}×${shape.height}, ${FPS} fps${from ? `, continuing your ${from.duration} s video` : ''}`,
      minutes: ESTIMATES[vs.length].minutes,
    })
    void run(
      {
        kind: 'video',
        prompt: text,
        seed: s,
        settings: vsFinal,
        duration,
        start: from ? undefined : start,
        extended: from ? true : undefined,
      },
      videoWorkflow({ prompt: text, seed: s, settings: vsFinal, start, continueFrom: from ?? undefined }),
      VIDEO_STAGES,
    )
  }

  const submit = () => {
    if (masked) {
      void submitMasked('fill')
      return
    }
    if (!canCreate) return
    const s = nextSeed()
    const text = prompt.trim()
    if (video) {
      runVideo(text, s, videoSettings, readyPictures(startFrames)[0], continueOf)
      if (continueOf) {
        setContinueOf(null)
        setStartFrames([])
      }
    } else if (editing) {
      const sources = readyPictures(attachments)
      void run({ kind: 'edit', prompt: text, seed: s, settings: editSettings, sources }, editImage(text, s, sources, editSettings), EDIT_STAGES)
    } else {
      void run({ kind: 't2i', prompt: text, seed: s, settings }, textToImage(text, s, settings), STAGES)
    }
  }

  // "Edit this": the result becomes image 1 and the prompt is ready for the next instruction.
  const editThis = (c: Picture) => {
    setMode('image')
    setAttachments([attachmentOf(c)])
    setPrompt('')
    promptRef.current?.focus()
  }

  const animateThis = (c: Picture) => {
    setMode('video')
    setContinueOf(null)
    setStartFrames([attachmentOf(c)])
    promptRef.current?.focus()
  }

  // Continue: the video's last frame becomes the start frame and the new part is joined on.
  const continueVideo = (c: VideoCreation) => {
    setContinueOf(c)
    setStartFrames([attachmentOf(c.lastFrame)])
    setPrompt('')
    promptRef.current?.focus()
  }

  const retake = (c: VideoCreation) => {
    const s = randomSeed()
    setSeed(s)
    runVideo(c.prompt, s, c.settings, c.start, null)
  }

  // The paused frame of the playing clip goes to the image editor as image 1.
  const editFrame = async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    setMode('image')
    setAttachments([])
    setPrompt('')
    addFilesTo(setAttachments, MAX_REFERENCES, MAX_REFERENCES, [
      new File([blob], `frame_${Math.round(v.currentTime * FPS)}.png`, { type: 'image/png' }),
    ])
  }

  const reuse = (c: Creation) => {
    setPrompt(c.kind === 'edit' && c.operation === 'heal' ? '' : c.prompt)
    setSeed(c.seed)
    setNewSeed(false)
    if (c.kind === 'video') {
      setMode('video')
      setContinueOf(null)
      setStartFrames(c.start ? [attachmentOf(c.start)] : [])
      setVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, ...c.settings })
    } else if (c.kind === 'edit') {
      setMode('image')
      setAttachments(c.sources.map(attachmentOf))
      setEditSettings({ ...DEFAULT_EDIT_SETTINGS, ...c.settings, batch: 1 })
    } else {
      setMode('image')
      setAttachments([])
      setSettings({ ...DEFAULT_SETTINGS, ...c.settings, batch: 1 })
    }
  }

  // What the print shows: the job being made, the original while comparing, or the result.
  const original = current?.kind === 'edit' ? current.sources[0] : null
  const shown: Picture | null = running ? null : peek && original ? original : current
  const videoShape = SHAPES[continueOf ? continueOf.settings.shape : videoSettings.shape]
  const frame = running
    ? videoRunning
      ? videoShape
      : editing && image1.width
        ? image1
        : settings
    : (shown ?? (video ? videoShape : settings))

  const videoLength = continueOf ? continueOf.duration + videoSettings.length : videoSettings.length
  const createLabel = video
    ? continueOf
      ? `Continue to ${videoLength} s`
      : `Create ${videoLength} s video`
    : editing
      ? batch > 1
        ? `Edit image, ${batch} takes`
        : 'Edit image'
      : batch > 1
        ? `Create ${batch} images`
        : 'Create image'

  const modeSwitch = (
    <div className="mode-switch" role="radiogroup" aria-label="What to make">
      {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} disabled={running}>
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  )

  return (
    <div className="app">
      <header className="masthead">
        <h1 className="wordmark">Sunprint</h1>
        <BackendStatus online={online} />
      </header>

      <main className="workspace">
        <section className="controls" aria-label={video ? 'Make a video' : editing ? 'Edit an image' : 'Create an image'}>
          {campaignMode ? (
            <>
              {modeSwitch}
              <CampaignPanel
                campaign={ad.campaign}
                progress={ad.progress}
                job={job}
                online={online === true}
                error={ad.error}
                onDismissError={() => {
                  ad.dismissError()
                  dismissError()
                }}
                onProduct={ad.setProduct}
                onText={(patch) => ad.setCampaign((c) => ({ ...c, ...patch }))}
                onFormat={ad.setFormat}
                onShot={ad.updateShot}
                onAddShot={ad.addShot}
                onRemoveShot={ad.removeShot}
                onMoveShot={ad.moveShot}
                onResetShots={ad.resetShots}
                onCreateStills={() => void ad.createStills()}
                onMakeAd={() => void ad.makeAd()}
                onStop={ad.stop}
              />
            </>
          ) : job.state === 'running' && job.kind === 'video' ? (
            <VideoProgress
              job={job}
              prompt={videoJob?.prompt ?? ''}
              summary={videoJob?.summary ?? ''}
              estimateMinutes={videoJob?.minutes ?? 30}
              notify={notify}
              onNotify={toggleNotify}
              onStop={stop}
            />
          ) : (
            <>
              {modeSwitch}

              <Composer
                prompt={prompt}
                onPrompt={setPrompt}
                attachments={inputs}
                maxAttachments={video ? 1 : MAX_REFERENCES}
                onAddFiles={addFiles}
                onRemove={removeAttachment}
                onSubmit={submit}
                inputRef={promptRef}
                hasMask={masked}
                selecting={selecting}
                onSelectArea={() => setSelecting((v) => !v)}
                video={video}
                extending={continueOf ? continueOf.duration : null}
              />

              <div className="action-dock">
                {running ? (
                  <button type="button" className="action stop" onClick={stop}>
                    Stop
                  </button>
                ) : masked ? (
                  <div className="action-pair">
                    <button type="button" className="action" onClick={() => void submitMasked('fill')} disabled={!canCreate}>
                      Generate in area
                    </button>
                    <button type="button" className="action secondary" onClick={() => void submitMasked('heal')} disabled={!ready}>
                      Remove from area
                    </button>
                  </div>
                ) : (
                  <button type="button" className="action" onClick={submit} disabled={!canCreate}>
                    {createLabel}
                  </button>
                )}
                <p className="hint">
                  {masked
                    ? 'Generate needs a description. Remove works without one.'
                    : video
                      ? 'You can keep using the image tools once it starts.'
                      : 'Ctrl + Enter works too. Paste or drop a picture to edit it.'}
                </p>
              </div>
            </>
          )}

          {maskError && (
            <div className="error" role="alert">
              <p>{maskError}</p>
              <button type="button" onClick={() => setMaskError(null)}>
                Dismiss
              </button>
            </div>
          )}

          {job.state === 'error' && !campaignMode && (
            <div className="error" role="alert">
              <p>{job.message}</p>
              <button type="button" onClick={dismissError}>
                Dismiss
              </button>
            </div>
          )}

          {!campaignMode && !videoRunning && video && current?.kind === 'video' && !continueOf && (
            <KeepGoing c={current} onContinue={() => continueVideo(current)} onRetake={() => retake(current)} onEditFrame={() => void editFrame()} disabled={!ready} />
          )}

          {!campaignMode &&
            !videoRunning &&
            (video ? (
              <VideoSettingsPanel
                settings={videoSettings}
                onChange={setVideoSettings}
                continuingFrom={continueOf ? continueOf.duration : null}
                disabled={running}
              />
            ) : editing ? (
              <EditSettingsPanel
                settings={editSettings}
                onChange={setEditSettings}
                references={attachments.length}
                masked={masked}
                disabled={running}
              />
            ) : (
              <T2ISettingsPanel settings={settings} onChange={setSettings} disabled={running} />
            ))}

          {!campaignMode && !videoRunning && (
            <div className="seed">
              <label className="check">
                <input type="checkbox" checked={newSeed} onChange={(e) => setNewSeed(e.target.checked)} />
                New variation every time
              </label>
              {!newSeed && (
                <label className="seed-value">
                  Seed
                  <input
                    type="number"
                    min={0}
                    value={seed}
                    onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              )}
            </div>
          )}
        </section>

        <section className="stage" aria-label="Result">
          {campaignMode && (
            <Storyboard
              campaign={ad.campaign}
              progress={ad.progress}
              job={job}
              view={boardView}
              onView={setBoardView}
              onRedoStill={(id) => void ad.createStills(id)}
              canRedo={ready && !!ad.campaign.product}
              videoRef={videoRef}
            />
          )}
          {/* Stays mounted while image 1 is attached so the painted selection survives. */}
          {mode === 'image' && image1 && image1.width > 0 && (
            <MaskPainter
              key={image1.id}
              ref={painter}
              src={image1.preview}
              width={image1.width}
              height={image1.height}
              hidden={!selecting || running}
              onChange={setHasMask}
              onDone={() => setSelecting(false)}
            />
          )}
          <div className="print-area" hidden={campaignMode || (!video && selecting && !running)}>
            {!running && current?.kind === 'video' ? (
              <VideoPrint
                src={viewUrl(current)}
                width={current.width}
                height={current.height}
                videoRef={videoRef}
                label={current.prompt}
              />
            ) : (
              <Print
                frame={frame}
                job={job}
                shown={shown}
                film={videoRunning || (video && !shown)}
                label={peek && original ? 'Original' : null}
                empty={video ? `Your ${videoLength} s video appears here` : 'Your image appears here.'}
              />
            )}
          </div>
          {!campaignMode && !running && !(selecting && !video) && current && (
            <Caption
              c={current}
              onReuse={() => reuse(current)}
              onEdit={() => editThis(current.kind === 'video' ? current.lastFrame : current)}
              onAnimate={() => animateThis(current.kind === 'video' ? current.lastFrame : current)}
              onPeek={setPeek}
            />
          )}
          {history.length > 0 && (
            <nav
              className="strip"
              aria-label="Earlier results"
              // Scrollbar is hidden, so let the normal mouse wheel move the strip sideways.
              onWheel={(e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
              }}
            >
              {history.map((c) => (
                <button
                  key={`${c.subfolder}/${c.filename}`}
                  type="button"
                  className="thumb"
                  aria-current={current?.filename === c.filename && current?.subfolder === c.subfolder}
                  onClick={() => setCurrent(c)}
                  title={c.prompt}
                >
                  <img src={viewUrl(c.kind === 'video' ? c.lastFrame : c)} alt={c.prompt} loading="lazy" />
                  {c.kind === 'video' && <span className="thumb-badge">{c.duration} s</span>}
                </button>
              ))}
            </nav>
          )}
        </section>
      </main>
    </div>
  )
}

function KeepGoing(props: { c: VideoCreation; onContinue: () => void; onRetake: () => void; onEditFrame: () => void; disabled: boolean }) {
  const { c, onContinue, onRetake, onEditFrame, disabled } = props
  return (
    <div className="keep-going">
      <span className="field-label">Keep going with this clip</span>
      <button type="button" className="option-card" onClick={onContinue} disabled={disabled}>
        <span className="option-title">Continue this video</span>
        <span className="option-note">
          Add 5, 10 or 15 s to this {c.duration} s video with a new prompt; it picks up from the last frame and joins on. Keep going as long as you like.
        </span>
      </button>
      <button type="button" className="option-card" onClick={onRetake} disabled={disabled}>
        <span className="option-title">Make it again, different take</span>
        <span className="option-note">Same prompt and settings, new seed. About {ESTIMATES[c.settings.length]?.minutes ?? 30} min.</span>
      </button>
      <button type="button" className="option-card" onClick={onEditFrame} disabled={disabled}>
        <span className="option-title">Edit this frame as an image</span>
        <span className="option-note">Sends the frame you paused on to the image editor. Useful for a cover or thumbnail.</span>
      </button>
    </div>
  )
}

function Caption(props: {
  c: Creation
  onReuse: () => void
  onEdit: () => void
  onAnimate: () => void
  onPeek: (v: boolean) => void
}) {
  const { c, onReuse, onEdit, onAnimate, onPeek } = props
  const details =
    c.kind === 'video'
      ? [
          `${c.duration} s video${c.extended ? ', continued' : ''}`,
          `${c.width}×${c.height}`,
          `${FPS} fps`,
          `${frameCount(c.duration)} frames`,
          c.start ? 'from a start frame' : null,
          `seed ${c.seed}`,
          `made in ${Math.max(1, Math.round(c.seconds / 60))} min`,
        ]
      : c.kind === 'edit'
        ? [
            c.operation === 'heal'
              ? 'Removed from area'
              : c.operation === 'fill'
                ? 'Generated in area'
                : c.sources.length > 1
                  ? 'Edit of 2 images'
                  : 'Edit',
            `${c.width}×${c.height}`,
            `${c.settings.steps} steps`,
            c.settings.cfg > 1 ? `guidance ${c.settings.cfg}` : null,
            c.settings.sampler,
            `seed ${c.seed}`,
            `made in ${c.seconds} s`,
          ]
        : [
            MODELS[c.settings.model].name,
            `${c.width}×${c.height}`,
            `${c.settings.steps} steps`,
            c.settings.cfg > 1 ? `guidance ${c.settings.cfg}` : null,
            c.settings.model === 'zimage' ? `${c.settings.sampler}, ${c.settings.scheduler}, shift ${c.settings.shift}` : c.settings.sampler,
            `seed ${c.seed}`,
            `made in ${c.seconds} s`,
          ]
  const peekOn = () => onPeek(true)
  const peekOff = () => onPeek(false)
  return (
    <div className="caption">
      <p className="caption-prompt">{c.prompt}</p>
      <p className="caption-meta">{details.filter(Boolean).join(', ')}</p>
      <div className="caption-actions">
        {c.kind !== 'video' && (
          <>
            <button type="button" onClick={onEdit}>
              {c.kind === 'edit' ? 'Keep editing' : 'Edit this'}
            </button>
            <button type="button" onClick={onAnimate}>
              Animate this
            </button>
          </>
        )}
        {c.kind === 'edit' && (
          <button
            type="button"
            onPointerDown={peekOn}
            onPointerUp={peekOff}
            onPointerLeave={peekOff}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && peekOn()}
            onKeyUp={peekOff}
            onBlur={peekOff}
          >
            Hold to compare
          </button>
        )}
        <a href={viewUrl(c)} download={c.filename}>
          {c.kind === 'video' ? 'Download MP4' : 'Download'}
        </a>
        <button type="button" onClick={onReuse}>
          Use these settings
        </button>
      </div>
    </div>
  )
}

function BackendStatus({ online }: { online: boolean | null }) {
  if (online === null) return <p className="status">Connecting to ComfyUI…</p>
  if (online) return <p className="status ok">ComfyUI connected</p>
  return (
    <p className="status down" role="status">
      ComfyUI isn't running. Start Sunprint.bat and this page connects on its own.
    </p>
  )
}

function Print(props: {
  frame: { width: number; height: number }
  job: Job
  shown: Picture | null
  label: string | null
  film: boolean
  empty: string
}) {
  const { frame, job, shown, label, film, empty } = props
  const [elapsed, setElapsed] = useState(0)
  const running = job.state === 'running'
  const startedAt = running ? job.startedAt : 0

  useEffect(() => {
    if (!running) return
    const tick = () => setElapsed(Math.round((Date.now() - startedAt) / 1000))
    tick()
    const t = window.setInterval(tick, 500)
    return () => window.clearInterval(t)
  }, [running, startedAt])

  const exposure = running && job.steps ? job.step / job.steps : 0
  const clock = elapsed >= 120 ? `${Math.floor(elapsed / 60)} min` : `${elapsed} s`
  const ratio = { ['--ratio' as string]: frame.width / frame.height }

  return (
    <figure
      className={film ? 'print film' : 'print'}
      // --ratio lets CSS fit the print inside the available box without cropping.
      style={film ? { aspectRatio: 'auto', ...ratio } : { aspectRatio: `${frame.width} / ${frame.height}`, ...ratio }}
    >
      {film && <Perforations width={frame.width} height={frame.height} />}
      <div className="print-surface" style={film ? { aspectRatio: `${frame.width} / ${frame.height}` } : undefined}>
        {shown && (
          <img
            key={shown.filename}
            className={label ? 'print-image instant' : 'print-image'}
            src={viewUrl(shown)}
            alt={label ?? 'Result'}
          />
        )}
        {label && <span className="print-label">{label}</span>}
        {running && (
          <div className="exposure" style={{ ['--exposure' as string]: exposure }}>
            <div className="exposure-light" />
            <p className="exposure-text">
              <span className="exposure-stage">{job.stage}</span>
              <span className="exposure-detail">
                {job.step > 0 ? `Step ${job.step} of ${job.steps}, ` : ''}
                {clock}
              </span>
            </p>
          </div>
        )}
        {!running && !shown && <p className="print-empty">{empty}</p>}
      </div>
      {film && <Perforations width={frame.width} height={frame.height} />}
    </figure>
  )
}
