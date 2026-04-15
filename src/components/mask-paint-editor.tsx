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

interface WorkspaceSize {
  width: number
  height: number
}

type BrushMode = 'paint' | 'erase'

interface StrokeHistoryEntry {
  type: 'stroke'
  brushMode: BrushMode
  brushSize: number
  points: Point[]
}

interface ClearHistoryEntry {
  type: 'clear'
}

type HistoryEntry = StrokeHistoryEntry | ClearHistoryEntry

const DEFAULT_BRUSH_SIZE = 40
const MIN_BRUSH_SIZE = 8
const MAX_BRUSH_SIZE = 160
const BRUSH_STEP = 4
const DEFAULT_OVERLAY_OPACITY = 0.46
const PAINT_COLOR = '#d54837'
const BRUSH_PRESETS = [16, 32, 64, 96]
const MAX_HISTORY_ENTRIES = 80
const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

function clampBrushSize(value: number) {
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, value))
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
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

function getFittedStageSize(
  dimensions: ImageDimensions | null,
  workspaceSize: WorkspaceSize,
): ImageDimensions | null {
  if (!dimensions || workspaceSize.width <= 0 || workspaceSize.height <= 0) {
    return null
  }

  const scale = Math.min(
    workspaceSize.width / dimensions.width,
    workspaceSize.height / dimensions.height,
  )

  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  }
}

