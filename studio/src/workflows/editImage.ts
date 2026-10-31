import { loadImageName, type ImageRef, type Workflow } from '../api/comfy'

// Image + instruction = edited image. FLUX.2 Klein 4B, same graph as modes 3/3b/4/5 of
// ImageGen-SUPER: each reference image is resized, encoded and attached to both the
// prompt and the (zeroed) negative with ReferenceLatent; the output takes image 1's shape.
//
// With a mask (painted area) the edit is local: the area is greyed out in image 1, Klein
// fills it, and only the feathered area is pasted back, so every other pixel stays identical.

export type EditSettings = {
  megapixels: number // output detail; the shape follows image 1
  ref2Megapixels: number // second reference is kept smaller to save VRAM
  batch: number
  steps: number
  cfg: number
  sampler: string
  negative: string // only used when cfg > 1
  grow: number // px the painted area is widened by before filling
  feather: number // px of soft edge where the fill meets the original
  prefix: string
}

export type MaskOperation = 'fill' | 'heal'

export const EDIT_RECOMMENDED = { steps: 4, cfg: 1, sampler: 'euler', ref2Megapixels: 0.5, grow: 12, feather: 8 }

export const DEFAULT_EDIT_SETTINGS: EditSettings = {
  megapixels: 1,
  batch: 1,
  ...EDIT_RECOMMENDED,
  negative: '',
  prefix: 'edit',
}

export const DETAIL_OPTIONS = [
  { megapixels: 0.5, label: 'Draft' },
  { megapixels: 1, label: 'Standard' },
  { megapixels: 1.5, label: 'High' },
]

export const MAX_REFERENCES = 2

// Klein is told about the grey area explicitly; this wording tested seamless.
export function maskInstruction(op: MaskOperation, prompt: string): string {
  if (op === 'heal')
    return 'Remove everything inside the grey area and fill it with background that continues the surrounding scene seamlessly. Match the lighting, texture and perspective. Do not add any new objects, people or text.'
  return `Fill the grey area with ${prompt.trim().replace(/\.$/, '')}. Match the lighting, perspective and style of the rest of the image.`
}

export const EDIT_STAGES: Record<string, string> = {
  unet: 'Loading the model',
  clip: 'Loading the model',
  vae: 'Loading the model',
  load1: 'Reading your image',
  scale1: 'Reading your image',
  enc1: 'Reading your image',
  load2: 'Reading your image',
  scale2: 'Reading your image',
  enc2: 'Reading your image',
  mask: 'Reading your selection',
  grow: 'Reading your selection',
  hole: 'Reading your selection',
  prompt: 'Reading your instruction',
  negative: 'Reading your instruction',
  sampler: 'Editing',
  decode: 'Developing',
  blend: 'Blending into the original',
  save: 'Saving',
}

// size: fixed output size (campaign stills match the video shape); otherwise image 1's shape.
export function editImage(
  instruction: string,
  seed: number,
  refs: ImageRef[],
  s: EditSettings,
  mask?: ImageRef,
  size?: { width: number; height: number },
): Workflow {
  const graph: Workflow = {
    unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux-2-klein-4b-Q5_K_M.gguf' } },
    clip: { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: 'Qwen_3_4b-imatrix-IQ4_XS.gguf', type: 'flux2' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: 'flux2_small_decoder.safetensors' } },
    prompt: { class_type: 'CLIPTextEncode', inputs: { text: instruction, clip: ['clip', 0] } },
    negative:
      s.cfg > 1
        ? { class_type: 'CLIPTextEncode', inputs: { text: s.negative, clip: ['clip', 0] } }
        : { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['prompt', 0] } },
  }

  let positive: [string, number] = ['prompt', 0]
  let negative: [string, number] = ['negative', 0]
  refs.slice(0, MAX_REFERENCES).forEach((ref, i) => {
    const n = i + 1
    graph[`load${n}`] = { class_type: 'LoadImage', inputs: { image: loadImageName(ref) } }
    graph[`scale${n}`] = {
      class_type: 'ImageScaleToTotalPixels',
      inputs: {
        image: [`load${n}`, 0],
        upscale_method: 'lanczos',
        megapixels: n === 1 ? s.megapixels : s.ref2Megapixels,
        resolution_steps: 16,
      },
    }
    // With a mask, Klein sees image 1 with the area greyed out.
    const pixels: [string, number] = n === 1 && mask ? ['hole', 0] : [`scale${n}`, 0]
    graph[`enc${n}`] = { class_type: 'VAEEncode', inputs: { pixels, vae: ['vae', 0] } }
    graph[`refpos${n}`] = { class_type: 'ReferenceLatent', inputs: { conditioning: positive, latent: [`enc${n}`, 0] } }
    graph[`refneg${n}`] = { class_type: 'ReferenceLatent', inputs: { conditioning: negative, latent: [`enc${n}`, 0] } }
    positive = [`refpos${n}`, 0]
    negative = [`refneg${n}`, 0]
  })

  let result: [string, number] = ['decode', 0]
  if (mask) {
    Object.assign(graph, {
      mask: { class_type: 'LoadImageMask', inputs: { image: loadImageName(mask), channel: 'red' } },
      grow: { class_type: 'GrowMask', inputs: { mask: ['mask', 0], expand: s.grow, tapered_corners: true } },
      grey: {
        class_type: 'EmptyImage',
        inputs: { width: ['size', 0], height: ['size', 1], batch_size: 1, color: 0x808080 },
      },
      hole: {
        class_type: 'ImageCompositeMasked',
        inputs: { destination: ['scale1', 0], source: ['grey', 0], x: 0, y: 0, resize_source: false, mask: ['grow', 0] },
      },
      edge: { class_type: 'MaskToImage', inputs: { mask: ['grow', 0] } },
      soften: { class_type: 'ImageBlur', inputs: { image: ['edge', 0], blur_radius: Math.max(1, s.feather), sigma: Math.max(0.1, s.feather / 2) } },
      softmask: { class_type: 'ImageToMask', inputs: { image: [s.feather > 0 ? 'soften' : 'edge', 0], channel: 'red' } },
      // One copy of the original per result, so every image in a batch gets pasted back.
      base: { class_type: 'RepeatImageBatch', inputs: { image: ['scale1', 0], amount: s.batch } },
      blend: {
        class_type: 'ImageCompositeMasked',
        inputs: { destination: ['base', 0], source: ['decode', 0], x: 0, y: 0, resize_source: false, mask: ['softmask', 0] },
      },
    })
    result = ['blend', 0]
  }

  const width = size ? size.width : ['size', 0]
  const height = size ? size.height : ['size', 1]
  return {
    ...graph,
    size: { class_type: 'GetImageSize', inputs: { image: ['scale1', 0] } },
    latent: { class_type: 'EmptyFlux2LatentImage', inputs: { width, height, batch_size: s.batch } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    pick: { class_type: 'KSamplerSelect', inputs: { sampler_name: s.sampler } },
    sigmas: { class_type: 'Flux2Scheduler', inputs: { steps: s.steps, width, height } },
    guider: { class_type: 'CFGGuider', inputs: { model: ['unet', 0], positive, negative, cfg: s.cfg } },
    sampler: {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['pick', 0], sigmas: ['sigmas', 0], latent_image: ['latent', 0] },
    },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } },
    save: { class_type: 'SaveImage', inputs: { images: result, filename_prefix: s.prefix || 'edit' } },
  }
}
