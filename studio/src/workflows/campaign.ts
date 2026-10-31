import type { Workflow } from '../api/comfy'
import { ESTIMATES, SHAPES, type VideoLength, type VideoShape } from './video'

// A campaign turns one product photo into an ad: each shot gets a still (FLUX.2 Klein, the
// product photo as reference, in the video's shape), the still is animated (Wan 2.2), and the
// clips are joined in order into one video (SunprintConcatVideos, hard cuts).

export type Shot = {
  id: string
  title: string
  scene: string // camera angle and setting for the still
  motion: string // what moves in the clip
  length: VideoLength
}

export const DEFAULT_SHOTS: Omit<Shot, 'id'>[] = [
  {
    title: 'Hero',
    scene: 'Studio product advertisement photo, front view at eye level, centred on a clean light grey seamless background, soft even studio lighting, subtle reflection under it',
    motion: 'slow push-in toward the product, soft light gliding across its surface',
    length: 5,
  },
  {
    title: 'Low angle',
    scene: 'Dramatic product advertisement photo from a low three-quarter angle looking up, dark charcoal background, crisp rim light outlining the product',
    motion: 'slow orbit from left to right around the product, rim light glinting along its edges',
    length: 5,
  },
  {
    title: 'Details',
    scene: 'Close-up macro advertisement photo of the most distinctive detail of the product, shallow depth of field, warm soft studio light, clean neutral background',
    motion: 'slow pan across the detail with a gentle focus pull',
    length: 10,
  },
  {
    title: 'Lifestyle',
    scene: 'Lifestyle advertisement photo of the product in a real outdoor setting that suits it, natural morning sunlight, background softly blurred',
    motion: 'gentle handheld drift, sunlight flickering through leaves, light breeze',
    length: 5,
  },
]

export const newShot = (s: Omit<Shot, 'id'>): Shot => ({ ...s, id: crypto.randomUUID() })

export type CampaignFormat = VideoShape

export const FORMATS: Record<CampaignFormat, { label: string; detail: string }> = {
  portrait: { label: '9:16 vertical', detail: 'Reels, Stories, TikTok, Shorts' },
  landscape: { label: '16:9 horizontal', detail: 'YouTube, websites' },
}

export const formatSize = (format: CampaignFormat) => ({ width: SHAPES[format].width, height: SHAPES[format].height })

// Klein keeps the product closest to the photo when told exactly what must not change.
export function stillPrompt(shot: Shot, product: string, look: string): string {
  const name = product.trim() || 'product'
  return [
    `${shot.scene.trim().replace(/\.$/, '')}.`,
    `The product is the ${name} from image 1.`,
    look.trim() ? `Overall look: ${look.trim().replace(/\.$/, '')}.` : '',
    'Keep the product exactly the same as in image 1: same shape, proportions, colours, materials, logo, printed text and every detail.',
  ]
    .filter(Boolean)
    .join(' ')
}

// Wan follows one clear camera move and simple motion best; the start frame carries the look.
export function motionPrompt(shot: Shot, product: string): string {
  const name = product.trim() || 'product'
  return `Advertisement video of the ${name}, ${shot.motion.trim().replace(/\.$/, '')}, the ${name} stays sharp, in focus and unchanged, smooth slow camera motion, premium commercial look, realistic.`
}

export const STILL_MINUTES = 1
export const campaignMinutes = (shots: Shot[]) =>
  shots.reduce((sum, s) => sum + ESTIMATES[s.length].minutes, 0)

export function slug(text: string): string {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? ['campaign']).slice(0, 4).join('-')
}

export const CONCAT_STAGES: Record<string, string> = { save: 'Joining the shots' }

export function concatWorkflow(clipPaths: string[], prefix: string): Workflow {
  return {
    save: { class_type: 'SunprintConcatVideos', inputs: { videos: clipPaths.join('\n'), filename_prefix: prefix } },
  }
}
