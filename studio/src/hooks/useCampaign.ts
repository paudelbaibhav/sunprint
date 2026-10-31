import { useCallback, useEffect, useRef, useState } from 'react'
import { hasNode, type ImageRef, type Workflow } from '../api/comfy'
import {
  CONCAT_STAGES,
  DEFAULT_SHOTS,
  concatWorkflow,
  formatSize,
  motionPrompt,
  newShot,
  slug,
  stillPrompt,
  type CampaignFormat,
  type Shot,
} from '../workflows/campaign'
import { DEFAULT_EDIT_SETTINGS, EDIT_STAGES, editImage } from '../workflows/editImage'
import { randomSeed } from '../workflows/textToImage'
import { VIDEO_STAGES, videoWorkflow, type VideoSettings } from '../workflows/video'
import type { Creation, Picture, RunRequest } from './useStudio'

type VideoCreation = Extract<Creation, { kind: 'video' }>

// A clip is reused while its still, motion, length and format are unchanged, so after a stop
// or a redone still only the shots that changed are rendered again.
export type ShotState = Shot & { still?: Picture; clip?: VideoCreation; clipKey?: string }

export type Campaign = {
  product: Picture | null
  productText: string
  look: string
  format: CampaignFormat
  shots: ShotState[]
  ad?: VideoCreation
}

export type CampaignProgress = { phase: 'still' | 'clip' | 'join'; shotId?: string; index: number; total: number } | null

type Run = (request: RunRequest, workflow: Workflow, stages: Record<string, string>) => Promise<Creation[]>

const KEY = 'sunprint.campaign'

const blank = (): Campaign => ({
  product: null,
  productText: '',
  look: '',
  format: 'portrait',
  shots: DEFAULT_SHOTS.map(newShot),
})

function load(): Campaign {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return stored ? { ...blank(), ...stored } : blank()
  } catch {
    return blank()
  }
}

const clipKey = (shot: ShotState, format: CampaignFormat, productText: string) =>
  [shot.still?.filename, shot.motion, shot.length, format, productText].join('|')

const pathOf = (r: ImageRef) => (r.subfolder ? `${r.subfolder}/${r.filename}` : r.filename)

