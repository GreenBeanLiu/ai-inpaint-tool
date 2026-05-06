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
  initialMaskUrl?: string | null
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

interface StageViewportRect {
  x: number
  y: number
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

type HistoryEntry = StrokeHistoryEntry

const DEFAULT_BRUSH_SIZE = 16
const MIN_BRUSH_SIZE = 8
const MAX_BRUSH_SIZE = 160
const BRUSH_STEP = 4
const BRUSH_PRESETS = [8, DEFAULT_BRUSH_SIZE, 40] as const
const MASK_OVERLAY_OPACITY = 0.44
const PAINT_COLOR = '#d54837'
const MAX_HISTORY_ENTRIES = 80
const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25
const MINIMAP_MAX_SIZE = 168
const FIT_VIEW_PADDING = 28

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function clampBrushSize(value: number) {
  return clampNumber(value, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE)
}

function clampZoom(value: number) {
  return clampNumber(value, MIN_ZOOM, MAX_ZOOM)
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
    x: clampNumber((event.clientX - bounds.left) * scaleX, 0, canvas.width),
    y: clampNumber((event.clientY - bounds.top) * scaleY, 0, canvas.height),
  }
}

function getFittedStageSize(
  dimensions: ImageDimensions | null,
  workspaceSize: WorkspaceSize,
  padding = 0,
): ImageDimensions | null {
  if (!dimensions || workspaceSize.width <= 0 || workspaceSize.height <= 0) {
    return null
  }

  const availableWidth = Math.max(1, workspaceSize.width - padding * 2)
  const availableHeight = Math.max(1, workspaceSize.height - padding * 2)

  const scale = Math.min(
    availableWidth / dimensions.width,
    availableHeight / dimensions.height,
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
    x: clampNumber(offset.x, -horizontalOverflow, horizontalOverflow),
    y: clampNumber(offset.y, -verticalOverflow, verticalOverflow),
  }
}

function getVisibleStageRect(
  stageSize: ImageDimensions | null,
  workspaceSize: WorkspaceSize,
  zoom: number,
  panOffset: Point,
): StageViewportRect | null {
  if (!stageSize) {
    return null
  }

  const width = clampNumber(workspaceSize.width / zoom, 1, stageSize.width)
  const height = clampNumber(workspaceSize.height / zoom, 1, stageSize.height)

  return {
    x: clampNumber(
      (stageSize.width - width) / 2 - panOffset.x / zoom,
      0,
      Math.max(0, stageSize.width - width),
    ),
    y: clampNumber(
      (stageSize.height - height) / 2 - panOffset.y / zoom,
      0,
      Math.max(0, stageSize.height - height),
    ),
    width,
    height,
  }
}

function getPanOffsetForViewportCenter(
  center: Point,
  stageSize: ImageDimensions | null,
  workspaceSize: WorkspaceSize,
  zoom: number,
) {
  if (!stageSize) {
    return { x: 0, y: 0 }
  }

  const visibleWidth = clampNumber(workspaceSize.width / zoom, 1, stageSize.width)
  const visibleHeight = clampNumber(workspaceSize.height / zoom, 1, stageSize.height)
  const left = clampNumber(center.x - visibleWidth / 2, 0, Math.max(0, stageSize.width - visibleWidth))
  const top = clampNumber(center.y - visibleHeight / 2, 0, Math.max(0, stageSize.height - visibleHeight))

  return clampPanOffset(
    {
      x: ((stageSize.width - visibleWidth) / 2 - left) * zoom,
      y: ((stageSize.height - visibleHeight) / 2 - top) * zoom,
    },
    zoom,
    stageSize,
    workspaceSize,
  )
}

function getRelativeStagePoint(
  element: HTMLElement,
  event: { clientX: number; clientY: number },
  stageSize: ImageDimensions,
): Point {
  const bounds = element.getBoundingClientRect()
  const relativeX = clampNumber(event.clientX - bounds.left, 0, bounds.width)
  const relativeY = clampNumber(event.clientY - bounds.top, 0, bounds.height)

  return {
    x: (relativeX / bounds.width) * stageSize.width,
    y: (relativeY / bounds.height) * stageSize.height,
  }
}

