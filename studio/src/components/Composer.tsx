import { useRef, useState, type RefObject } from 'react'
import type { ImageRef } from '../api/comfy'

// An image attached to the prompt. Uploads show right away from a local preview.
export type Attachment = { id: string; preview: string; width: number; height: number; name: string } & (
  | { status: 'uploading' }
  | { status: 'ready'; ref: ImageRef }
  | { status: 'error'; message: string }
)

type Props = {
  prompt: string
  onPrompt: (v: string) => void
  attachments: Attachment[]
  maxAttachments: number
  onAddFiles: (files: File[]) => void
  onRemove: (id: string) => void
  onSubmit: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  hasMask: boolean
  selecting: boolean
  onSelectArea: () => void
  video: boolean // video mode: one optional start frame, no area selection
  extending: number | null // video mode: length of the video being continued
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}

export function Composer(props: Props) {
  const { prompt, onPrompt, attachments, maxAttachments, onAddFiles, onRemove, onSubmit, inputRef, hasMask, selecting, onSelectArea, video, extending } = props
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const editing = !video && attachments.length > 0
  const full = attachments.length >= maxAttachments

  const label = video
    ? extending !== null
      ? 'What happens next'
      : 'Describe the shot: scene, action, camera'
    : hasMask
      ? 'What goes in the selected area'
      : editing
        ? 'Describe the change'
        : 'Describe your image'
  const placeholder = video
    ? extending !== null
      ? 'The boat turns slowly toward the shore as the sun rises higher'
      : 'A small fishing boat drifts on a calm lake at sunrise, mist over the water, slow dolly forward'
    : hasMask
      ? 'A straw sun hat, or leave empty and use Remove to erase what you painted'
      : editing
        ? attachments.length > 1
          ? 'Put the jacket from image 2 on the person in image 1'
          : 'Make the jacket red and keep everything else the same'
        : 'A lighthouse at dusk, waves breaking on the rocks, shot on 35mm film'
  const attachmentLabel = (i: number) =>
    video ? (extending !== null ? `Last frame of your ${extending} s video` : 'Start frame') : i === 0 && hasMask ? 'Image 1, area selected' : `Image ${i + 1}`

  return (
    <div
      className="composer"
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files') || full) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        onAddFiles(imageFiles(e.dataTransfer.files))
      }}
    >
      <label className="composer-label" htmlFor="prompt">
        {label}
      </label>

      {attachments.length > 0 && (
        <ul className="attachments" aria-label="Attached images">
          {attachments.map((a, i) => (
            <li key={a.id} className="attachment" data-status={a.status}>
              <img src={a.preview} alt={a.name} />
              <span className="attachment-label">
                {a.status === 'uploading' ? 'Uploading…' : a.status === 'error' ? "Couldn't upload" : attachmentLabel(i)}
              </span>
              <button type="button" className="attachment-remove" onClick={() => onRemove(a.id)} aria-label={`Remove ${attachmentLabel(i).toLowerCase()}`}>
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        id="prompt"
        ref={inputRef}
        value={prompt}
        onChange={(e) => onPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSubmit()
        }}
        onPaste={(e) => {
          const files = imageFiles(e.clipboardData.files)
          if (files.length && !full) {
            e.preventDefault()
            onAddFiles(files)
          }
        }}
        placeholder={placeholder}
        rows={4}
      />

      <div className="composer-bar">
        {!(video && full) && (
          <button type="button" className="attach" onClick={() => picker.current?.click()} disabled={full}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {video ? 'Start from an image' : editing ? 'Add a second image' : 'Add image to edit'}
          </button>
        )}
        {editing && (
          <button type="button" className="attach" aria-pressed={selecting} onClick={onSelectArea}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M4 16c3-1 4-3 5-6l5-5a1.8 1.8 0 0 1 2.5 2.5l-5 5c-3 1-5 2-6 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {hasMask ? 'Edit selection' : 'Select area'}
          </button>
        )}
        {full && !video && <span className="composer-note">Up to {maxAttachments} images</span>}
        {video && full && <span className="composer-note">The video starts on this picture and moves from there.</span>}
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onAddFiles(imageFiles(e.target.files))
          e.target.value = ''
        }}
      />

      {dragging && <div className="drop-hint">{video ? 'Drop to start the video from this picture' : 'Drop to use as a reference'}</div>}
    </div>
  )
}