export function useCampaign(run: Run, stopJob: () => void, videoSettings: VideoSettings) {
  const [campaign, setCampaign] = useState<Campaign>(load)
  const [progress, setProgress] = useState<CampaignProgress>(null)
  const [error, setError] = useState<string | null>(null)
  const stopped = useRef(false)
  // The async shot loops read the newest campaign through this, not a stale closure.
  const latest = useRef(campaign)

  useEffect(() => {
    latest.current = campaign
    try {
      localStorage.setItem(KEY, JSON.stringify(campaign))
    } catch {
      // the campaign just won't survive a reload
    }
  }, [campaign])

  const patchShot = useCallback((id: string, patch: Partial<ShotState>) => {
    setCampaign((c) => ({ ...c, shots: c.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  }, [])

  // Changing the product or format makes every still (and so every clip) out of date.
  const bare = (s: ShotState): ShotState => ({ id: s.id, title: s.title, scene: s.scene, motion: s.motion, length: s.length })
  const setProduct = (product: Picture | null) =>
    setCampaign((c) => ({ ...c, product, shots: c.shots.map(bare), ad: undefined }))
  const setFormat = (format: CampaignFormat) =>
    setCampaign((c) => ({ ...c, format, shots: c.shots.map(bare), ad: undefined }))

  const makeStill = async (shot: ShotState, index: number, total: number) => {
    const c = latest.current
    if (!c.product) throw new Error('Add a product photo first.')
    setProgress({ phase: 'still', shotId: shot.id, index, total })
    const seed = randomSeed()
    const settings = { ...DEFAULT_EDIT_SETTINGS, prefix: 'campaign/still' }
    const [still] = await run(
      { kind: 'edit', prompt: `${shot.title}: ${shot.scene}`, seed, settings, sources: [c.product] },
      editImage(stillPrompt(shot, c.productText, c.look), seed, [c.product], settings, undefined, formatSize(c.format)),
      EDIT_STAGES,
    )
    patchShot(shot.id, { still, clip: undefined, clipKey: undefined })
  }

  const guarded = async (work: () => Promise<void>) => {
    stopped.current = false
    setError(null)
    try {
      await work()
    } catch (err) {
      if (!stopped.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }

  // Stills for every shot that has none (or only the given shot, to redo it).
  const createStills = (onlyId?: string) =>
    guarded(async () => {
      const todo = latest.current.shots.filter((s) => (onlyId ? s.id === onlyId : !s.still))
      for (const [i, shot] of todo.entries()) {
        if (stopped.current) return
        await makeStill(shot, i + 1, todo.length)
      }
    })

  // Animate each still (reusing clips that are still current), then join them into the ad.
  const makeAd = () =>
    guarded(async () => {
      const c = latest.current
      const shots = c.shots
      if (shots.some((s) => !s.still)) throw new Error('Every shot needs a still first.')
      if (!(await hasNode('SunprintConcatVideos')))
        throw new Error(
          'ComfyUI hasn’t loaded the clip joiner yet. Close the Sunprint window, start Sunprint.bat again, then press Make the ad video.',
        )
      const clips: VideoCreation[] = []
      for (const [i, shot] of shots.entries()) {
        if (stopped.current) return
        const key = clipKey(shot, c.format, c.productText)
        if (shot.clip && shot.clipKey === key) {
          clips.push(shot.clip)
          continue
        }
        setProgress({ phase: 'clip', shotId: shot.id, index: i + 1, total: shots.length })
        const seed = randomSeed()
        const settings: VideoSettings = { ...videoSettings, length: shot.length, shape: c.format, prefix: 'campaign/shot' }
        const prompt = motionPrompt(shot, c.productText)
        const [clip] = await run(
          { kind: 'video', prompt, seed, settings, duration: shot.length, start: shot.still },
          videoWorkflow({ prompt, seed, settings, start: shot.still }),
          VIDEO_STAGES,
        )
        patchShot(shot.id, { clip: clip as VideoCreation, clipKey: key })
        clips.push(clip as VideoCreation)
      }
      if (stopped.current) return
      setProgress({ phase: 'join', index: shots.length, total: shots.length })
      const total = shots.reduce((sum, s) => sum + s.length, 0)
      const name = slug(c.productText)
      const [ad] = await run(
        {
          kind: 'video',
          prompt: `Ad for the ${c.productText || 'product'}: ${shots.map((s) => s.title).join(', ')}`,
          seed: 0,
          settings: { ...videoSettings, shape: c.format, prefix: `campaign/${name}_ad` },
          duration: total,
          knownLastFrame: clips[clips.length - 1].lastFrame,
        },
        concatWorkflow(clips.map(pathOf), `campaign/${name}_ad`),
        CONCAT_STAGES,
      )
      setCampaign((cur) => ({ ...cur, ad: ad as VideoCreation }))
    })

  const stop = () => {
    stopped.current = true
    stopJob()
  }

  const updateShot = (id: string, patch: Partial<Shot>) => patchShot(id, patch)
  const addShot = () =>
    setCampaign((c) => ({ ...c, shots: [...c.shots, newShot({ ...DEFAULT_SHOTS[0], title: `Shot ${c.shots.length + 1}` })] }))
  const removeShot = (id: string) => setCampaign((c) => ({ ...c, shots: c.shots.filter((s) => s.id !== id) }))
  const moveShot = (id: string, by: -1 | 1) =>
    setCampaign((c) => {
      const i = c.shots.findIndex((s) => s.id === id)
      const j = i + by
      if (i < 0 || j < 0 || j >= c.shots.length) return c
      const shots = [...c.shots]
      ;[shots[i], shots[j]] = [shots[j], shots[i]]
      return { ...c, shots }
    })
  const resetShots = () => setCampaign((c) => ({ ...c, shots: DEFAULT_SHOTS.map(newShot), ad: undefined }))

  return {
    campaign,
    setCampaign,
    progress,
    error,
    dismissError: () => setError(null),
    setProduct,
    setFormat,
    updateShot,
    addShot,
    removeShot,
    moveShot,
    resetShots,
    createStills,
    makeAd,
    stop,
  }
}
