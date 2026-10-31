import { loadImageName, type ImageRef, type Workflow } from '../api/comfy'

// Video with Wan 2.2 TI2V 5B Turbo, same graph as modes 6/6+/7 of ImageGen-SUPER.
// Anything longer than one 5 s window (121 frames) is sampled as overlapping windows
// (WanContextWindowsManual) that are blended in latent space: one clip, no seams.
// Every run also saves its last frame, which is where "Continue this video" picks up.

export type VideoLength = 5 | 10 | 15
export type VideoShape = 'landscape' | 'portrait'

export type VideoSettings = {
  length: VideoLength
  shape: VideoShape
  steps: number
  sampler: string
  scheduler: string
  shift: number
  overlap: number // frames shared by neighbouring windows
  prefix: string
}

export const VIDEO_RECOMMENDED = { steps: 4, sampler: 'euler', scheduler: 'simple', shift: 8, overlap: 30 }

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  length: 15,
  shape: 'landscape',
  ...VIDEO_RECOMMENDED,
  prefix: 'video/seg',
}

export const FPS = 24
export const WINDOW_FRAMES = 121

export const SHAPES: Record<VideoShape, { label: string; detail: string; width: number; height: number }> = {
  landscape: { label: 'Landscape 16:9', detail: '1280×704, 720p', width: 1280, height: 704 },
  portrait: { label: 'Portrait 9:16', detail: '704×1280, reels and stories', width: 704, height: 1280 },
}

export const frameCount = (seconds: number) => seconds * FPS + 1

// Minutes on this laptop (RTX 3060 6 GB) for a new clip or a continuation of that length
// (joining onto the old video adds only seconds). 5 s and 15 s were measured; 10 s is interpolated.
export const ESTIMATES: Record<VideoLength, { minutes: number; detail: string; measured: boolean }> = {
  5: { minutes: 9, detail: 'Generating about 3 to 7 min, turning into frames the rest. One pass.', measured: true },
  10: { minutes: 20, detail: 'Generating about 10 min in overlapping windows, turning into frames about 9 min.', measured: false },
  15: { minutes: 30, detail: 'Generating about 15 min in 5 overlapping windows, turning into frames about 14 min.', measured: true },
}

export function windowCount(frames: number, overlap: number): number {
  if (frames <= WINDOW_FRAMES) return 1
  return 1 + Math.ceil((frames - WINDOW_FRAMES) / (WINDOW_FRAMES - overlap))
}

export const VIDEO_STAGES: Record<string, string> = {
  unet: 'Loading the video model',
  clip: 'Loading the video model',
  vae: 'Loading the video model',
  prompt: 'Reading your prompt',
  negative: 'Reading your prompt',
  start: 'Reading the start frame',
  latent: 'Reading the start frame',
  sampler: 'Generating motion',
  decode: 'Turning it into frames',
  trim: 'Saving',
  last: 'Saving',
  lastframe: 'Saving',
  video: 'Saving the MP4',
  save: 'Saving the MP4',
  join: 'Joining onto your video',
}

type Options = {
  prompt: string
  seed: number
  settings: VideoSettings // for a continuation, length is how much to add
  start?: ImageRef // animate this picture (a continuation starts on the video's last frame)
  continueFrom?: ImageRef // the video so far; the new part is joined onto its end
}

export function videoWorkflow({ prompt, seed, settings: s, start, continueFrom }: Options): Workflow {
  const { width, height } = SHAPES[s.shape]
  const frames = frameCount(s.length)

  const graph: Workflow = {
    unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'Wan2_2-TI2V-5B-Turbo-Q5_K_M.gguf' } },
    clip: { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: 'umt5-xxl-encoder-Q5_K_M.gguf', type: 'wan' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: 'wan2.2_vae.safetensors' } },
    shift: { class_type: 'ModelSamplingSD3', inputs: { model: ['unet', 0], shift: s.shift } },
    windows: {
      class_type: 'WanContextWindowsManual',
      inputs: {
        model: ['shift', 0],
        context_length: WINDOW_FRAMES,
        context_overlap: s.overlap,
        context_schedule: 'standard_uniform',
        context_stride: 1,
        closed_loop: false,
        fuse_method: 'pyramid',
        freenoise: true,
        retain_first_frame: false,
        split_conds_to_windows: false,
      },
    },
    prompt: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['clip', 0] } },
    negative: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['prompt', 0] } },
    latent: {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: { vae: ['vae', 0], width, height, length: frames, batch_size: 1, ...(start ? { start_image: ['start', 0] } : {}) },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        model: ['windows', 0],
        positive: ['prompt', 0],
        negative: ['negative', 0],
        latent_image: ['latent', 0],
        seed,
        steps: s.steps,
        cfg: 1,
        sampler_name: s.sampler,
        scheduler: s.scheduler,
        denoise: 1,
      },
    },
    decode: {
      class_type: 'VAEDecodeTiled',
      inputs: { samples: ['sampler', 0], vae: ['vae', 0], tile_size: 512, overlap: 64, temporal_size: 32, temporal_overlap: 8 },
    },
    last: { class_type: 'ImageFromBatch', inputs: { image: ['decode', 0], batch_index: -1, length: 1 } },
    lastframe: { class_type: 'SaveImage', inputs: { images: ['last', 0], filename_prefix: 'lastframe' } },
  }
  if (start) graph.start = { class_type: 'LoadImage', inputs: { image: loadImageName(start) } }

  if (continueFrom) {
    // The new part starts on the old video's last frame; drop that repeat before joining.
    graph.trim = { class_type: 'ImageFromBatch', inputs: { image: ['decode', 0], batch_index: 1, length: 4096 } }
    graph.video = { class_type: 'CreateVideo', inputs: { images: ['trim', 0], fps: FPS } }
    const previous = continueFrom.subfolder ? `${continueFrom.subfolder}/${continueFrom.filename}` : continueFrom.filename
    graph.join = {
      class_type: 'SunprintJoinVideos',
      inputs: { video: ['video', 0], previous, filename_prefix: 'video/continued' },
    }
  } else {
    graph.video = { class_type: 'CreateVideo', inputs: { images: ['decode', 0], fps: FPS } }
    graph.save = {
      class_type: 'SaveVideo',
      inputs: { video: ['video', 0], filename_prefix: s.prefix || 'video/seg', format: 'auto', 'format.codec': 'auto' },
    }
  }
  return graph
}
