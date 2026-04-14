import { useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from 'react'

interface MaskPaintEditorProps {
  sourceFile: File | null
  sourceUrl: string | null
  onMaskChange: (file: File | null) => void
}

interface Point {
  x: number
  y: number
}

interface ImageDimensions {
  width: number
  height: number
}

const DEFAULT_BRUSH_SIZE = 40
const MIN_BRUSH_SIZE = 8
const MAX_BRUSH_SIZE = 160

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
}

function getMaskFilename(sourceFile: File | null) {
  const baseName = sourceFile ? stripExtension(sourceFile.name) : 'mask'
  const safeBaseName = baseName.trim() || 'mask'
  return `${safeBaseName}-mask.png`
}

function getCanvasPoint(canvas: HTMLCanvasElement, event: PointerEvent<HTMLCanvasElement>): Point {
  const bounds = canvas.getBoundingClientRect()
  const scaleX = canvas.width / bounds.width
  const scaleY = canvas.height / bounds.height

  return {
    x: (event.clientX - bounds.left) * scaleX,
    y: (event.clientY - bounds.top) * scaleY,
  }
}

function drawBrushDot(context: CanvasRenderingContext2D, point: Point, brushSize: number) {
  context.fillStyle = '#d54837'
  context.beginPath()
  context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2)
  context.fill()
}

function drawBrushStroke(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  brushSize: number,
) {
  context.strokeStyle = '#d54837'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = brushSize
  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(end.x, end.y)
  context.stroke()
}

export function MaskPaintEditor({
  sourceFile,
  sourceUrl,
  onMaskChange,
}: Readonly<MaskPaintEditorProps>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const hasPaintRef = useRef(false)
  const lastPointRef = useRef<Point | null>(null)
  const sourceVersionRef = useRef(0)
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE)
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)
  const [hasPaint, setHasPaint] = useState(false)

  useEffect(() => {
    sourceVersionRef.current += 1
    activePointerIdRef.current = null
    hasPaintRef.current = false
    lastPointRef.current = null
    setDimensions(null)
    setHasPaint(false)
    onMaskChange(null)
  }, [sourceUrl, onMaskChange])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas || !dimensions) {
      return
    }

    canvas.width = dimensions.width
    canvas.height = dimensions.height

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
  }, [dimensions])

  async function exportMaskFile(version: number) {
    const canvas = canvasRef.current

    if (!canvas || !dimensions || !hasPaintRef.current) {
      onMaskChange(null)
      return
    }

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = dimensions.width
    exportCanvas.height = dimensions.height

    const exportContext = exportCanvas.getContext('2d')

    if (!exportContext) {
      throw new Error('Mask export is unavailable in this browser')
    }

    exportContext.fillStyle = '#ffffff'
    exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    exportContext.globalCompositeOperation = 'destination-out'
    exportContext.drawImage(canvas, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => {
      exportCanvas.toBlob(resolve, 'image/png')
    })

    if (!blob) {
      throw new Error('Failed to export the painted mask')
    }

    if (version !== sourceVersionRef.current) {
      return
    }

    onMaskChange(
      new File([blob], getMaskFilename(sourceFile), {
        type: 'image/png',
      }),
    )
  }

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget
    setDimensions({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current

    if (!canvas || !dimensions) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    event.preventDefault()

    const point = getCanvasPoint(canvas, event)
    activePointerIdRef.current = event.pointerId
    hasPaintRef.current = true
    lastPointRef.current = point
    setHasPaint(true)
    drawBrushDot(context, point, brushSize)
    canvas.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current

    if (!canvas || activePointerIdRef.current !== event.pointerId || !lastPointRef.current) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    event.preventDefault()

    const point = getCanvasPoint(canvas, event)
    drawBrushStroke(context, lastPointRef.current, point, brushSize)
    lastPointRef.current = point
  }

  function finishStroke(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current

    if (!canvas || activePointerIdRef.current !== event.pointerId) {
      return
    }

    event.preventDefault()

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }

    activePointerIdRef.current = null
    lastPointRef.current = null
    void exportMaskFile(sourceVersionRef.current)
  }

  function handleClearMask() {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
    activePointerIdRef.current = null
    hasPaintRef.current = false
    lastPointRef.current = null
    setHasPaint(false)
    onMaskChange(null)
  }

  return (
    <section className="mask-editor">
      <div className="mask-editor-header">
        <div>
          <h3 style={{ margin: 0 }}>Mask editor</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            Paint the editable region directly on the source image. The exported mask keeps
            the source dimensions and uses transparent painted areas.
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={handleClearMask}>
          Clear mask
        </button>
      </div>

      <div className="mask-editor-stage-frame">
        {sourceUrl && dimensions ? (
          <div
            className="mask-editor-stage"
            style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
          >
            <img
              alt="Source image for mask painting"
              className="mask-editor-image"
              src={sourceUrl}
            />
            <canvas
              className="mask-editor-canvas"
              ref={canvasRef}
              onPointerCancel={finishStroke}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishStroke}
            />
          </div>
        ) : sourceUrl ? (
          <div className="image-preview-empty muted">Loading source image editor...</div>
        ) : (
          <div className="image-preview-empty muted">
            Choose a source image to unlock the in-browser mask editor.
          </div>
        )}

        {sourceUrl ? (
          <img
            alt=""
            className="mask-editor-preload"
            src={sourceUrl}
            onLoad={handleImageLoad}
          />
        ) : null}
      </div>

      <div className="mask-editor-controls">
        <label className="field">
          <span>Brush size: {brushSize}px</span>
          <input
            aria-label="Brush size"
            max={MAX_BRUSH_SIZE}
            min={MIN_BRUSH_SIZE}
            type="range"
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
        </label>
        <div className="mask-editor-meta muted">
          <span>
            {dimensions ? `${dimensions.width} × ${dimensions.height}` : 'Source dimensions pending'}
          </span>
          <span>{hasPaint ? 'Mask ready for submit as PNG.' : 'Paint at least one region.'}</span>
        </div>
      </div>
    </section>
  )
}
