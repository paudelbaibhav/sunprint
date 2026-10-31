import type { Workflow } from '../api/comfy'

// Text to image. Two installed models can do it:
// - Z-Image-Turbo: same graph as mode 1 of ImageGen-SUPER (official Comfy template settings).
// - FLUX.2 Klein 4B: the official Klein text-to-image graph (Flux2Scheduler + CFGGuider).

export type ModelId = 'zimage' | 'klein'

export type T2ISettings = {
  model: ModelId
  width: number
  height: number
  batch: number
  steps: number
  cfg: number
  sampler: string
  scheduler: string // Z-Image only; Klein always uses Flux2Scheduler
  shift: number // Z-Image only
  negative: string // only used when cfg > 1
  prefix: string
}

export type ModelInfo = {
  id: ModelId
  name: string
  blurb: string
  recommended: Pick<T2ISettings, 'steps' | 'cfg' | 'sampler' | 'scheduler' | 'shift'>
}

export const MODELS: Record<ModelId, ModelInfo> = {
  zimage: {
    id: 'zimage',
    name: 'Z-Image Turbo',
    blurb: 'Best for photoreal images.',
    recommended: { steps: 8, cfg: 1, sampler: 'res_multistep', scheduler: 'simple', shift: 3 },
  },
  klein: {
    id: 'klein',
    name: 'FLUX.2 Klein',
    blurb: 'Faster, 4 steps. Same model as the edit tools.',
    recommended: { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', shift: 3 },
  },
}

export const DEFAULT_SETTINGS: T2ISettings = {
  model: 'zimage',
  width: 1024,
  height: 1024,
  batch: 1,
  ...MODELS.zimage.recommended,
  negative: '',
  prefix: 't2i',
}

export type Shape = { id: string; label: string; width: number; height: number }

export const SHAPES: Shape[] = [
  { id: 'square', label: 'Square', width: 1024, height: 1024 },
  { id: 'landscape', label: 'Landscape', width: 1280, height: 704 },
  { id: 'portrait', label: 'Portrait', width: 704, height: 1280 },
  { id: 'photo', label: 'Photo', width: 1152, height: 864 },
]

export const LIMITS = {
  size: { min: 256, max: 2048, step: 16 },
  batch: { min: 1, max: 4 },
  steps: { min: 1, max: 50 },
  cfg: { min: 1, max: 10, step: 0.5 },
  shift: { min: 0.5, max: 10, step: 0.1 },
}

// Above this the 6 GB GPU gets slow or may run out of memory.
export const COMFORTABLE_PIXELS = 1.5e6

// Node ids double as progress stages in the UI.
export const STAGES: Record<string, string> = {
  unet: 'Loading the model',
  clip: 'Loading the model',
  vae: 'Loading the model',
  prompt: 'Reading your prompt',
  negative: 'Reading your prompt',
  sampler: 'Creating',
  decode: 'Developing',
  save: 'Saving',
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 48)
}

export function snapToStep(value: number): number {
  const { min, max, step } = LIMITS.size
  return Math.min(max, Math.max(min, Math.round(value / step) * step))
}

export function textToImage(prompt: string, seed: number, s: T2ISettings): Workflow {
  const negative =
    s.cfg > 1
      ? { class_type: 'CLIPTextEncode', inputs: { text: s.negative, clip: ['clip', 0] } }
      : { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['prompt', 0] } }
  const common = {
    prompt: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['clip', 0] } },
    negative,
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } },
    save: { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: s.prefix || 't2i' } },
  }

  if (s.model === 'klein') {
    return {
      unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux-2-klein-4b-Q5_K_M.gguf' } },
      clip: { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: 'Qwen_3_4b-imatrix-IQ4_XS.gguf', type: 'flux2' } },
      vae: { class_type: 'VAELoader', inputs: { vae_name: 'flux2_small_decoder.safetensors' } },
      ...common,
      latent: { class_type: 'EmptyFlux2LatentImage', inputs: { width: s.width, height: s.height, batch_size: s.batch } },
      noise: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
      pick: { class_type: 'KSamplerSelect', inputs: { sampler_name: s.sampler } },
      sigmas: { class_type: 'Flux2Scheduler', inputs: { steps: s.steps, width: s.width, height: s.height } },
      guider: {
        class_type: 'CFGGuider',
        inputs: { model: ['unet', 0], positive: ['prompt', 0], negative: ['negative', 0], cfg: s.cfg },
      },
      sampler: {
        class_type: 'SamplerCustomAdvanced',
        inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['pick', 0], sigmas: ['sigmas', 0], latent_image: ['latent', 0] },
      },
    }
  }

  return {
    unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'z-image-turbo-Q4_K_S.gguf' } },
    clip: { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: 'Qwen_3_4b-imatrix-IQ4_XS.gguf', type: 'lumina2' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: 'z_image_ae.safetensors' } },
    shift: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['unet', 0], shift: s.shift } },
    ...common,
    latent: { class_type: 'EmptySD3LatentImage', inputs: { width: s.width, height: s.height, batch_size: s.batch } },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        model: ['shift', 0],
        positive: ['prompt', 0],
        negative: ['negative', 0],
        latent_image: ['latent', 0],
        seed,
        steps: s.steps,
        cfg: s.cfg,
        sampler_name: s.sampler,
        scheduler: s.scheduler,
        denoise: 1,
      },
    },
  }
}
