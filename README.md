# Sunprint

A local image and video studio on top of [ComfyUI](https://github.com/comfyanonymous/ComfyUI).
One prompt box, no node graphs: type, attach a photo if you want, press generate.
Everything runs on your own GPU. It was built and tested on a 6 GB laptop RTX 3060.

## What it does

- **Text to image** with Z-Image Turbo or FLUX.2 Klein. Size presets or custom sizes, 1–4 images
  per run, steps, guidance, negative prompt, sampler and scheduler (read live from ComfyUI), seed.
- **Edit images**: attach one or two images (button, drag and drop, or paste) and the prompt
  becomes an instruction for FLUX.2 Klein. "Edit this" and "Keep editing" chain results.
- **Masked edits**: paint over part of the image and only that area is regenerated and blended
  back in with a feathered edge.
- **Video** with Wan 2.2 TI2V 5B Turbo: 5, 10 or 15 s, landscape or portrait, with an optional
  start frame. **Continue this video** adds another 5–15 s from the last frame and joins the parts
  without re-encoding, so there is no length limit.
- **Campaign mode**: give it a product photo and a description. It plans a set of shots, makes a
  still for each one (with your product as the reference), lets you review and redo stills, animates
  each one and joins the clips into a single ad video. Clips whose still, motion or length didn't
  change are reused when you run it again.

All runs share one history in the browser.

## Requirements

- Windows (the one-click launcher is PowerShell; the studio itself is cross-platform, see below)
- An NVIDIA GPU. 6 GB of VRAM is enough because the models are GGUF-quantised.
- [Node.js](https://nodejs.org) 20 or newer
- A recent ComfyUI (0.34 or newer; it needs the FLUX.2, Wan 2.2 and context-window nodes)
- The [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) custom node

## Setup

1. Clone this repo, then install ComfyUI into a folder called `ComfyUI` inside it, with its
   virtual environment at `ComfyUI\venv`:

   ```powershell
   git clone https://github.com/paudelbaibhav/sunprint
   cd sunprint
   git clone https://github.com/comfyanonymous/ComfyUI
   cd ComfyUI
   python -m venv venv
   .\venv\Scripts\pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
   .\venv\Scripts\pip install -r requirements.txt
   git clone https://github.com/city96/ComfyUI-GGUF custom_nodes\ComfyUI-GGUF
   .\venv\Scripts\pip install -r custom_nodes\ComfyUI-GGUF\requirements.txt
   cd ..
   ```

   Already have ComfyUI somewhere else? Set `SUNPRINT_COMFYUI` to its folder instead
   (for example `setx SUNPRINT_COMFYUI D:\ComfyUI`). It must have a `venv` folder.

2. Download the models (about 19 GB; files already present are skipped):

   ```powershell
   .\download-models.bat
   ```

3. Double-click **`Sunprint.bat`**.

The launcher starts ComfyUI (or reuses one already running on port 8188), copies the Sunprint
custom node into ComfyUI, installs and builds the studio on first run, and opens
http://127.0.0.1:5173. Closing the window, or pressing Q, stops everything it started.
Logs go to `logs\`.

## Models

| Used for | Model |
|---|---|
| Text to image | [Z-Image Turbo GGUF](https://huggingface.co/unsloth/Z-Image-Turbo-GGUF) |
| Editing, masked edits, campaign stills | [FLUX.2 Klein 4B GGUF](https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF) |
| Video | [Wan 2.2 TI2V 5B Turbo GGUF](https://huggingface.co/hum-ma/Wan2.2-TI2V-5B-Turbo-GGUF) |

Plus the text encoders and VAEs listed in `download-models.bat`. Check each model's license on
its Hugging Face page before using the output commercially.

## Running without the launcher

On Linux or macOS, or to work on the studio:

1. Copy `custom_nodes/sunprint_join_videos.py` into ComfyUI's `custom_nodes` folder.
2. Start ComfyUI on port 8188.
3. In `studio/`: `npm install`, then `npm run dev`.

The dev server forwards `/api` (HTTP and the progress websocket) to ComfyUI and rewrites the
`Origin` header, because ComfyUI rejects cross-origin POSTs.

## How it's built

```
studio/src/
  workflows/   one file per mode; each builds a ComfyUI API-format graph
               (textToImage, editImage, video, campaign)
  hooks/       useStudio runs every job and keeps the history; useCampaign runs campaigns
  components/  prompt box, settings panels, mask painter, video player, storyboard
  api/comfy.ts ComfyUI HTTP + websocket client
custom_nodes/sunprint_join_videos.py
               SunprintJoinVideos / SunprintConcatVideos: join MP4s by copying packets
```

The node ids in each workflow graph double as the progress stages shown in the UI.

## License

MIT. See [LICENSE](LICENSE).