function clampPanOffset(
  offset: Point,
  zoom: number,
  stageSize: ImageDimensions | null,
  workspaceSize: WorkspaceSize,
) {
  if (!stageSize) {
    return { x: 0, y: 0 }
  }

  const horizontalOverflow = Math.max(0, (stageSize.width * zoom - workspaceSize.width) / 2)
  const verticalOverflow = Math.max(0, (stageSize.height * zoom - workspaceSize.height) / 2)

  return {
    x: Math.min(horizontalOverflow, Math.max(-horizontalOverflow, offset.x)),
    y: Math.min(verticalOverflow, Math.max(-verticalOverflow, offset.y)),
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

function renderStrokeEntry(context: CanvasRenderingContext2D, entry: StrokeHistoryEntry) {
  const [firstPoint] = entry.points

  if (!firstPoint) {
    return
  }

  drawBrushDot(context, firstPoint, entry.brushSize, entry.brushMode)

  for (let index = 1; index < entry.points.length; index += 1) {
    drawBrushStroke(
      context,
      entry.points[index - 1],
      entry.points[index],
      entry.brushSize,
      entry.brushMode,
    )
  }

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
  const sectionRef = useRef<HTMLElement | null>(null)
  const workspaceViewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeStrokePointerIdRef = useRef<number | null>(null)
  const activePanPointerIdRef = useRef<number | null>(null)
  const hasPaintRef = useRef(false)
  const strokePointsRef = useRef<Point[]>([])
  const strokeBrushModeRef = useRef<BrushMode>('paint')
  const strokeBrushSizeRef = useRef(DEFAULT_BRUSH_SIZE)
  const panPointerOriginRef = useRef<Point | null>(null)
  const panOffsetOriginRef = useRef<Point>({ x: 0, y: 0 })
  const sourceVersionRef = useRef(0)
  const historyEntriesRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(0)
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE)
  const [brushMode, setBrushMode] = useState<BrushMode>('paint')
  const [overlayOpacity, setOverlayOpacity] = useState(DEFAULT_OVERLAY_OPACITY)
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)
  const [workspaceSize, setWorkspaceSize] = useState<WorkspaceSize>({ width: 0, height: 0 })
  const [hasPaint, setHasPaint] = useState(false)
  const [historyLength, setHistoryLength] = useState(0)
  const [historyIndex, setHistoryIndex] = useState(0)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const stageSize = getFittedStageSize(dimensions, workspaceSize)
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < historyLength

  useEffect(() => {
    sourceVersionRef.current += 1
    activeStrokePointerIdRef.current = null
    activePanPointerIdRef.current = null
    hasPaintRef.current = false
    strokePointsRef.current = []
    strokeBrushModeRef.current = 'paint'
    strokeBrushSizeRef.current = DEFAULT_BRUSH_SIZE
    panPointerOriginRef.current = null
    historyEntriesRef.current = []
    historyIndexRef.current = 0
    setBrushMode('paint')
    setDimensions(null)
    setHasPaint(false)
    setHistoryLength(0)
    setHistoryIndex(0)
    setZoom(MIN_ZOOM)
    setPanOffset({ x: 0, y: 0 })
    setIsPanning(false)
    setIsSpacePressed(false)
    onMaskChange(null)
  }, [sourceUrl, onMaskChange])

  useEffect(() => {
    const viewport = workspaceViewportRef.current

    if (!viewport) {
      setWorkspaceSize({ width: 0, height: 0 })
      return
    }

    function measureWorkspace() {
      const nextViewport = workspaceViewportRef.current

      if (!nextViewport) {
        return
      }

      setWorkspaceSize({
        width: nextViewport.clientWidth,
        height: nextViewport.clientHeight,
      })
    }

    measureWorkspace()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureWorkspace)

      return () => {
        window.removeEventListener('resize', measureWorkspace)
      }
    }

    const observer = new ResizeObserver(() => {
      measureWorkspace()
    })

    observer.observe(viewport)

    return () => {
      observer.disconnect()
    }
  }, [sourceUrl, dimensions])

  useEffect(() => {
    setPanOffset((current) => clampPanOffset(current, zoom, stageSize, workspaceSize))
  }, [zoom, stageSize, workspaceSize])

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

  function syncHistoryState() {
    setHistoryLength(historyEntriesRef.current.length)
    setHistoryIndex(historyIndexRef.current)
  }

  function redrawCanvasFromHistory() {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)

    for (const entry of historyEntriesRef.current.slice(0, historyIndexRef.current)) {
      if (entry.type === 'clear') {
        context.clearRect(0, 0, canvas.width, canvas.height)
        continue
      }

      renderStrokeEntry(context, entry)
    }
  }

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

  async function applyHistoryState() {
    redrawCanvasFromHistory()
    await exportMaskFile(sourceVersionRef.current)
  }

  function pushHistoryEntry(entry: HistoryEntry) {
    const nextEntries = historyEntriesRef.current.slice(0, historyIndexRef.current)
    nextEntries.push(entry)

    if (nextEntries.length > MAX_HISTORY_ENTRIES) {
      nextEntries.splice(0, nextEntries.length - MAX_HISTORY_ENTRIES)
    }

    historyEntriesRef.current = nextEntries
    historyIndexRef.current = nextEntries.length
    syncHistoryState()
  }

  async function handleUndo() {
    if (activeStrokePointerIdRef.current != null || activePanPointerIdRef.current != null) {
      return
    }

    if (historyIndexRef.current === 0) {
      return
    }

    historyIndexRef.current -= 1
    syncHistoryState()
    await applyHistoryState()
  }

  async function handleRedo() {
    if (activeStrokePointerIdRef.current != null || activePanPointerIdRef.current != null) {
      return
    }

    if (historyIndexRef.current >= historyEntriesRef.current.length) {
      return
    }

    historyIndexRef.current += 1
    syncHistoryState()
    await applyHistoryState()
  }

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget
    setDimensions({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })
  }

  function handleZoomChange(nextZoom: number) {
    const clampedZoom = clampZoom(nextZoom)
    setZoom(clampedZoom)

    if (clampedZoom === MIN_ZOOM) {
      setPanOffset({ x: 0, y: 0 })
    }
  }

  function handleStartPan(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    activePanPointerIdRef.current = event.pointerId
    panPointerOriginRef.current = {
      x: event.clientX,
      y: event.clientY,
    }
    panOffsetOriginRef.current = panOffset
    setIsPanning(true)
    canvas.setPointerCapture(event.pointerId)
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current

    if (!canvas || !dimensions) {
      return
    }

    const shouldStartPan =
      zoom > MIN_ZOOM && (event.button === 1 || (event.button === 0 && isSpacePressed))

    if (shouldStartPan) {
      event.preventDefault()
      handleStartPan(event)
      return
    }

    if (event.button !== 0) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    event.preventDefault()

    const point = getCanvasPoint(canvas, event)
    activeStrokePointerIdRef.current = event.pointerId
    strokePointsRef.current = [point]
    strokeBrushModeRef.current = brushMode
    strokeBrushSizeRef.current = brushSize
    hasPaintRef.current = true
    setHasPaint(true)
    drawBrushDot(context, point, strokeBrushSizeRef.current, strokeBrushModeRef.current)
    canvas.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    if (
      activePanPointerIdRef.current === event.pointerId &&
      panPointerOriginRef.current &&
      stageSize
    ) {
      event.preventDefault()

      const deltaX = event.clientX - panPointerOriginRef.current.x
      const deltaY = event.clientY - panPointerOriginRef.current.y

      setPanOffset(
        clampPanOffset(
          {
            x: panOffsetOriginRef.current.x + deltaX,
            y: panOffsetOriginRef.current.y + deltaY,
          },
          zoom,
          stageSize,
          workspaceSize,
        ),
      )

      return
    }

    if (
      activeStrokePointerIdRef.current !== event.pointerId ||
      strokePointsRef.current.length === 0
    ) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    event.preventDefault()

    const point = getCanvasPoint(canvas, event)
    const previousPoint = strokePointsRef.current[strokePointsRef.current.length - 1]

    drawBrushStroke(
      context,
      previousPoint,
      point,
      strokeBrushSizeRef.current,
      strokeBrushModeRef.current,
    )
    strokePointsRef.current = [...strokePointsRef.current, point]
  }

  function releaseCanvasPointer(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }
  }

  async function finishInteraction(event: PointerEvent<HTMLCanvasElement>) {
    if (activePanPointerIdRef.current === event.pointerId) {
      event.preventDefault()
      releaseCanvasPointer(event)
      activePanPointerIdRef.current = null
      panPointerOriginRef.current = null
      setIsPanning(false)
      return
    }

    if (activeStrokePointerIdRef.current !== event.pointerId) {
      return
    }

    event.preventDefault()
    releaseCanvasPointer(event)

    const points = strokePointsRef.current
    activeStrokePointerIdRef.current = null
    strokePointsRef.current = []

    if (points.length === 0) {
      return
    }

    pushHistoryEntry({
      type: 'stroke',
      brushMode: strokeBrushModeRef.current,
      brushSize: strokeBrushSizeRef.current,
      points,
    })
    await exportMaskFile(sourceVersionRef.current)
  }

  async function handleClearMask() {
    const canvas = canvasRef.current

    if (!canvas || !hasPaintRef.current) {
      return
    }

    activeStrokePointerIdRef.current = null
    activePanPointerIdRef.current = null
    strokePointsRef.current = []
    panPointerOriginRef.current = null
    pushHistoryEntry({ type: 'clear' })
    setIsPanning(false)
    await applyHistoryState()
  }

  function handleAdjustBrushSize(delta: number) {
    setBrushSize((current) => clampBrushSize(current + delta))
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()

      if (event.shiftKey) {
        void handleRedo()
      } else {
        void handleUndo()
      }

      return
    }

    if (event.key === ' ') {
      if (document.activeElement === sectionRef.current) {
        event.preventDefault()
      }

      setIsSpacePressed(true)
      return
    }

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

  function handleEditorKeyUp(event: KeyboardEvent<HTMLElement>) {
    if (event.key === ' ') {
      event.preventDefault()
      setIsSpacePressed(false)
    }
  }

  return (
    <section
      className="mask-editor"
      ref={sectionRef}
      tabIndex={0}
      onBlur={() => setIsSpacePressed(false)}
      onKeyDown={handleEditorKeyDown}
      onKeyUp={handleEditorKeyUp}
      onPointerDownCapture={() => sectionRef.current?.focus()}
    >
      <div className="mask-editor-header">
        <div>
          <h3 style={{ margin: 0 }}>Mask editor</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            Paint what should change, then trim with erase mode. Undo/redo replays stroke
            history, and zoom keeps the exported mask at source resolution.
          </p>
        </div>
        <div className="mask-editor-toolbar">
          <button
            className="button button-secondary"
            disabled={!canUndo}
            type="button"
            onClick={() => void handleUndo()}
          >
            Undo
          </button>
          <button
            className="button button-secondary"
            disabled={!canRedo}
            type="button"
            onClick={() => void handleRedo()}
          >
            Redo
          </button>
          <button
            className="button button-secondary"
            disabled={!hasPaint}
            type="button"
            onClick={() => void handleClearMask()}
          >
            Clear mask
          </button>
        </div>
      </div>

      <div className="mask-editor-stage-frame">
        {sourceUrl && dimensions ? (
          <div className="mask-editor-workspace">
            <div className="mask-editor-workspace-toolbar">
              <div className="mask-editor-zoom-controls">
                <button
                  className="button button-secondary"
                  disabled={zoom <= MIN_ZOOM}
                  type="button"
                  onClick={() => handleZoomChange(zoom - ZOOM_STEP)}
                >
                  Zoom out
                </button>
                <span className="brush-size-chip">{Math.round(zoom * 100)}%</span>
                <button
                  className="button button-secondary"
                  disabled={zoom >= MAX_ZOOM}
                  type="button"
                  onClick={() => handleZoomChange(zoom + ZOOM_STEP)}
                >
                  Zoom in
                </button>
                <button
                  className="button button-secondary"
                  disabled={zoom === MIN_ZOOM && panOffset.x === 0 && panOffset.y === 0}
                  type="button"
                  onClick={() => {
                    handleZoomChange(MIN_ZOOM)
                    setPanOffset({ x: 0, y: 0 })
                  }}
                >
                  Reset view
                </button>
              </div>
              <span className="muted">
                Pan with middle-click or hold space and drag when zoomed in.
              </span>
            </div>
            <div className="mask-editor-workspace-viewport" ref={workspaceViewportRef}>
              {stageSize ? (
                <div
                  className="mask-editor-stage"
                  data-panning={isPanning ? 'true' : undefined}
                  style={{
                    height: `${stageSize.height}px`,
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                    width: `${stageSize.width}px`,
                  }}
                >
                  <div className="mask-editor-stage-badge">
                    <strong>
                      {brushMode === 'paint' ? 'Paint editable pixels' : 'Erasing mask edge'}
                    </strong>
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
                    data-space-panning={isSpacePressed ? 'true' : undefined}
                    ref={canvasRef}
                    style={{ opacity: overlayOpacity }}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerCancel={(event) => void finishInteraction(event)}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={(event) => void finishInteraction(event)}
                  />
                </div>
              ) : null}
            </div>
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
          <span>Shortcuts: Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo, B paint, E erase, [ and ] resize.</span>
        </div>
      </div>
    </section>
  )
}
