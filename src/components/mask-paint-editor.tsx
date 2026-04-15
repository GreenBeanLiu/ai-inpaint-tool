import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react'

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

type BrushMode = 'paint' | 'erase'

const DEFAULT_BRUSH_SIZE = 40
const MIN_BRUSH_SIZE = 8
const MAX_BRUSH_SIZE = 160
const BRUSH_STEP = 4
const DEFAULT_OVERLAY_OPACITY = 0.46
const PAINT_COLOR = '#d54837'
const BRUSH_PRESETS = [16, 32, 64, 96]

function clampBrushSize(value: number) {
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, value))
}

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

function drawBrushDot(
  context: CanvasRenderingContext2D,
  point: Point,
  brushSize: number,
  brushMode: BrushMode,
) {
  context.save()
  context.globalCompositeOperation = brushMode === 'erase' ? 'destination-out' : 'source-over'
  context.fillStyle = PAINT_COLOR
  context.beginPath()
  context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawBrushStroke(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  brushSize: number,
  brushMode: BrushMode,
) {
  context.save()
  context.globalCompositeOperation = brushMode === 'erase' ? 'destination-out' : 'source-over'
  context.strokeStyle = PAINT_COLOR
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = brushSize
  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(end.x, end.y)
  context.stroke()
  context.restore()
}

function canvasHasPaint(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) {
      return true
    }
  }

  return false
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
  const [brushMode, setBrushMode] = useState<BrushMode>('paint')
  const [overlayOpacity, setOverlayOpacity] = useState(DEFAULT_OVERLAY_OPACITY)
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)
  const [hasPaint, setHasPaint] = useState(false)

  useEffect(() => {
    sourceVersionRef.current += 1
    activePointerIdRef.current = null
    hasPaintRef.current = false
    lastPointRef.current = null
    setBrushMode('paint')
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

    if (!canvas || !dimensions) {
      onMaskChange(null)
      return
    }

    const context = canvas.getContext('2d')
    const nextHasPaint = context ? canvasHasPaint(context, canvas) : false
    hasPaintRef.current = nextHasPaint
    setHasPaint(nextHasPaint)

    if (!nextHasPaint) {
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

    if (!canvas || !dimensions || event.button !== 0) {
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
    drawBrushDot(context, point, brushSize, brushMode)
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
    drawBrushStroke(context, lastPointRef.current, point, brushSize, brushMode)
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

  function handleAdjustBrushSize(delta: number) {
    setBrushSize((current) => clampBrushSize(current + delta))
  }

  function handleCanvasKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    if (event.key === '[') {
      event.preventDefault()
      handleAdjustBrushSize(-BRUSH_STEP)
      return
    }

    if (event.key === ']') {
      event.preventDefault()
      handleAdjustBrushSize(BRUSH_STEP)
      return
    }

    if (event.key === 'b' || event.key === 'B') {
      event.preventDefault()
      setBrushMode('paint')
      return
    }

    if (event.key === 'e' || event.key === 'E') {
      event.preventDefault()
      setBrushMode('erase')
    }
  }

  return (
    <section className="mask-editor">
      <div className="mask-editor-header">
        <div>
          <h3 style={{ margin: 0 }}>Mask editor</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            Paint what should change, then switch to erase mode to trim the edge. The
            exported mask keeps the source dimensions and makes painted areas transparent.
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
            <div className="mask-editor-stage-badge">
              <strong>{brushMode === 'paint' ? 'Paint editable pixels' : 'Erasing mask edge'}</strong>
              <span>
                {brushMode === 'paint'
                  ? 'Red overlay becomes transparent in the exported PNG.'
                  : 'Erased overlay restores protected areas.'}
              </span>
            </div>
            <img
              alt="Source image for mask painting"
              className="mask-editor-image"
              src={sourceUrl}
            />
            <canvas
              className="mask-editor-canvas"
              ref={canvasRef}
              style={{ opacity: overlayOpacity }}
              tabIndex={0}
              onPointerCancel={finishStroke}
              onPointerDown={handlePointerDown}
              onKeyDown={handleCanvasKeyDown}
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
        <div className="mask-editor-toolbar">
          <div className="segmented-controls" role="group" aria-label="Mask tool">
            <button
              aria-pressed={brushMode === 'paint'}
              className="button button-secondary"
              type="button"
              onClick={() => setBrushMode('paint')}
            >
              Paint
            </button>
            <button
              aria-pressed={brushMode === 'erase'}
              className="button button-secondary"
              type="button"
              onClick={() => setBrushMode('erase')}
            >
              Erase
            </button>
          </div>

          <div className="brush-size-stepper">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => handleAdjustBrushSize(-BRUSH_STEP)}
            >
              Smaller
            </button>
            <span className="brush-size-chip">{brushSize}px</span>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => handleAdjustBrushSize(BRUSH_STEP)}
            >
              Larger
            </button>
          </div>
        </div>

        <label className="field">
          <span>Brush size</span>
          <input
            aria-label="Brush size"
            max={MAX_BRUSH_SIZE}
            min={MIN_BRUSH_SIZE}
            step={BRUSH_STEP}
            type="range"
            value={brushSize}
            onChange={(event) => setBrushSize(clampBrushSize(Number(event.target.value)))}
          />
        </label>
        <div className="mask-editor-presets" role="group" aria-label="Brush presets">
          {BRUSH_PRESETS.map((preset) => (
            <button
              aria-pressed={brushSize === preset}
              className="button button-secondary"
              key={preset}
              type="button"
              onClick={() => setBrushSize(preset)}
            >
              {preset}px
            </button>
          ))}
        </div>

        <label className="field">
          <span>Overlay opacity: {Math.round(overlayOpacity * 100)}%</span>
          <input
            aria-label="Mask overlay opacity"
            max={0.85}
            min={0.2}
            step={0.05}
            type="range"
            value={overlayOpacity}
            onChange={(event) => setOverlayOpacity(Number(event.target.value))}
          />
        </label>

        <div className="mask-editor-meta muted">
          <span>
            {dimensions ? `${dimensions.width} × ${dimensions.height}` : 'Source dimensions pending'}
          </span>
          <span>{hasPaint ? 'Mask ready for submit as PNG.' : 'Paint at least one region.'}</span>
          <span>Shortcuts: B paint, E erase, [ and ] resize.</span>
        </div>
      </div>
    </section>
  )
}