function isPointWithinElementBounds(
  element: HTMLElement,
  event: { clientX: number; clientY: number },
) {
  const bounds = element.getBoundingClientRect()

  return (
    event.clientX >= bounds.left &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom
  )
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
  initialMaskUrl = null,
  onMaskChange,
}: Readonly<MaskPaintEditorProps>) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const workspaceViewportRef = useRef<HTMLDivElement | null>(null)
  const minimapRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeStrokePointerIdRef = useRef<number | null>(null)
  const activePanPointerIdRef = useRef<number | null>(null)
  const activeMinimapPointerIdRef = useRef<number | null>(null)
  const hasPaintRef = useRef(false)
  const shouldAutoFitViewportRef = useRef(true)
  const strokePointsRef = useRef<Point[]>([])
  const strokeBrushModeRef = useRef<BrushMode>('paint')
  const strokeBrushSizeRef = useRef(DEFAULT_BRUSH_SIZE)
  const panPointerOriginRef = useRef<Point | null>(null)
  const panOffsetOriginRef = useRef<Point>({ x: 0, y: 0 })
  const sourceVersionRef = useRef(0)
  const baseMaskImageRef = useRef<HTMLImageElement | null>(null)
  const historyEntriesRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(0)
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE)
  const [brushMode, setBrushMode] = useState<BrushMode>('paint')
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)
  const [workspaceSize, setWorkspaceSize] = useState<WorkspaceSize>({ width: 0, height: 0 })
  const [hasPaint, setHasPaint] = useState(false)
  const [historyLength, setHistoryLength] = useState(0)
  const [historyIndex, setHistoryIndex] = useState(0)
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isPainting, setIsPainting] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isNavigatingMinimap, setIsNavigatingMinimap] = useState(false)
  const [expandedPanel, setExpandedPanel] = useState<'brush' | 'view' | null>('brush')
  const stageSize = getFittedStageSize(dimensions, workspaceSize, FIT_VIEW_PADDING)
  const minimapSize = getFittedStageSize(dimensions, {
    width: MINIMAP_MAX_SIZE,
    height: MINIMAP_MAX_SIZE,
  })
  const visibleStageRect = getVisibleStageRect(stageSize, workspaceSize, zoom, panOffset)
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < historyLength
  const canNavigateMinimap =
    Boolean(
      stageSize &&
        minimapSize &&
        visibleStageRect &&
        (visibleStageRect.width < stageSize.width || visibleStageRect.height < stageSize.height),
    )

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
    shouldAutoFitViewportRef.current = true
    setBrushMode('paint')
    setDimensions(null)
    setHasPaint(false)
    setHistoryLength(0)
    setHistoryIndex(0)
    setHoverPoint(null)
    setZoom(MIN_ZOOM)
    setPanOffset({ x: 0, y: 0 })
    setIsPainting(false)
    setIsPanning(false)
    setIsNavigatingMinimap(false)
    setIsSpacePressed(false)
    setExpandedPanel('brush')
    baseMaskImageRef.current = null
  }, [sourceUrl, initialMaskUrl])

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
    if (shouldAutoFitViewportRef.current) {
      setZoom(MIN_ZOOM)
      setPanOffset({ x: 0, y: 0 })
      return
    }

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

  useEffect(() => {
    const version = sourceVersionRef.current

    if (!sourceUrl || !initialMaskUrl) {
      baseMaskImageRef.current = null
      void applyHistoryState({ emitMaskChange: false })
      return
    }

    const image = new Image()

    image.onload = () => {
      if (version !== sourceVersionRef.current) {
        return
      }

      baseMaskImageRef.current = image
      void applyHistoryState({ emitMaskChange: false })
    }

    image.onerror = () => {
      if (version !== sourceVersionRef.current) {
        return
      }

      baseMaskImageRef.current = null
      void applyHistoryState({ emitMaskChange: false })
    }

    image.src = initialMaskUrl
  }, [sourceUrl, initialMaskUrl, dimensions])

  function syncHistoryState() {
    setHistoryLength(historyEntriesRef.current.length)
    setHistoryIndex(historyIndexRef.current)
  }

  function renderBaseMask(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const baseMaskImage = baseMaskImageRef.current

    if (!baseMaskImage) {
      return
    }

    context.save()
    context.globalCompositeOperation = 'source-over'
    context.drawImage(baseMaskImage, 0, 0, canvas.width, canvas.height)
    context.restore()
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
    renderBaseMask(context, canvas)

    for (const entry of historyEntriesRef.current.slice(0, historyIndexRef.current)) {
      renderStrokeEntry(context, entry)
    }
  }

  async function syncMaskOutput(version: number, emitMaskChange: boolean) {
    const canvas = canvasRef.current

    if (!canvas || !dimensions) {
      if (emitMaskChange) {
        onMaskChange(null)
      }
      return
    }

    const context = canvas.getContext('2d')
    const nextHasPaint = context ? canvasHasPaint(context, canvas) : false
    hasPaintRef.current = nextHasPaint
    setHasPaint(nextHasPaint)

    if (!nextHasPaint) {
      if (emitMaskChange) {
        onMaskChange(null)
      }
      return
    }

    if (!emitMaskChange) {
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

  async function applyHistoryState(options?: { emitMaskChange?: boolean }) {
    const emitMaskChange = options?.emitMaskChange ?? true
    redrawCanvasFromHistory()
    await syncMaskOutput(sourceVersionRef.current, emitMaskChange)
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

  function handleFitView() {
    shouldAutoFitViewportRef.current = true
    setZoom(MIN_ZOOM)
    setPanOffset({ x: 0, y: 0 })
  }

  function handleZoomChange(nextZoom: number) {
    shouldAutoFitViewportRef.current = false
    const clampedZoom = clampZoom(nextZoom)
    setZoom(clampedZoom)
    setPanOffset((current) => clampPanOffset(current, clampedZoom, stageSize, workspaceSize))
  }

  function handleStartPan(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    shouldAutoFitViewportRef.current = false
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
    const stage = stageRef.current

    if (!canvas || !dimensions) {
      return
    }

    const shouldStartPan =
      zoom > MIN_ZOOM && (event.button === 1 || (event.button === 0 && isSpacePressed))

    if (shouldStartPan) {
      event.preventDefault()
      setHoverPoint(null)
      handleStartPan(event)
      return
    }

    const isPrimaryStroke = event.button === 0
    const isSecondaryEraseStroke = event.button === 2

    if (!isPrimaryStroke && !isSecondaryEraseStroke) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    event.preventDefault()

    const point = stage
      ? getRelativeStagePoint(stage, event, dimensions)
      : getCanvasPoint(canvas, event)
    setHoverPoint(point)
    activeStrokePointerIdRef.current = event.pointerId
    strokePointsRef.current = [point]
    strokeBrushModeRef.current = isSecondaryEraseStroke ? 'erase' : brushMode
    strokeBrushSizeRef.current = brushSize
    hasPaintRef.current = true
    setHasPaint(true)
    setIsPainting(true)
    drawBrushDot(context, point, strokeBrushSizeRef.current, strokeBrushModeRef.current)
    canvas.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const stage = stageRef.current

    if (!canvas || !dimensions) {
      return
    }

    if (
      activePanPointerIdRef.current === event.pointerId &&
      panPointerOriginRef.current &&
      stageSize
    ) {
      event.preventDefault()
      setHoverPoint(null)

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

    if (stage && !isPointWithinElementBounds(stage, event)) {
      setHoverPoint(null)

      if (activeStrokePointerIdRef.current === event.pointerId) {
        void finishInteraction(event)
      }

      return
    }

    const point = stage
      ? getRelativeStagePoint(stage, event, dimensions)
      : getCanvasPoint(canvas, event)
    setHoverPoint(point)

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
    setIsPainting(false)

    if (points.length === 0) {
      return
    }

    pushHistoryEntry({
      type: 'stroke',
      brushMode: strokeBrushModeRef.current,
      brushSize: strokeBrushSizeRef.current,
      points,
    })
    await syncMaskOutput(sourceVersionRef.current, true)
  }

  function updateViewportFromMinimap(event: PointerEvent<HTMLDivElement>) {
    const minimap = minimapRef.current

    if (!minimap || !stageSize) {
      return
    }

    const point = getRelativeStagePoint(minimap, event, stageSize)
    setPanOffset(getPanOffsetForViewportCenter(point, stageSize, workspaceSize, zoom))
  }

  function handleMinimapPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canNavigateMinimap || !stageSize) {
      return
    }

    event.preventDefault()
    shouldAutoFitViewportRef.current = false
    activeMinimapPointerIdRef.current = event.pointerId
    setIsNavigatingMinimap(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    updateViewportFromMinimap(event)
  }

  function handleMinimapPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (
      !canNavigateMinimap ||
      !stageSize ||
      activeMinimapPointerIdRef.current !== event.pointerId
    ) {
      return
    }

    event.preventDefault()
    updateViewportFromMinimap(event)
  }

  function handleMinimapPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (activeMinimapPointerIdRef.current !== event.pointerId) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    activeMinimapPointerIdRef.current = null
    setIsNavigatingMinimap(false)
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

  const visibleCoverage =
    stageSize && visibleStageRect
      ? clampNumber(
          Math.round(
            ((visibleStageRect.width * visibleStageRect.height) /
              (stageSize.width * stageSize.height)) *
              100,
          ),
          1,
          100,
        )
      : 100
  const brushPreviewSize =
    stageSize && dimensions ? Math.max(14, (brushSize / dimensions.width) * stageSize.width) : 0
  const showBrushPreview =
    Boolean(stageSize && dimensions && hoverPoint && !isPanning && !isSpacePressed)
  const canResetView = zoom > MIN_ZOOM || panOffset.x !== 0 || panOffset.y !== 0
  const brushModeLabel = brushMode === 'paint' ? 'Mark' : 'Erase'
  const brushPreviewChipSize = clampNumber(Math.round(brushSize * 0.3), 10, 34)
  const viewHint = zoom > MIN_ZOOM ? `${visibleCoverage}% visible` : 'Fitted'
  const interactionHint =
    zoom > MIN_ZOOM ? 'Drag to pan' : 'Hold space to pan'
  const isCompactTopbar = workspaceSize.width > 0 && workspaceSize.width < 1680
  const isBrushExpanded = !isCompactTopbar || expandedPanel === 'brush'
  const isViewExpanded = !isCompactTopbar || expandedPanel === 'view'

  useEffect(() => {
    if (!isCompactTopbar && expandedPanel !== null) {
      setExpandedPanel(null)
      return
    }

    if (isCompactTopbar && expandedPanel === null) {
      setExpandedPanel('brush')
    }
  }, [expandedPanel, isCompactTopbar])

  return (
    <section
      className="mask-editor"
      ref={sectionRef}
      tabIndex={0}
      onBlur={() => {
        setHoverPoint(null)
        setIsSpacePressed(false)
      }}
      onKeyDown={handleEditorKeyDown}
      onKeyUp={handleEditorKeyUp}
      onPointerDownCapture={() => sectionRef.current?.focus()}
    >
      <div className="mask-editor-stage-frame">
        {sourceUrl && dimensions ? (
          <div className="mask-editor-workspace">
            <div className="mask-editor-workspace-viewport" ref={workspaceViewportRef}>
              {stageSize ? (
                <>
                  <div className="mask-editor-topbar" data-compact={isCompactTopbar ? 'true' : 'false'}>
                    <div
                      className="mask-editor-toolgroup mask-editor-toolgroup-primary"
                      data-collapsed={!isBrushExpanded ? 'true' : 'false'}
                    >
                      <button
                        aria-expanded={isBrushExpanded}
                        className="mask-editor-tool-summary mask-editor-tool-summary-compact mask-editor-tool-summary-toggle"
                        type="button"
                        onClick={() => {
                          if (!isCompactTopbar) {
                            return
                          }

                          setExpandedPanel((current) =>
                            current === 'brush' ? null : 'brush',
                          )
                        }}
                      >
                        <span className="mask-editor-control-label">Selection</span>
                        <div className="mask-editor-inline-stat">
                          <span
                            aria-hidden="true"
                            className="mask-editor-brush-chip"
                            data-mode={brushMode}
                            style={{
                              height: `${brushPreviewChipSize}px`,
                              width: `${brushPreviewChipSize}px`,
                            }}
                          />
                          <strong>{brushModeLabel}</strong>
                          <span className="muted">{brushSize}px</span>
                          {isCompactTopbar ? (
                            <span className="mask-editor-collapse-indicator">
                              {isBrushExpanded ? 'Hide' : 'Show'}
                            </span>
                          ) : null}
                        </div>
                      </button>

                      {isBrushExpanded ? (
                      <div className="mask-editor-primary-tools">
                        <div className="segmented-controls" role="group" aria-label="Edit region tool">
                          <button
                            aria-pressed={brushMode === 'paint'}
                            className="button button-secondary"
                            type="button"
                            onClick={() => setBrushMode('paint')}
                          >
                            Mark <span className="mask-editor-keycap">B</span>
                          </button>
                          <button
                            aria-pressed={brushMode === 'erase'}
                            className="button button-secondary"
                            type="button"
                            onClick={() => setBrushMode('erase')}
                          >
                            Erase <span className="mask-editor-keycap">E</span>
                          </button>
                        </div>

                        <label
                          className={`mask-editor-size-control${isCompactTopbar ? ' mask-editor-size-control-compact' : ''}`}
                        >
                          {isCompactTopbar ? (
                            <span className="mask-editor-size-readout mask-editor-size-readout-compact">
                              <strong>{brushSize}px</strong>
                            </span>
                          ) : (
                            <span className="mask-editor-control-copy">
                              <span className="mask-editor-control-label">Selection size</span>
                              <span className="mask-editor-size-readout">
                                <strong>{brushSize}px</strong>
                                <span className="muted">{interactionHint}</span>
                              </span>
                            </span>
                          )}
                          <div className="mask-editor-range-control">
                            <button
                              aria-label="Decrease selection size"
                              className="button button-secondary"
                              disabled={brushSize <= MIN_BRUSH_SIZE}
                              type="button"
                              onClick={() => handleAdjustBrushSize(-BRUSH_STEP)}
                            >
                              -
                            </button>
                            <input
                              aria-label="Selection size"
                              max={MAX_BRUSH_SIZE}
                              min={MIN_BRUSH_SIZE}
                              step={BRUSH_STEP}
                              type="range"
                              value={brushSize}
                              onChange={(event) =>
                                setBrushSize(clampBrushSize(Number(event.target.value)))
                              }
                            />
                            <button
                              aria-label="Increase selection size"
                              className="button button-secondary"
                              disabled={brushSize >= MAX_BRUSH_SIZE}
                              type="button"
                              onClick={() => handleAdjustBrushSize(BRUSH_STEP)}
                            >
                              +
                            </button>
                          </div>
                        </label>

                        {!isCompactTopbar ? (
                          <div className="mask-editor-presets" role="group" aria-label="Selection size presets">
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
                        ) : null}
                      </div>
                      ) : null}
                    </div>

                    <div
                      className="mask-editor-toolgroup mask-editor-toolgroup-utility"
                      data-collapsed={!isViewExpanded ? 'true' : 'false'}
                    >
                      <button
                        aria-expanded={isViewExpanded}
                        className="mask-editor-tool-summary mask-editor-tool-summary-compact mask-editor-tool-summary-toggle"
                        type="button"
                        onClick={() => {
                          if (!isCompactTopbar) {
                            return
                          }

                          setExpandedPanel((current) =>
                            current === 'view' ? null : 'view',
                          )
                        }}
                      >
                        <span className="mask-editor-control-label">View</span>
                        <div className="mask-editor-inline-stat">
                          <strong>{Math.round(zoom * 100)}%</strong>
                          <span className="muted">{viewHint}</span>
                          {isCompactTopbar ? (
                            <span className="mask-editor-collapse-indicator">
                              {isViewExpanded ? 'Hide' : 'Show'}
                            </span>
                          ) : null}
                        </div>
                      </button>

                      {isViewExpanded ? (
                      <div className="mask-editor-utility-tools">
                        <div className="segmented-controls" role="group" aria-label="History controls">
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
                        </div>

                        <div className="segmented-controls" role="group" aria-label="View controls">
                          <button
                            aria-label="Zoom out"
                            className="button button-secondary"
                            disabled={zoom <= MIN_ZOOM}
                            type="button"
                            onClick={() => handleZoomChange(zoom - ZOOM_STEP)}
                          >
                            -
                          </button>
                          <button
                            aria-label="Zoom in"
                            className="button button-secondary"
                            disabled={zoom >= MAX_ZOOM}
                            type="button"
                            onClick={() => handleZoomChange(zoom + ZOOM_STEP)}
                          >
                            +
                          </button>
                          <button
                            className="button button-secondary"
                            disabled={!canResetView}
                            type="button"
                            onClick={handleFitView}
                          >
                            Fit
                          </button>
                        </div>
                      </div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    className="mask-editor-stage"
                    ref={stageRef}
                    data-painting={isPainting ? 'true' : undefined}
                    data-panning={isPanning ? 'true' : undefined}
                    style={{
                      height: `${stageSize.height}px`,
                      transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                      width: `${stageSize.width}px`,
                    }}
                  >
                    <img
                      alt="Source image for edit region selection"
                      className="mask-editor-image"
                      src={sourceUrl}
                    />
                    <canvas
                      className="mask-editor-canvas"
                      data-space-panning={isSpacePressed ? 'true' : undefined}
                      ref={canvasRef}
                      style={{ opacity: MASK_OVERLAY_OPACITY }}
                      onContextMenu={(event) => event.preventDefault()}
                      onPointerCancel={(event) => void finishInteraction(event)}
                      onPointerDown={handlePointerDown}
                      onPointerLeave={() => {
                        if (activeStrokePointerIdRef.current == null) {
                          setHoverPoint(null)
                        }
                      }}
                      onPointerMove={handlePointerMove}
                      onPointerUp={(event) => void finishInteraction(event)}
                    />
                    {showBrushPreview && hoverPoint && dimensions ? (
                      <div
                        aria-hidden="true"
                        className="mask-editor-brush-preview"
                        data-mode={brushMode}
                        style={{
                          height: `${brushPreviewSize}px`,
                          left: `${(hoverPoint.x / dimensions.width) * stageSize.width}px`,
                          top: `${(hoverPoint.y / dimensions.height) * stageSize.height}px`,
                          width: `${brushPreviewSize}px`,
                        }}
                      />
                    ) : null}
                  </div>

                  {minimapSize && visibleStageRect && canNavigateMinimap ? (
                    <div className="mask-editor-minimap-shell">
                      <div className="mask-editor-minimap-header">
                        <strong>Navigator</strong>
                        <span>{visibleCoverage}% visible</span>
                      </div>
                      <div
                        className="mask-editor-minimap"
                        data-dragging={isNavigatingMinimap ? 'true' : undefined}
                        data-interactive={canNavigateMinimap ? 'true' : undefined}
                        ref={minimapRef}
                        onPointerCancel={handleMinimapPointerUp}
                        onPointerDown={handleMinimapPointerDown}
                        onPointerMove={handleMinimapPointerMove}
                        onPointerUp={handleMinimapPointerUp}
                      >
                        <div
                          className="mask-editor-minimap-stage"
                          style={{
                            height: `${minimapSize.height}px`,
                            width: `${minimapSize.width}px`,
                          }}
                        >
                          <img alt="" className="mask-editor-minimap-image" src={sourceUrl} />
                          <div
                            className="mask-editor-minimap-viewport"
                            style={{
                              height: `${(visibleStageRect.height / stageSize.height) * minimapSize.height}px`,
                              left: `${(visibleStageRect.x / stageSize.width) * minimapSize.width}px`,
                              top: `${(visibleStageRect.y / stageSize.height) * minimapSize.height}px`,
                              width: `${(visibleStageRect.width / stageSize.width) * minimapSize.width}px`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mask-editor-stage-status">
                    <span className={`status-pill ${hasPaint ? 'status-pill-ready' : ''}`}>
                      {hasPaint ? 'Edit region ready' : 'No edit region yet'}
                    </span>
                    <span>
                      {brushModeLabel} · {brushSize}px
                    </span>
                    <span>{Math.round(zoom * 100)}%</span>
                    <span>{interactionHint}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : sourceUrl ? (
          <div className="image-preview-empty muted">Loading source image editor...</div>
        ) : (
          <div className="image-preview-empty muted">
            Choose a source image to unlock the in-browser edit region selector.
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
    </section>
  )
}
