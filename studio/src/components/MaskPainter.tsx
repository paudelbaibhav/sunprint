import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react'

// Paint the area to change on top of image 1.
// The mask canvas (white strokes on transparent) is the single source of truth; the
// visible overlay is re-tinted from it, and the export is white-on-black for LoadImageMask.

export type MaskHandle = {
  exportMask: () => Promise<Blob | null>
  clear: () => void
}

type Props = {
  src: string
  width: number
  height: number
  hidden: boolean
  onChange: (hasMask: boolean) => void
  onDone: () => void
  ref?: Ref<MaskHandle>
}

type Tool = 'brush' | 'eraser'
type Point = { x: number; y: number }

const SUN = '#f4c542'
const MAX_SIDE = 1024 // the backend rescales the mask to the image anyway
const UNDO_LIMIT = 30

export function MaskPainter({ src, width, height, hidden, onChange, onDone, ref }: Props) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const cw = Math.max(1, Math.round(width * scale))
  const ch = Math.max(1, Math.round(height * scale))

  const viewRef = useRef<HTMLCanvasElement>(null)
  const [mask] = useState(() => {
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    return c
  })
  const undoStack = useRef<ImageData[]>([])
  const last = useRef<Point | null>(null)
  const [tool, setTool] = useState<Tool>('brush')
  const [size, setSize] = useState(6) // % of the image's longest side
  const [cursor, setCursor] = useState<{ x: number; y: number; d: number } | null>(null)
  const [canUndo, setCanUndo] = useState(false)

  const brushPx = (size / 100) * Math.max(cw, ch)
  const mctx = () => mask.getContext('2d', { willReadFrequently: true })!

  const render = () => {
    const v = viewRef.current?.getContext('2d')
    if (!v) return
    v.globalCompositeOperation = 'source-over'
    v.clearRect(0, 0, cw, ch)
    v.drawImage(mask, 0, 0)
    v.globalCompositeOperation = 'source-in'
    v.fillStyle = SUN
    v.fillRect(0, 0, cw, ch)
    v.globalCompositeOperation = 'source-over'
  }

  const report = () => {
    const data = mctx().getImageData(0, 0, cw, ch).data
    let any = false
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 0) {
        any = true
        break
      }
    }
    onChange(any)
  }

  const snapshot = () => {
    undoStack.current.push(mctx().getImageData(0, 0, cw, ch))
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
    setCanUndo(true)
  }

  const undo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    mctx().putImageData(prev, 0, 0)
    setCanUndo(undoStack.current.length > 0)
    render()
    report()
  }

  const clear = () => {
    snapshot()
    mctx().clearRect(0, 0, cw, ch)
    render()
    report()
  }

  const invert = () => {
    snapshot()
    const m = mctx()
    const inverted = document.createElement('canvas')
    inverted.width = cw
    inverted.height = ch
    const i = inverted.getContext('2d')!
    i.fillStyle = '#fff'
    i.fillRect(0, 0, cw, ch)
    i.globalCompositeOperation = 'destination-out'
    i.drawImage(mask, 0, 0)
    m.clearRect(0, 0, cw, ch)
    m.drawImage(inverted, 0, 0)
    render()
    report()
  }

  const stroke = (from: Point, to: Point) => {
    const m = mctx()
    m.globalCompositeOperation = tool === 'brush' ? 'source-over' : 'destination-out'
    m.strokeStyle = m.fillStyle = '#fff'
    m.lineWidth = brushPx
    m.lineCap = m.lineJoin = 'round'
    m.beginPath()
    m.arc(from.x, from.y, brushPx / 2, 0, Math.PI * 2)
    m.fill()
    m.beginPath()
    m.moveTo(from.x, from.y)
    m.lineTo(to.x, to.y)
    m.stroke()
    m.globalCompositeOperation = 'source-over'
    render()
  }

  const toCanvas = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      point: { x: ((e.clientX - r.left) * cw) / r.width, y: ((e.clientY - r.top) * ch) / r.height },
      css: { x: e.clientX - r.left, y: e.clientY - r.top, d: (brushPx * r.width) / cw },
    }
  }

  useImperativeHandle(ref, () => ({
    clear,
    exportMask: () =>
      new Promise((resolve) => {
        const out = document.createElement('canvas')
        out.width = cw
        out.height = ch
        const o = out.getContext('2d')!
        o.fillStyle = '#000'
        o.fillRect(0, 0, cw, ch)
        o.drawImage(mask, 0, 0)
        out.toBlob(resolve, 'image/png')
      }),
  }))

  // Shortcuts while painting: [ and ] resize, B / E switch tool, Ctrl+Z undoes.
  useEffect(() => {
    if (hidden) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input, select')) return
      if (e.key === '[') setSize((s) => Math.max(1, s - 1))
      else if (e.key === ']') setSize((s) => Math.min(30, s + 1))
      else if (e.key === 'b' || e.key === 'B') setTool('brush')
      else if (e.key === 'e' || e.key === 'E') setTool('eraser')
      else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        undo()
      } else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="painter" hidden={hidden}>
      <div className="print-area">
      <figure className="print" style={{ aspectRatio: `${width} / ${height}`, ['--ratio' as string]: width / height }}>
        <div className="print-surface">
          <img className="print-image instant" src={src} alt="Image 1" draggable={false} />
          <canvas
            ref={viewRef}
            className="mask-view"
            data-tool={tool}
            width={cw}
            height={ch}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              snapshot()
              const { point } = toCanvas(e)
              last.current = point
              stroke(point, point)
            }}
            onPointerMove={(e) => {
              const { point, css } = toCanvas(e)
              setCursor(css)
              if (!last.current) return
              stroke(last.current, point)
              last.current = point
            }}
            onPointerUp={() => {
              if (!last.current) return
              last.current = null
              report()
            }}
            onPointerLeave={() => setCursor(null)}
          />
          {cursor && (
            <span
              className="brush-cursor"
              data-tool={tool}
              style={{ left: cursor.x, top: cursor.y, width: cursor.d, height: cursor.d }}
            />
          )}
        </div>
      </figure>
      </div>

      <div className="paint-tools" role="toolbar" aria-label="Selection tools">
        <div className="segmented tool-toggle" role="radiogroup" aria-label="Tool">
          <button type="button" role="radio" aria-checked={tool === 'brush'} onClick={() => setTool('brush')} title="Brush (B)">
            Paint
          </button>
          <button type="button" role="radio" aria-checked={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser (E)">
            Erase
          </button>
        </div>
        <label className="brush-size">
          <span>Brush</span>
          <input type="range" min={1} max={30} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <button type="button" className="text-button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" className="text-button" onClick={invert} title="Select everything except what you painted">
          Invert
        </button>
        <button type="button" className="text-button" onClick={clear}>
          Clear
        </button>
        <button type="button" className="text-button done" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="note paint-hint">Paint over the area to change. Keys: B paint, E erase, [ and ] brush size, Ctrl+Z undo.</p>
    </div>
  )
}
