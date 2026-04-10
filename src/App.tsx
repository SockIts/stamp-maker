import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import './App.css'
import { fetchSharedStamps, isSharedDatabaseConfigured, publishSharedStamp } from './sharedDatabase'

type CropRect = {
  x: number
  y: number
  width: number
  height: number
}

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

type DragMode =
  | { type: 'none' }
  | { type: 'move'; startX: number; startY: number; startRect: CropRect }
  | {
      type: 'resize'
      corner: ResizeCorner
      startX: number
      startY: number
      startRect: CropRect
    }

type Preset = 'square' | 'portrait' | 'landscape' | 'filled' | 'expand'

type PreviewMode = 'single' | 'grid' | 'grid2'

type StampItem = {
  id: string
  src: string
  baseSrc: string
  ratio: number
  preset?: Preset | null
  modalEdits?: ModalStampEdits
}

type SelectedStampPreview = {
  stamp: StampItem
  index: number
}

type ModalTextLayer = {
  id: string
  text: string
  x: number
  y: number
  size: number
  color: string
  font: string
  opacity: number
  rotation: number
}

type ModalIconLayer = {
  id: string
  src: string
  x: number // px center within stamp container
  y: number // px center within stamp container
  size: number // px width
  opacity: number
  inverse: boolean
}

type ModalStampEdits = {
  wallColor: string
  stampColor: string
  fade: number
  dither: number
  texture: number
  texturePreset: 'paper' | 'wavy' | 'grit' | 'halftone-cmyk' | 'halftone-c' | 'halftone-m' | 'halftone-y' | 'halftone-k'
  zoom: number
  panX: number
  panY: number
  perforationSize: number
  textLayers: ModalTextLayer[]
  iconLayers: ModalIconLayer[]
  activeTextId: string | null
  activeIconId: string | null
}

type StampEffects = {
  darkBorder: boolean
  twoTone: boolean
  inverse: boolean
  popArt: boolean
  moma: boolean
  sandstorm: boolean
  lineHalftone: boolean
  hopePoster: boolean
}

type EffectProfile = {
  effects: StampEffects
  ditherLevel: number
  brightnessLevel: number
  contrastLevel: number
  saturationLevel: number
  pixelateLevel: number
  mosaicHexLevel: number
  glitchLevel: number
  lineArtLevel: number
  sharpnessLevel: number
  normifyLevel: number
  twoTonePalette: [[number, number, number], [number, number, number]] | null
  popArtPalette: [number, number, number][] | null
  momaPalette: [number, number, number][] | null
  lineHalftonePalette: [[number, number, number], [number, number, number]] | null
}

type DatabaseStamp = {
  id: string
  src: string
  createdAt: number
  wallColor?: string
}

const MIN_CROP_SIZE = 24
const PIXELATE_MAX = 250
const MOSAIC_HEX_MAX = 250
const GLITCH_MAX = 200
const BRIGHTNESS_MIN = -100
const BRIGHTNESS_MAX = 100
const STAMPS_DB_NAME = 'stamp-maker-db-v2'
const STAMPS_DB_VERSION = 2
const STAMPS_STORE_NAME = 'submitted-stamps'
const HISTORY_STORE_NAME = 'history-images'
const LOCAL_STAMPS_KEY = 'stamp-maker-local-stamps'
const IMPORT_PROXY_URL = (import.meta.env.VITE_IMAGE_PROXY_URL as string | undefined)?.trim()

const openStampsDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(STAMPS_DB_NAME, STAMPS_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STAMPS_STORE_NAME)) {
        db.createObjectStore(STAMPS_STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        db.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const saveSubmittedStamp = async (stamp: DatabaseStamp) => {
  const db = await openStampsDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STAMPS_STORE_NAME, 'readwrite')
    const store = tx.objectStore(STAMPS_STORE_NAME)
    store.put(stamp)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

const getSubmittedStamps = async () => {
  const db = await openStampsDb()
  const records = await new Promise<DatabaseStamp[]>((resolve, reject) => {
    const tx = db.transaction(STAMPS_STORE_NAME, 'readonly')
    const store = tx.objectStore(STAMPS_STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve((request.result as DatabaseStamp[]) ?? [])
    request.onerror = () => reject(request.error)
  })
  db.close()
  return records.sort((a, b) => b.createdAt - a.createdAt)
}

type HistoryImageRecord = {
  id: string
  src: string
  createdAt: number
}

const getHistoryImages = async () => {
  const db = await openStampsDb()
  const records = await new Promise<HistoryImageRecord[]>((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readonly')
    const store = tx.objectStore(HISTORY_STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve((request.result as HistoryImageRecord[]) ?? [])
    request.onerror = () => reject(request.error)
  })
  db.close()
  return records.sort((a, b) => b.createdAt - a.createdAt)
}

const saveHistoryImage = async (src: string, maxItems = 7) => {
  const db = await openStampsDb()
  const existing = await new Promise<HistoryImageRecord[]>((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readonly')
    const store = tx.objectStore(HISTORY_STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve((request.result as HistoryImageRecord[]) ?? [])
    request.onerror = () => reject(request.error)
  })

  const deduped = existing.filter((item) => item.src !== src)
  const next: HistoryImageRecord[] = [{ id: crypto.randomUUID(), src, createdAt: Date.now() }, ...deduped]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, maxItems)

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite')
    const store = tx.objectStore(HISTORY_STORE_NAME)
    store.clear()
    next.forEach((item) => store.put(item))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  db.close()
}


const PRESET_OPTIONS: { key: Preset; label: string; ratio: number }[] = [
  { key: 'square', label: 'Square', ratio: 1 },
  { key: 'portrait', label: 'Portrait', ratio: 3 / 4 },
  { key: 'landscape', label: 'Landscape', ratio: 4 / 3 },
  { key: 'filled', label: 'Filled', ratio: 1 },
  { key: 'expand', label: 'Expand', ratio: 1 },
]

const DEFAULT_EFFECTS: StampEffects = {
  darkBorder: false,
  twoTone: false,
  inverse: false,
  popArt: false,
  moma: false,
  sandstorm: false,
  lineHalftone: false,
  hopePoster: false,
}

const createDefaultProfile = (): EffectProfile => ({
  effects: { ...DEFAULT_EFFECTS },
  ditherLevel: 0,
  brightnessLevel: 0,
  contrastLevel: 0,
  saturationLevel: 0,
  pixelateLevel: 0,
  mosaicHexLevel: 0,
  glitchLevel: 0,
  lineArtLevel: 0,
  sharpnessLevel: 0,
  normifyLevel: 0,
  twoTonePalette: null,
  popArtPalette: null,
  momaPalette: null,
  lineHalftonePalette: null,
})

const MODAL_FONT_OPTIONS = [
  { label: 'Aktura', family: 'Aktura', weight: 400, style: 'normal' as const },
  { label: 'Arial', family: 'Arial', weight: 500, style: 'normal' as const },
  { label: 'Array', family: 'Array', weight: 600, style: 'normal' as const },
  { label: 'Bespoke Stencil', family: 'Bespoke Stencil', weight: 500, style: 'italic' as const },
  { label: 'Britney', family: 'Britney', weight: 700, style: 'normal' as const },
  { label: 'Courier New', family: 'Courier New', weight: 500, style: 'normal' as const },
  { label: 'Futura', family: 'Futura', weight: 500, style: 'normal' as const },
  { label: 'Georgia', family: 'Georgia', weight: 500, style: 'normal' as const },
  { label: 'Impact', family: 'Impact', weight: 500, style: 'normal' as const },
  { label: 'Kola', family: 'Kola', weight: 400, style: 'normal' as const },
  { label: 'Pencerio', family: 'Pencerio', weight: 400, style: 'normal' as const },
  { label: 'Satoshi', family: 'Satoshi', weight: 500, style: 'normal' as const },
  { label: 'Segment', family: 'Segment', weight: 400, style: 'normal' as const },
  { label: 'Stardom', family: 'Stardom', weight: 400, style: 'normal' as const },
  { label: 'Telma', family: 'Telma', weight: 700, style: 'normal' as const },
  { label: 'Times New Roman', family: 'Times New Roman', weight: 500, style: 'normal' as const },
  { label: 'Zina', family: 'Zina', weight: 400, style: 'normal' as const },
  { label: 'Zodiak', family: 'Zodiak', weight: 800, style: 'italic' as const },
]

const getModalFontSpec = (fontLabel: string) =>
  MODAL_FONT_OPTIONS.find((f) => f.label === fontLabel) ?? MODAL_FONT_OPTIONS[0]

const createDefaultTextLayer = (): ModalTextLayer => ({
  id: crypto.randomUUID(),
  text: 'Testing',
  x: 50,
  y: 92,
  size: 42,
  color: '#ffffff',
  font: 'Stardom',
  opacity: 100,
  rotation: 0,
})

const createDefaultModalEdits = (): ModalStampEdits => {
  return {
    wallColor: '#14161b',
    stampColor: '#ece4d3',
    fade: 0,
    dither: 0,
    texture: 0,
    texturePreset: 'paper',
    zoom: 1,
    panX: 0,
    panY: 0,
    perforationSize: 34,
    textLayers: [],
    iconLayers: [],
    activeTextId: null,
    activeIconId: null,
  }
}

const POP_ART_PALETTES: [number, number, number][][] = [
  [[38, 52, 145], [245, 58, 92], [255, 210, 65]],
  [[31, 119, 180], [255, 127, 14], [214, 39, 40]],
  [[83, 28, 145], [0, 176, 155], [255, 214, 10]],
  [[0, 48, 73], [214, 40, 40], [247, 127, 0]],
  [[61, 90, 254], [255, 0, 110], [255, 190, 11]],
  [[0, 110, 182], [255, 77, 109], [255, 217, 61]],
]

const MOMA_PALETTES: [number, number, number][][] = [
  [[178, 126, 82], [158, 35, 25], [12, 86, 91], [37, 126, 28], [239, 230, 196]],
  [[227, 176, 0], [126, 34, 34], [39, 24, 24], [153, 68, 40], [246, 225, 162]],
  [[72, 132, 52], [161, 177, 54], [33, 95, 51], [234, 209, 49], [25, 42, 27]],
  [[43, 17, 32], [207, 32, 92], [244, 179, 187], [212, 98, 112], [250, 230, 221]],
  [[119, 183, 126], [248, 99, 86], [94, 47, 52], [23, 21, 97], [233, 220, 202]],
  [[235, 190, 147], [248, 166, 93], [114, 148, 38], [246, 127, 43], [224, 225, 211]],
  [[241, 170, 18], [102, 42, 151], [255, 79, 1], [123, 211, 57], [237, 226, 57]],
  [[164, 76, 13], [199, 142, 31], [153, 58, 63], [89, 80, 50], [184, 209, 220]],
  [[245, 182, 29], [70, 204, 181], [247, 95, 68], [235, 56, 9], [245, 155, 126]],
  [[42, 43, 63], [154, 138, 80], [96, 115, 68], [188, 160, 83], [115, 176, 189]],
  [[36, 112, 117], [64, 168, 154], [145, 62, 139], [82, 14, 91], [170, 175, 170]],
  [[33, 52, 112], [230, 232, 167], [176, 218, 184], [56, 107, 160], [20, 29, 75]],
  [[235, 31, 35], [117, 34, 71], [245, 179, 89], [10, 10, 12], [243, 222, 138]],
  [[120, 12, 131], [184, 79, 174], [219, 165, 219], [7, 16, 71], [199, 94, 185]],
  [[140, 71, 184], [16, 17, 15], [18, 147, 130], [235, 218, 0], [73, 187, 177]],
  [[205, 103, 162], [189, 48, 139], [226, 166, 194], [102, 128, 28], [57, 73, 20]],
  [[31, 44, 107], [44, 136, 160], [240, 167, 58], [220, 28, 56], [234, 214, 95]],
  [[34, 53, 113], [241, 191, 74], [70, 156, 190], [216, 16, 44], [232, 122, 83]],
  [[48, 43, 152], [200, 26, 101], [0, 112, 161], [128, 41, 143], [255, 88, 0]],
  [[116, 96, 33], [104, 173, 94], [157, 211, 190], [220, 149, 158], [255, 177, 77]],
  [[82, 34, 89], [215, 0, 87], [106, 157, 79], [228, 214, 160], [64, 104, 122]],
  [[32, 52, 126], [239, 88, 74], [231, 210, 99], [40, 144, 166], [239, 159, 67]],
  [[32, 133, 173], [11, 76, 122], [245, 96, 93], [159, 83, 88], [232, 186, 179]],
  [[48, 38, 118], [173, 25, 92], [7, 123, 164], [255, 73, 0], [201, 37, 42]],
  [[144, 121, 107], [82, 58, 52], [184, 173, 167], [226, 190, 171], [66, 73, 92]],
  [[24, 126, 147], [86, 57, 51], [208, 143, 131], [73, 159, 177], [175, 96, 80]],
  [[232, 197, 168], [88, 146, 72], [213, 142, 95], [181, 187, 63], [82, 89, 150]],
  [[162, 78, 74], [6, 100, 142], [84, 130, 64], [56, 47, 120], [138, 188, 197]],
  [[33, 43, 67], [240, 122, 29], [107, 191, 175], [228, 214, 130], [145, 157, 214]],
  [[248, 204, 84], [249, 117, 76], [9, 141, 133], [247, 142, 98], [170, 208, 188]],
  [[27, 52, 120], [68, 132, 176], [168, 198, 148], [213, 180, 58], [88, 160, 166]],
  [[244, 225, 12], [249, 100, 79], [15, 19, 18], [143, 153, 166], [248, 176, 134]],
  [[202, 143, 21], [229, 67, 0], [247, 207, 59], [40, 51, 124], [0, 97, 129]],
  [[15, 56, 94], [174, 36, 57], [0, 133, 147], [246, 84, 147], [237, 220, 189]],
  [[255, 12, 127], [9, 62, 127], [255, 182, 38], [90, 179, 192], [230, 156, 171]],
]

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}


function getPresetRatio(preset: Preset) {
  return PRESET_OPTIONS.find((option) => option.key === preset)?.ratio ?? 1
}

function buildPresetCrop(img: HTMLImageElement, preset: Preset): CropRect {
  if (preset === 'filled') {
    return { x: 0, y: 0, width: img.width, height: img.height }
  }

  if (preset === 'expand') {
    return { x: 0, y: 0, width: img.width, height: img.height }
  }

  const ratio = getPresetRatio(preset)
  const maxUsableWidth = Math.max(MIN_CROP_SIZE, Math.round(img.width * 0.72))
  const maxUsableHeight = Math.max(MIN_CROP_SIZE, Math.round(img.height * 0.72))

  let width = maxUsableWidth
  let height = Math.round(width / ratio)

  if (height > maxUsableHeight) {
    height = maxUsableHeight
    width = Math.round(height * ratio)
  }

  width = clamp(width, MIN_CROP_SIZE, img.width)
  height = clamp(height, MIN_CROP_SIZE, img.height)

  return {
    x: Math.round((img.width - width) / 2),
    y: Math.round((img.height - height) / 2),
    width,
    height,
  }
}

function pickTwoTonePalette(
  img: HTMLImageElement,
  crop: CropRect | null,
): [[number, number, number], [number, number, number]] {
  const sampleCanvas = document.createElement('canvas')
  const ctx = sampleCanvas.getContext('2d')
  if (!ctx) return [[20, 20, 20], [240, 240, 240]]

  const sx = crop?.x ?? 0
  const sy = crop?.y ?? 0
  const sw = crop?.width ?? img.width
  const sh = crop?.height ?? img.height

  sampleCanvas.width = 120
  sampleCanvas.height = 120
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sampleCanvas.width, sampleCanvas.height)

  const { data } = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height)
  const bins = new Map<string, { r: number; g: number; b: number; count: number }>()

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const qr = Math.floor(r / 32) * 32
    const qg = Math.floor(g / 32) * 32
    const qb = Math.floor(b / 32) * 32
    const key = `${qr}-${qg}-${qb}`
    const found = bins.get(key)
    if (found) {
      found.r += r
      found.g += g
      found.b += b
      found.count += 1
    } else {
      bins.set(key, { r, g, b, count: 1 })
    }
  }

  const top16 = [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 16)
    .map((c) => [Math.round(c.r / c.count), Math.round(c.g / c.count), Math.round(c.b / c.count)] as [number, number, number])

  const pool: [number, number, number][] =
    top16.length >= 2 ? top16 : ([[20, 20, 20], [240, 240, 240]] as [number, number, number][])
  const aIndex = Math.floor(Math.random() * pool.length)
  let bIndex = Math.floor(Math.random() * pool.length)
  while (bIndex === aIndex) bIndex = Math.floor(Math.random() * pool.length)

  return [pool[aIndex], pool[bIndex]] as [[number, number, number], [number, number, number]]
}

function App() {
  const [imageSrc, setImageSrc] = useState<string>('')
  const [urlInput, setUrlInput] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [dragMode, setDragMode] = useState<DragMode>({ type: 'none' })
  const [stamps, setStamps] = useState<StampItem[]>([])
  const [preset, setPreset] = useState<Preset | null>(null)
  const [selectedStamp, setSelectedStamp] = useState<SelectedStampPreview | null>(null)
  const [modalEdits, setModalEdits] = useState<ModalStampEdits>(createDefaultModalEdits)
  const [modalStampSrc, setModalStampSrc] = useState<string>('')
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null)
  const [exportSizePct, setExportSizePct] = useState<100 | 75 | 50 | 25>(100)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [imageAdjustDrag, setImageAdjustDrag] = useState<
    | { mode: 'none' }
    | { mode: 'move'; startX: number; startY: number; startPanX: number; startPanY: number }
    | { mode: 'zoom'; startX: number; startY: number; startZoom: number; axis: 'corner' | 'side-x' | 'side-y' }
  >({ mode: 'none' })
  const [iconDrag, setIconDrag] = useState<
    | { mode: 'none' }
    | { mode: 'move'; id: string; startX: number; startY: number; startIconX: number; startIconY: number }
  >({ mode: 'none' })
  const [isDragOverPreview, setIsDragOverPreview] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('single')
  const [selectedGridCell, setSelectedGridCell] = useState(0)
  const [effects, setEffects] = useState<StampEffects>({ ...DEFAULT_EFFECTS })
  const [ditherLevel, setDitherLevel] = useState(0)
  const [brightnessLevel, setBrightnessLevel] = useState(0)
  const [contrastLevel, setContrastLevel] = useState(0)
  const [saturationLevel, setSaturationLevel] = useState(0)
  const [pixelateLevel, setResolutionLevel] = useState(0)
  const [mosaicHexLevel, setMosaicHexLevel] = useState(0)
  const [glitchLevel, setGlitchLevel] = useState(0)
  const [lineArtLevel, setLineArtLevel] = useState(0)
  const [sharpnessLevel, setSharpnessLevel] = useState(0)
  const [normifyLevel, setNormifyLevel] = useState(0)
  const [twoTonePalette, setTwoTonePalette] = useState<[[number, number, number], [number, number, number]] | null>(null)
  const [popArtPalette, setPopArtPalette] = useState<[number, number, number][] | null>(null)
  const [momaPalette, setMomaPalette] = useState<[number, number, number][] | null>(null)
  const [lineHalftonePalette, setLineHalftonePalette] = useState<[[number, number, number], [number, number, number]] | null>(null)
  const [gridProfiles, setGridProfiles] = useState<EffectProfile[]>(
    Array.from({ length: 9 }, () => createDefaultProfile()),
  )
  const [newestStampId, setNewestStampId] = useState<string | null>(null)
  const [themeMode, setThemeMode] = useState<'day' | 'night'>('day')
  const [databaseStamps, setDatabaseStamps] = useState<DatabaseStamp[]>([])
  const [isDatabaseOpen, setIsDatabaseOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [historyImages, setHistoryImages] = useState<string[]>([])
  const [isSubmittingToDatabase, setIsSubmittingToDatabase] = useState(false)
  const [databaseNotice, setDatabaseNotice] = useState('')
  const [databasePanelHeight, setDatabasePanelHeight] = useState(780)
  const [selectedDatabaseStamp, setSelectedDatabaseStamp] = useState<DatabaseStamp | null>(null)
  const [databasePage, setDatabasePage] = useState(1)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const contentAreaRef = useRef<HTMLDivElement | null>(null)
  const editorMainRef = useRef<HTMLDivElement | null>(null)
  const modalPreviewRef = useRef<HTMLDivElement | null>(null)
  const modalStampFrameRef = useRef<HTMLDivElement | null>(null)
  const modalImageElementRef = useRef<HTMLImageElement | null>(null)
  const modalIconOverlayRef = useRef<HTMLDivElement | null>(null)
  const emptyUploadInputRef = useRef<HTMLInputElement | null>(null)
  const skipNextHistoryWriteRef = useRef(false)
  const [textDrag, setTextDrag] = useState<
    | { mode: 'none' }
    | { mode: 'move'; id: string; startX: number; startY: number; startLayerX: number; startLayerY: number }
    | {
        mode: 'transform'
        id: string
        centerX: number
        centerY: number
        startAngle: number
        startDist: number
        startSize: number
        startRotation: number
      }
  >({ mode: 'none' })

  const hasImage = useMemo(() => Boolean(imageSrc), [imageSrc])
  const isGridMode = previewMode === 'grid' || previewMode === 'grid2'
  const gridSize = previewMode === 'grid2' ? 2 : 3
  const DATABASE_PAGE_SIZE = 15
  const totalDatabasePages = Math.max(1, Math.ceil(databaseStamps.length / DATABASE_PAGE_SIZE))
  const pagedDatabaseStamps = databaseStamps.slice(
    (databasePage - 1) * DATABASE_PAGE_SIZE,
    databasePage * DATABASE_PAGE_SIZE,
  )

  const currentProfile: EffectProfile = {
    effects,
    ditherLevel,
    brightnessLevel,
    contrastLevel,
    saturationLevel,
    pixelateLevel,
    mosaicHexLevel,
    glitchLevel,
    lineArtLevel,
    sharpnessLevel,
    normifyLevel,
    twoTonePalette,
    popArtPalette,
    momaPalette,
    lineHalftonePalette,
  }

  const applyProfile = (profile: EffectProfile) => {
    setEffects({ ...profile.effects })
    setDitherLevel(profile.ditherLevel)
    setBrightnessLevel(profile.brightnessLevel)
    setContrastLevel(profile.contrastLevel)
    setSaturationLevel(profile.saturationLevel)
    setResolutionLevel(profile.pixelateLevel)
    setMosaicHexLevel(profile.mosaicHexLevel)
    setGlitchLevel(profile.glitchLevel)
    setLineArtLevel(profile.lineArtLevel)
    setSharpnessLevel(profile.sharpnessLevel)
    setNormifyLevel(profile.normifyLevel)
    setTwoTonePalette(profile.twoTonePalette)
    setPopArtPalette(profile.popArtPalette)
    setMomaPalette(profile.momaPalette)
    setLineHalftonePalette(profile.lineHalftonePalette)
  }

  const persistCurrentToGridCell = (cellIndex = selectedGridCell, overrides?: Partial<EffectProfile>) => {
    if (!isGridMode) return
    setGridProfiles((prev) => {
      const next = [...prev]
      next[cellIndex] = { ...currentProfile, ...overrides }
      return next
    })
  }

  useEffect(() => {
    if (!imageSrc) {
      imageRef.current = null
      setCrop(null)
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    setIsLoading(true)
    setError('')

    img.onload = () => {
      imageRef.current = img
      setIsLoading(false)
      const nextCrop = preset ? buildPresetCrop(img, preset) : null
      setCrop(nextCrop)
      if (effects.twoTone) {
        setTwoTonePalette(pickTwoTonePalette(img, nextCrop))
      }
      // Re-fit display size for the newly loaded image ratio.
      requestAnimationFrame(() => {
        fitCanvasToPreview()
        draw()
      })
    }

    img.onerror = () => {
      setIsLoading(false)
      if (/^https?:\/\//i.test(imageSrc)) {
        setError('')
      } else {
        setError('Could not load image.')
      }
      imageRef.current = null
      setCrop(null)
    }

    img.src = imageSrc
  }, [imageSrc])

  useEffect(() => {
    fitCanvasToPreview()
  }, [imageSrc])

  useEffect(() => {
    const onResize = () => fitCanvasToPreview()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [imageSrc])

  useEffect(() => {
    draw()
  }, [
    crop,
    imageSrc,
    effects,
    twoTonePalette,
    popArtPalette,
    ditherLevel,
    brightnessLevel,
    contrastLevel,
    saturationLevel,
    pixelateLevel,
    mosaicHexLevel,
    glitchLevel,
    lineArtLevel,
    sharpnessLevel,
    normifyLevel,
    momaPalette,
    previewMode,
    selectedGridCell,
    gridProfiles,
  ])

  useEffect(() => {
    if (!newestStampId) return
    const timer = window.setTimeout(() => setNewestStampId(null), 980)
    return () => window.clearTimeout(timer)
  }, [newestStampId])

  useEffect(() => {
    void (async () => {
      try {
        const records = await getHistoryImages()
        setHistoryImages(records.map((item) => item.src))
      } catch {
        // ignore history read failures
      }
    })()
  }, [])

  useEffect(() => {
    if (!imageSrc) return

    if (skipNextHistoryWriteRef.current) {
      skipNextHistoryWriteRef.current = false
      return
    }

    setHistoryImages((prev) => {
      if (prev[0] === imageSrc) return prev
      const deduped = prev.filter((item) => item !== imageSrc)
      return [imageSrc, ...deduped].slice(0, 7)
    })

    void saveHistoryImage(imageSrc)
  }, [imageSrc])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_STAMPS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as StampItem[]
      if (Array.isArray(parsed)) setStamps(parsed)
    } catch {
      // ignore bad cache
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STAMPS_KEY, JSON.stringify(stamps))
    } catch {
      // ignore storage failures
    }
  }, [stamps])

  useEffect(() => {
    if (isDatabaseOpen) return
    const target = editorMainRef.current
    if (!target) return

    const updateHeight = () => setDatabasePanelHeight(Math.max(520, Math.round(target.getBoundingClientRect().height)))
    updateHeight()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateHeight())
    observer.observe(target)
    return () => observer.disconnect()
  }, [isDatabaseOpen, hasImage, themeMode])

  const refreshDatabaseStamps = async () => {
    try {
      if (isSharedDatabaseConfigured) {
        const shared = await fetchSharedStamps(300)
        setDatabaseStamps(shared)
        setDatabaseNotice('Showing community stamps.')
        return
      }

      const saved = await getSubmittedStamps()
      setDatabaseStamps(saved)
      setDatabaseNotice('Shared DB not configured yet. Showing local stamps only.')
    } catch {
      setDatabaseNotice('Could not load database stamps.')
    }
  }

  const submitStampToDatabase = async () => {
    if (!selectedStamp || isSubmittingToDatabase) return
    setIsSubmittingToDatabase(true)
    setDatabaseNotice('')
    try {
      const composed = await renderModalSceneImage(100, true)

      if (isSharedDatabaseConfigured) {
        await publishSharedStamp(composed, modalEdits.wallColor)
        await refreshDatabaseStamps()
        setDatabaseNotice('Stamp published to community database.')
      } else {
        await saveSubmittedStamp({
          id: crypto.randomUUID(),
          src: composed,
          createdAt: Date.now(),
          wallColor: modalEdits.wallColor,
        })
        await refreshDatabaseStamps()
        setDatabaseNotice('Shared DB not configured. Saved locally.')
      }
    } catch {
      setDatabaseNotice('Could not submit stamp to database.')
    } finally {
      setIsSubmittingToDatabase(false)
    }
  }


  useEffect(() => {
    if (!isDatabaseOpen) {
      if (imageSrc) {
        const timer = window.setTimeout(() => {
          requestAnimationFrame(() => {
            fitCanvasToPreview()
            draw()
          })
        }, 1550)
        return () => window.clearTimeout(timer)
      }
      return
    }
    setIsHistoryOpen(false)
    setDatabasePage(1)
    void refreshDatabaseStamps()
  }, [isDatabaseOpen, imageSrc])

  useEffect(() => {
    if (databasePage > totalDatabasePages) {
      setDatabasePage(totalDatabasePages)
    }
  }, [databasePage, totalDatabasePages])


  const drawPreviewStampFrame = (ctx: CanvasRenderingContext2D, cropRect: CropRect) => {
    const hole = 8
    const step = 16
    const bg = '#1e2637'

    ctx.save()
    ctx.fillStyle = bg

    for (let x = cropRect.x; x <= cropRect.x + cropRect.width; x += step) {
      ctx.beginPath()
      ctx.arc(x, cropRect.y, hole / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, cropRect.y + cropRect.height, hole / 2, 0, Math.PI * 2)
      ctx.fill()
    }

    for (let y = cropRect.y; y <= cropRect.y + cropRect.height; y += step) {
      ctx.beginPath()
      ctx.arc(cropRect.x, y, hole / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cropRect.x + cropRect.width, y, hole / 2, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  const drawHandles = (ctx: CanvasRenderingContext2D, cropRect: CropRect) => {
    const corners = [
      { x: cropRect.x, y: cropRect.y },
      { x: cropRect.x + cropRect.width, y: cropRect.y },
      { x: cropRect.x, y: cropRect.y + cropRect.height },
      { x: cropRect.x + cropRect.width, y: cropRect.y + cropRect.height },
    ]

    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#2f63be'
    ctx.lineWidth = 2

    corners.forEach((corner) => {
      ctx.beginPath()
      ctx.arc(corner.x, corner.y, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })
  }

  const drawEffectOverlays = (
    _ctx: CanvasRenderingContext2D,
    _x: number,
    _y: number,
    _width: number,
    _height: number,
    _profile: EffectProfile,
  ) => {
  }

  const drawClippedBorder = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    profile: EffectProfile = currentProfile,
  ) => {
    if (!profile.effects.darkBorder) return
    ctx.save()
    ctx.strokeStyle = 'rgba(25, 20, 14, 0.72)'
    ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.02))
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2)
    ctx.restore()
  }


  const drawWithEffects = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    profile?: EffectProfile,
  ) => {
    const active = profile ?? currentProfile
    const { effects: activeEffects } = active


    const filters: string[] = []
    if (active.brightnessLevel !== 0) {
      const brightness = 1 + (active.brightnessLevel / 100) * 0.8
      filters.push(`brightness(${brightness})`)
    }
    if (active.contrastLevel !== 0) {
      const contrast = clamp(1 + active.contrastLevel / 100, 0.1, 3)
      filters.push(`contrast(${contrast})`)
    }
    if (active.saturationLevel !== 0) {
      const saturation = clamp(1 + active.saturationLevel / 100, 0, 3)
      filters.push(`saturate(${saturation})`)
    }
    if (activeEffects.inverse) filters.push('invert(1)')

    if (active.pixelateLevel > 0) {
      const t = active.pixelateLevel / PIXELATE_MAX
      const maxBlockSize = 100
      const blockSize = 1 + t * (maxBlockSize - 1)
      const pw = Math.max(1, Math.round(dw / blockSize))
      const ph = Math.max(1, Math.round(dh / blockSize))
      const temp = document.createElement('canvas')
      temp.width = pw
      temp.height = ph
      const tctx = temp.getContext('2d')
      if (tctx) {
        tctx.imageSmoothingEnabled = true
        tctx.filter = filters.length > 0 ? filters.join(' ') : 'none'
        tctx.drawImage(img, sx, sy, sw, sh, 0, 0, pw, ph)
        ctx.save()
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(temp, 0, 0, pw, ph, dx, dy, dw, dh)
        ctx.restore()
      }
    } else {
      ctx.save()
      ctx.filter = filters.length > 0 ? filters.join(' ') : 'none'
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
      ctx.restore()
    }

    if (active.mosaicHexLevel > 0) {
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      const src = new Uint8ClampedArray(data)
      const t = active.mosaicHexLevel / MOSAIC_HEX_MAX
      const radius = Math.max(4, Math.round(4 + t * 42))
      const stepX = Math.sqrt(3) * radius
      const stepY = radius * 1.5
      const halfHexWidth = (Math.sqrt(3) / 2) * radius

      const sample = (x: number, y: number) => {
        const sx = Math.max(0, Math.min(dw - 1, Math.round(x)))
        const sy = Math.max(0, Math.min(dh - 1, Math.round(y)))
        const i = (sy * dw + sx) * 4
        return [src[i], src[i + 1], src[i + 2], src[i + 3]] as const
      }

      const nearestCenter = (x: number, y: number) => {
        const roughRow = Math.round((y - radius) / stepY)
        let bestCx = radius
        let bestCy = radius
        let bestD = Number.POSITIVE_INFINITY

        for (let row = roughRow - 1; row <= roughRow + 1; row += 1) {
          const cy = radius + row * stepY
          const xOffset = row % 2 === 0 ? radius : radius + stepX / 2
          const col = Math.round((x - xOffset) / stepX)

          for (let c = col - 1; c <= col + 1; c += 1) {
            const cx = xOffset + c * stepX
            const dxh = x - cx
            const dyh = y - cy
            const d = dxh * dxh + dyh * dyh
            if (d < bestD) {
              bestD = d
              bestCx = cx
              bestCy = cy
            }
          }
        }

        return { cx: bestCx, cy: bestCy }
      }

      for (let y = 0; y < dh; y += 1) {
        for (let x = 0; x < dw; x += 1) {
          const { cx, cy } = nearestCenter(x, y)
          const [cr, cg, cb, ca] = sample(cx, cy)
          const i = (y * dw + x) * 4
          data[i] = cr
          data[i + 1] = cg
          data[i + 2] = cb
          data[i + 3] = ca
        }
      }

      ctx.putImageData(imageData, dx, dy)

      ctx.save()
      ctx.strokeStyle = 'rgba(18, 22, 30, 0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let row = -2, cy = radius - stepY * 2; cy < dh + stepY * 2; row += 1, cy += stepY) {
        const xOffset = row % 2 === 0 ? radius : radius + stepX / 2
        for (let cx = xOffset - stepX * 2; cx < dw + stepX * 2; cx += stepX) {
          const topY = dy + cy - radius
          const upperY = dy + cy - radius / 2
          const lowerY = dy + cy + radius / 2
          const bottomY = dy + cy + radius
          const leftX = dx + cx - halfHexWidth
          const rightX = dx + cx + halfHexWidth
          const centerX = dx + cx

          ctx.moveTo(centerX, topY)
          ctx.lineTo(rightX, upperY)
          ctx.lineTo(rightX, lowerY)
          ctx.lineTo(centerX, bottomY)
          ctx.lineTo(leftX, lowerY)
          ctx.lineTo(leftX, upperY)
          ctx.closePath()
        }
      }
      ctx.stroke()
      ctx.restore()
    }

    if (activeEffects.twoTone && active.twoTonePalette) {
      const [dark, light] = active.twoTonePalette
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        const pick = lum < 128 ? dark : light
        data[i] = pick[0]
        data[i + 1] = pick[1]
        data[i + 2] = pick[2]
      }
      ctx.putImageData(imageData, dx, dy)
    }

    if (activeEffects.moma && active.momaPalette) {
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      const palette = active.momaPalette
      const nearest = (r: number, g: number, b: number) => {
        let best = palette[0]
        let bestD = Number.POSITIVE_INFINITY
        for (const c of palette) {
          const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2
          if (d < bestD) {
            bestD = d
            best = c
          }
        }
        return best
      }
      for (let i = 0; i < data.length; i += 4) {
        const n = nearest(data[i], data[i + 1], data[i + 2])
        data[i] = n[0]
        data[i + 1] = n[1]
        data[i + 2] = n[2]
      }
      ctx.putImageData(imageData, dx, dy)
    }

    if (activeEffects.popArt) {
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      const palette = active.popArtPalette ?? POP_ART_PALETTES[0]
      const [dark, mid, light] = palette
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        const pick = lum < 85 ? dark : lum < 170 ? mid : light
        data[i] = pick[0]
        data[i + 1] = pick[1]
        data[i + 2] = pick[2]
      }
      ctx.putImageData(imageData, dx, dy)
    }

    if (activeEffects.hopePoster) {
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      const deepNavy: [number, number, number] = [0, 36, 62]
      const mutedBlue: [number, number, number] = [100, 145, 155]
      const cream: [number, number, number] = [244, 220, 165]
      const red: [number, number, number] = [206, 17, 38]
      const creamStripe: [number, number, number] = [132, 162, 166]
      const creamMask = new Uint8Array(dw * dh)

      for (let y = 0; y < dh; y += 1) {
        for (let x = 0; x < dw; x += 1) {
          const p = y * dw + x
          const i = p * 4
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]

          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
          const warmth = r - b

          let pick: [number, number, number]
          if (lum < 58) {
            pick = deepNavy
          } else if (lum < 110) {
            pick = warmth > 18 ? red : mutedBlue
          } else if (lum < 168) {
            pick = warmth > 10 ? cream : mutedBlue
          } else {
            pick = cream
          }

          if (pick === cream) creamMask[p] = 1

          data[i] = pick[0]
          data[i + 1] = pick[1]
          data[i + 2] = pick[2]
        }
      }

      const stripeSpacing = 8
      const stripeThickness = 2
      for (let y = 0; y < dh; y += 1) {
        const inStripeBand = y % stripeSpacing < stripeThickness
        if (!inStripeBand) continue
        for (let x = 0; x < dw; x += 1) {
          const p = y * dw + x
          if (!creamMask[p]) continue
          const i = p * 4
          data[i] = creamStripe[0]
          data[i + 1] = creamStripe[1]
          data[i + 2] = creamStripe[2]
        }
      }

      ctx.putImageData(imageData, dx, dy)
    }

    if (active.ditherLevel > 0) {
      const bayer4 = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5],
      ]
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      const strength = active.ditherLevel / 100
      const levels = Math.max(3, Math.round(3 + strength * 6))
      const q = 255 / (levels - 1)
      for (let y = 0; y < dh; y += 1) {
        for (let x = 0; x < dw; x += 1) {
          const i = (y * dw + x) * 4
          const sourceX = Math.floor(sx + x)
          const sourceY = Math.floor(sy + y)
          const threshold = (bayer4[sourceY % 4][sourceX % 4] - 7.5) / 7.5
          for (let c = 0; c < 3; c += 1) {
            const adjusted = data[i + c] + threshold * 18 * strength
            data[i + c] = Math.round(Math.max(0, Math.min(255, Math.round(adjusted / q) * q)))
          }
        }
      }
      ctx.putImageData(imageData, dx, dy)
    }

    if (active.lineArtLevel > 0) {
      const strength = active.lineArtLevel / 100
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      const gray = new Float32Array(dw * dh)
      for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        gray[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      }
      const edge = new Float32Array(dw * dh)
      for (let y = 1; y < dh - 1; y += 1) {
        for (let x = 1; x < dw - 1; x += 1) {
          const p = y * dw + x
          const gx =
            -gray[p - dw - 1] - 2 * gray[p - 1] - gray[p + dw - 1] +
            gray[p - dw + 1] +
            2 * gray[p + 1] +
            gray[p + dw + 1]
          const gy =
            -gray[p - dw - 1] - 2 * gray[p - dw] - gray[p - dw + 1] +
            gray[p + dw - 1] +
            2 * gray[p + dw] +
            gray[p + dw + 1]
          edge[p] = Math.min(255, Math.sqrt(gx * gx + gy * gy))
        }
      }
      const threshold = 135 - strength * 105
      const mix = Math.min(1, 0.4 + strength * 0.9)
      for (let y = 0; y < dh; y += 1) {
        for (let x = 0; x < dw; x += 1) {
          const p = y * dw + x
          const i = p * 4
          const ink = edge[p] > threshold ? 0 : 255
          data[i] = Math.round(data[i] * (1 - mix) + ink * mix)
          data[i + 1] = Math.round(data[i + 1] * (1 - mix) + ink * mix)
          data[i + 2] = Math.round(data[i + 2] * (1 - mix) + ink * mix)
        }
      }
      ctx.putImageData(imageData, dx, dy)
    }

    if (active.sharpnessLevel > 0) {
      const amount = active.sharpnessLevel / 100
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      const src = new Uint8ClampedArray(data)
      const k = amount * 1.6
      for (let y = 1; y < dh - 1; y += 1) {
        for (let x = 1; x < dw - 1; x += 1) {
          const i = (y * dw + x) * 4
          const l = (y * dw + (x - 1)) * 4
          const r = (y * dw + (x + 1)) * 4
          const u = ((y - 1) * dw + x) * 4
          const d = ((y + 1) * dw + x) * 4
          for (let c = 0; c < 3; c += 1) {
            const v = src[i + c] * (1 + 4 * k) - (src[l + c] + src[r + c] + src[u + c] + src[d + c]) * k
            data[i + c] = Math.max(0, Math.min(255, Math.round(v)))
          }
        }
      }
      ctx.putImageData(imageData, dx, dy)
    }

    if (active.glitchLevel > 0) {
      const t = active.glitchLevel / GLITCH_MAX
      const shift = Math.max(1, Math.round(2 + t * 26))
      const src = ctx.getImageData(dx, dy, dw, dh)
      const out = ctx.createImageData(dw, dh)
      const s = src.data
      const d = out.data

      const sample = (x: number, y: number, c: number) => {
        const sx = Math.max(0, Math.min(dw - 1, x))
        const sy = Math.max(0, Math.min(dh - 1, y))
        return s[(sy * dw + sx) * 4 + c]
      }

      for (let y = 0; y < dh; y += 1) {
        const jitter = Math.round(Math.sin(y * 0.12) * shift * 0.35)
        for (let x = 0; x < dw; x += 1) {
          const i = (y * dw + x) * 4
          const r = sample(x - shift + jitter, y, 0)
          const g = sample(x + jitter, y, 1)
          const b = sample(x + shift + jitter, y, 2)
          d[i] = Math.min(255, r * (1.05 + t * 0.35))
          d[i + 1] = Math.min(255, g * (1.03 + t * 0.25))
          d[i + 2] = Math.min(255, b * (1.06 + t * 0.35))
          d[i + 3] = s[i + 3]
        }
      }

      ctx.putImageData(out, dx, dy)
    }

    const applyNormiesEffect = (normifyRes: number, keepOriginalColor = false) => {
      const base = ctx.getImageData(dx, dy, dw, dh)
      const src = base.data
      const outW = normifyRes
      const outH = Math.max(1, Math.round(normifyRes * dh / Math.max(1, dw)))
      const mono = new Float32Array(outW * outH)

      for (let oy = 0; oy < outH; oy += 1) {
        for (let ox = 0; ox < outW; ox += 1) {
          const sx = Math.min(dw - 1, Math.floor((ox * dw) / outW))
          const sy = Math.min(dh - 1, Math.floor((oy * dh) / outH))
          const i = (sy * dw + sx) * 4
          mono[oy * outW + ox] = src[i] * 0.2126 + src[i + 1] * 0.7152 + src[i + 2] * 0.0722
        }
      }

      let sum = 0
      for (let i = 0; i < mono.length; i += 1) sum += mono[i]
      const mean = sum / Math.max(1, mono.length)
      const contrast = 3
      const brightness = 1.1
      const threshold = 128
      const combinedFactor = contrast * brightness
      const offset = mean * (1 - contrast) * brightness

      for (let i = 0; i < mono.length; i += 1) {
        mono[i] = clamp(mono[i] * combinedFactor + offset, 0, 255)
      }

      const bitmap = new Uint8Array(Math.ceil(outW / 8) * outH)
      for (let y = 0; y < outH; y += 1) {
        for (let x = 0; x < outW; x += 1) {
          const idx = y * outW + x
          const oldVal = mono[idx]
          const newVal = oldVal < threshold ? 0 : 255
          const err = oldVal - newVal

          if (newVal === 0) {
            const byteIdx = y * Math.ceil(outW / 8) + Math.floor(x / 8)
            const bitIdx = 7 - (x % 8)
            bitmap[byteIdx] |= 1 << bitIdx
          }

          if (x + 1 < outW) mono[idx + 1] += (err * 7) / 16
          if (y + 1 < outH) {
            if (x > 0) mono[idx + outW - 1] += (err * 3) / 16
            mono[idx + outW] += (err * 5) / 16
            if (x + 1 < outW) mono[idx + outW + 1] += (err * 1) / 16
          }
        }
      }

      const out = ctx.createImageData(dw, dh)
      const data = out.data
      const dark: [number, number, number] = [72, 73, 75]
      const light: [number, number, number] = [227, 229, 228]
      const bytesPerRow = Math.ceil(outW / 8)

      for (let y = 0; y < dh; y += 1) {
        for (let x = 0; x < dw; x += 1) {
          const ox = Math.min(outW - 1, Math.floor((x * outW) / dw))
          const oy = Math.min(outH - 1, Math.floor((y * outH) / dh))
          const byteIdx = oy * bytesPerRow + Math.floor(ox / 8)
          const bitIdx = 7 - (ox % 8)
          const isDark = ((bitmap[byteIdx] >> bitIdx) & 1) === 1
          const tint = isDark ? dark : light
          const i = (y * dw + x) * 4
          if (keepOriginalColor) {
            const tone = isDark ? 0.42 : 1.08
            data[i] = clamp(Math.round(src[i] * tone), 0, 255)
            data[i + 1] = clamp(Math.round(src[i + 1] * tone), 0, 255)
            data[i + 2] = clamp(Math.round(src[i + 2] * tone), 0, 255)
          } else {
            data[i] = tint[0]
            data[i + 1] = tint[1]
            data[i + 2] = tint[2]
          }
          data[i + 3] = src[i + 3]
        }
      }

      ctx.putImageData(out, dx, dy)
    }

    if (active.effects.sandstorm) {
      applyNormiesEffect(500, false)
    }

    if (active.effects.lineHalftone) {
      const palette = active.lineHalftonePalette ?? active.twoTonePalette ?? [[38, 135, 255], [235, 245, 255]]
      const [ink, paper] = palette
      const imageData = ctx.getImageData(dx, dy, dw, dh)
      const data = imageData.data
      const angle = Math.PI / 4
      const spacing = 7

      for (let y = 0; y < dh; y += 1) {
        for (let x = 0; x < dw; x += 1) {
          const i = (y * dw + x) * 4
          const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          const l = lum / 255
          const stripe = ((x * Math.cos(angle) + y * Math.sin(angle)) % spacing + spacing) % spacing
          const lineMask = stripe < 2.3 ? 1 : 0
          const subjectMask = l < 0.62 ? 1 : 0
          const pickInk = subjectMask ? (l < 0.42 ? 1 : lineMask) : lineMask
          const pick = pickInk ? ink : paper
          data[i] = pick[0]
          data[i + 1] = pick[1]
          data[i + 2] = pick[2]
        }
      }
      ctx.putImageData(imageData, dx, dy)
    }

    drawEffectOverlays(ctx, dx, dy, dw, dh, active)
  }

  const buildCompositeCanvas = (img: HTMLImageElement) => {
    const composite = document.createElement('canvas')
    composite.width = img.width
    composite.height = img.height
    const cctx = composite.getContext('2d')
    if (!cctx) return composite

    if (isGridMode) {
      const cellW = Math.floor(composite.width / gridSize)
      const cellH = Math.floor(composite.height / gridSize)
      for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
          const idx = row * gridSize + col
          drawWithEffects(cctx, img, 0, 0, img.width, img.height, col * cellW, row * cellH, cellW, cellH, gridProfiles[idx])
        }
      }
    } else {
      drawWithEffects(cctx, img, 0, 0, img.width, img.height, 0, 0, composite.width, composite.height, currentProfile)
    }

    return composite
  }

  const fitCanvasToPreview = () => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return

    const previewWrap = canvas.parentElement as HTMLElement | null
    if (!previewWrap) return

    const targetWidth = previewWrap.clientWidth
    const targetHeight = previewWrap.clientHeight
    const innerWidth = targetWidth * 0.9
    const innerHeight = targetHeight * 0.9
    const imageRatio = img.width / img.height
    const boxRatio = innerWidth / innerHeight

    let w: number
    let h: number

    if (boxRatio > imageRatio) {
      h = innerHeight
      w = h * imageRatio
    } else {
      w = innerWidth
      h = w / imageRatio
    }

    // Contain + 10% inner padding space from container bounds.
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
  }

  const draw = () => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return

    canvas.width = img.width
    canvas.height = img.height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const composite = buildCompositeCanvas(img)

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(composite, 0, 0)

    if (isGridMode) {
      if (!preset || !crop) {
        const cellW = Math.floor(canvas.width / gridSize)
        const cellH = Math.floor(canvas.height / gridSize)
        const row = Math.floor(selectedGridCell / gridSize)
        const col = selectedGridCell % gridSize
        const x = col * cellW
        const y = row * cellH
        ctx.save()
        ctx.strokeStyle = '#7fb1ff'
        ctx.lineWidth = 4
        ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)
        ctx.restore()
        return
      }

      ctx.fillStyle = 'rgba(0, 0, 0, 0.96)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.clearRect(crop.x, crop.y, crop.width, crop.height)
      ctx.drawImage(composite, crop.x, crop.y, crop.width, crop.height, crop.x, crop.y, crop.width, crop.height)
      drawPreviewStampFrame(ctx, crop)
      drawClippedBorder(ctx, crop.x, crop.y, crop.width, crop.height)
      ctx.strokeStyle = '#7fb1ff'
      ctx.lineWidth = 4
      ctx.strokeRect(crop.x + 1, crop.y + 1, crop.width - 2, crop.height - 2)
      drawHandles(ctx, crop)
      return
    }

    if (!crop) {
      drawClippedBorder(ctx, 0, 0, canvas.width, canvas.height)
      return
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.96)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.clearRect(crop.x, crop.y, crop.width, crop.height)
    ctx.drawImage(composite, crop.x, crop.y, crop.width, crop.height, crop.x, crop.y, crop.width, crop.height)

    drawPreviewStampFrame(ctx, crop)
    drawClippedBorder(ctx, crop.x, crop.y, crop.width, crop.height)

    ctx.strokeStyle = '#7fb1ff'
    ctx.lineWidth = 4
    ctx.strokeRect(crop.x + 1, crop.y + 1, crop.width - 2, crop.height - 2)

    drawHandles(ctx, crop)
  }

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()

    const x = ((e.clientX - rect.left) / rect.width) * canvas.width
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height
    return { x, y }
  }

  const getResizeCorner = (
    point: { x: number; y: number },
    cropRect: CropRect,
    tolerance: number,
  ): ResizeCorner | null => {
    const corners: { corner: ResizeCorner; x: number; y: number }[] = [
      { corner: 'top-left', x: cropRect.x, y: cropRect.y },
      { corner: 'top-right', x: cropRect.x + cropRect.width, y: cropRect.y },
      { corner: 'bottom-left', x: cropRect.x, y: cropRect.y + cropRect.height },
      { corner: 'bottom-right', x: cropRect.x + cropRect.width, y: cropRect.y + cropRect.height },
    ]

    for (const item of corners) {
      if (Math.abs(point.x - item.x) <= tolerance && Math.abs(point.y - item.y) <= tolerance) {
        return item.corner
      }
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isGridMode && !preset) {
      const point = getCanvasPoint(e)
      const canvas = canvasRef.current
      if (!point || !canvas) return
      const cellW = canvas.width / gridSize
      const cellH = canvas.height / gridSize
      const col = Math.min(gridSize - 1, Math.max(0, Math.floor(point.x / cellW)))
      const row = Math.min(gridSize - 1, Math.max(0, Math.floor(point.y / cellH)))
      const idx = row * gridSize + col
      setSelectedGridCell(idx)
      applyProfile(gridProfiles[idx])
      return
    }

    if (!crop) return
    const point = getCanvasPoint(e)
    const canvas = canvasRef.current
    if (!point || !canvas) return

    const rect = canvas.getBoundingClientRect()
    const tolerance = Math.max(8, Math.round((12 * canvas.width) / rect.width))
    const resizeCorner = getResizeCorner(point, crop, tolerance)

    e.currentTarget.setPointerCapture(e.pointerId)

    if (resizeCorner) {
      setDragMode({
        type: 'resize',
        corner: resizeCorner,
        startX: point.x,
        startY: point.y,
        startRect: crop,
      })
      return
    }

    const inside =
      point.x >= crop.x &&
      point.x <= crop.x + crop.width &&
      point.y >= crop.y &&
      point.y <= crop.y + crop.height

    if (!inside) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }

    setDragMode({ type: 'move', startX: point.x, startY: point.y, startRect: crop })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e)
    const img = imageRef.current
    if (!point || !img) return

    if (dragMode.type === 'move') {
      const dx = point.x - dragMode.startX
      const dy = point.y - dragMode.startY

      const nextX = clamp(
        Math.round(dragMode.startRect.x + dx),
        0,
        img.width - dragMode.startRect.width,
      )
      const nextY = clamp(
        Math.round(dragMode.startRect.y + dy),
        0,
        img.height - dragMode.startRect.height,
      )

      setCrop({ ...dragMode.startRect, x: nextX, y: nextY })
      return
    }

    if (dragMode.type === 'resize') {
      if (!preset) return
      const ratio = getPresetRatio(preset)
      const anchorX = dragMode.corner.includes('left')
        ? dragMode.startRect.x + dragMode.startRect.width
        : dragMode.startRect.x
      const anchorY = dragMode.corner.includes('top')
        ? dragMode.startRect.y + dragMode.startRect.height
        : dragMode.startRect.y

      const widthFromPointer = Math.abs(point.x - anchorX)
      const heightFromPointer = Math.abs(point.y - anchorY) * ratio
      let nextWidth = Math.round(Math.max(MIN_CROP_SIZE, Math.max(widthFromPointer, heightFromPointer)))
      let nextHeight = Math.round(nextWidth / ratio)

      const maxWidthFromAnchor = dragMode.corner.includes('left') ? anchorX : img.width - anchorX
      const maxHeightFromAnchor = dragMode.corner.includes('top') ? anchorY : img.height - anchorY

      if (nextHeight > maxHeightFromAnchor) {
        nextHeight = Math.round(maxHeightFromAnchor)
        nextWidth = Math.round(nextHeight * ratio)
      }
      if (nextWidth > maxWidthFromAnchor) {
        nextWidth = Math.round(maxWidthFromAnchor)
        nextHeight = Math.round(nextWidth / ratio)
      }

      nextWidth = clamp(nextWidth, MIN_CROP_SIZE, img.width)
      nextHeight = clamp(nextHeight, MIN_CROP_SIZE, img.height)

      const nextX = dragMode.corner.includes('left') ? anchorX - nextWidth : anchorX
      const nextY = dragMode.corner.includes('top') ? anchorY - nextHeight : anchorY

      setCrop({
        x: clamp(Math.round(nextX), 0, img.width - nextWidth),
        y: clamp(Math.round(nextY), 0, img.height - nextHeight),
        width: nextWidth,
        height: nextHeight,
      })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragMode.type !== 'none') {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDragMode({ type: 'none' })
  }

  const loadFromFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please drop an image file.')
      return
    }

    setError('')
    const reader = new FileReader()
    reader.onload = () => {
      const data = reader.result
      if (typeof data === 'string') {
        setImageSrc(data)
      }
    }
    reader.onerror = () => {
      setError('Could not read that file. Try another image.')
    }
    reader.readAsDataURL(file)
  }

  const onPreviewDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOverPreview(true)
  }

  const onEmptyUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    loadFromFile(file)
    e.currentTarget.value = ''
  }

  const onPreviewDragLeave = () => {
    setIsDragOverPreview(false)
  }

  const onPreviewDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOverPreview(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    loadFromFile(file)
  }

  const loadFromUrl = async () => {
    const raw = urlInput.trim()
    if (!raw) return

    setError('')

    const toDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const data = reader.result
          if (typeof data === 'string') resolve(data)
          else reject(new Error('Invalid file reader output'))
        }
        reader.onerror = () => reject(new Error('Could not read image blob'))
        reader.readAsDataURL(blob)
      })

    const tryFetchToDataUrl = async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
      const blob = await response.blob()
      return toDataUrl(blob)
    }

    const proxyCandidates = [
      IMPORT_PROXY_URL ? `${IMPORT_PROXY_URL}${IMPORT_PROXY_URL.includes('?') ? '&' : '?'}url=${encodeURIComponent(raw)}` : '',
      `/image-proxy?url=${encodeURIComponent(raw)}`,
      raw,
      `https://corsproxy.io/?${encodeURIComponent(raw)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(raw)}`,
    ].filter(Boolean)

    for (const candidate of proxyCandidates) {
      try {
        const dataUrl = await tryFetchToDataUrl(candidate)
        setImageSrc(dataUrl)
        return
      } catch {
        // try next candidate
      }
    }

    setError('Could not import this URL. This host may block cross-origin image access (CORS). Please download the image and upload it directly.')
  }

  const resetUploadedImage = () => {
    setImageSrc('')
    setUrlInput('')
    setPreset(null)
    setCrop(null)
    setError('')
    setIsDragOverPreview(false)
  }

  const applyPreset = (nextPreset: Preset) => {
    const img = imageRef.current

    if (preset === nextPreset) {
      setPreset(null)
      setCrop(null)
      return
    }

    setPreset(nextPreset)
    if (!img) return
    setCrop(buildPresetCrop(img, nextPreset))
  }

  const exportStamp = () => {
    const img = imageRef.current
    if (!img) return

    const exportRect = crop ?? { x: 0, y: 0, width: img.width, height: img.height }

    const output = document.createElement('canvas')
    output.width = exportRect.width
    output.height = exportRect.height

    const ctx = output.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    ;(ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'low'

    const composite = buildCompositeCanvas(img)
    ctx.drawImage(
      composite,
      exportRect.x,
      exportRect.y,
      exportRect.width,
      exportRect.height,
      0,
      0,
      exportRect.width,
      exportRect.height,
    )
    drawClippedBorder(ctx, 0, 0, exportRect.width, exportRect.height)

    const dataUrl = output.toDataURL('image/png')
    const stampId = crypto.randomUUID()
    setNewestStampId(stampId)
    setStamps((prev) => [{ id: stampId, src: dataUrl, baseSrc: dataUrl, ratio: exportRect.width / exportRect.height, preset }, ...prev])
  }

  const toggleEffect = (key: keyof StampEffects) => {
    setEffects((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      let nextPalette: [[number, number, number], [number, number, number]] | null = twoTonePalette
      let nextLineHalftone = lineHalftonePalette
      let nextPopArt = popArtPalette
      let nextMoma = momaPalette

      if (key === 'twoTone' && next.twoTone) {
        const img = imageRef.current
        if (img) {
          nextPalette = pickTwoTonePalette(img, crop)
          setTwoTonePalette(nextPalette)
        }
      }
      if (key === 'twoTone' && !next.twoTone) {
        nextPalette = null
        setTwoTonePalette(null)
      }

      if (key === 'lineHalftone' && next.lineHalftone) {
        const img = imageRef.current
        if (img) {
          nextLineHalftone = pickTwoTonePalette(img, crop)
          setLineHalftonePalette(nextLineHalftone)
        }
      }
      if (key === 'lineHalftone' && !next.lineHalftone) {
        nextLineHalftone = null
        setLineHalftonePalette(null)
      }

      if (key === 'popArt' && next.popArt) {
        nextPopArt = POP_ART_PALETTES[Math.floor(Math.random() * POP_ART_PALETTES.length)]
        setPopArtPalette(nextPopArt)
      }
      if (key === 'popArt' && !next.popArt) {
        nextPopArt = null
        setPopArtPalette(null)
      }

      if (key === 'moma' && next.moma) {
        nextMoma = MOMA_PALETTES[Math.floor(Math.random() * MOMA_PALETTES.length)]
        setMomaPalette(nextMoma)
      }
      if (key === 'moma' && !next.moma) {
        nextMoma = null
        setMomaPalette(null)
      }

      persistCurrentToGridCell(selectedGridCell, {
        effects: next,
        twoTonePalette: nextPalette,
        lineHalftonePalette: nextLineHalftone,
        popArtPalette: nextPopArt,
        momaPalette: nextMoma,
      })
      return next
    })
  }

  const resetEffects = () => {
    const profile = createDefaultProfile()
    applyProfile(profile)
    if (isGridMode) {
      setGridProfiles((prev) => {
        const next = [...prev]
        next[selectedGridCell] = profile
        return next
      })
    }
  }

  const updateLevel = (
    key:
      | 'ditherLevel'
      | 'brightnessLevel'
      | 'contrastLevel'
      | 'saturationLevel'
      | 'pixelateLevel'
      | 'mosaicHexLevel'
      | 'glitchLevel'
      | 'lineArtLevel'
      | 'sharpnessLevel'
      | 'normifyLevel',
    value: number,
  ) => {
    if (key === 'ditherLevel') setDitherLevel(value)
    if (key === 'brightnessLevel') setBrightnessLevel(value)
    if (key === 'contrastLevel') setContrastLevel(value)
    if (key === 'saturationLevel') setSaturationLevel(value)
    if (key === 'pixelateLevel') setResolutionLevel(value)
    if (key === 'mosaicHexLevel') setMosaicHexLevel(value)
    if (key === 'glitchLevel') setGlitchLevel(value)
    if (key === 'lineArtLevel') setLineArtLevel(value)
    if (key === 'sharpnessLevel') setSharpnessLevel(value)
    if (key === 'normifyLevel') setNormifyLevel(value)
    persistCurrentToGridCell(selectedGridCell, { [key]: value } as Partial<EffectProfile>)
  }

  const getActiveTextLayer = () =>
    modalEdits.textLayers.find((layer) => layer.id === modalEdits.activeTextId) ?? null

  const updateLayer = (id: string, updater: (layer: ModalTextLayer) => ModalTextLayer) => {
    setModalEdits((prev) => ({
      ...prev,
      textLayers: prev.textLayers.map((layer) => (layer.id === id ? updater(layer) : layer)),
    }))
  }

  const updateIconLayer = (id: string, updater: (icon: ModalIconLayer) => ModalIconLayer) => {
    setModalEdits((prev) => ({
      ...prev,
      iconLayers: prev.iconLayers.map((icon) => (icon.id === id ? updater(icon) : icon)),
    }))
  }

  const iconToPx = (icon: ModalIconLayer) => {
    const r = modalIconOverlayRef.current?.getBoundingClientRect()
    if (!r) return icon
    if (icon.x <= 100 && icon.y <= 100 && icon.size <= 100) {
      return { ...icon, x: (icon.x / 100) * r.width, y: (icon.y / 100) * r.height, size: (icon.size / 100) * r.width }
    }
    return icon
  }

  const onIconPointerDown = (e: React.PointerEvent<HTMLDivElement>, icon: ModalIconLayer) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    const px = iconToPx(icon)
    if (px !== icon) updateIconLayer(icon.id, () => px)
    setModalEdits((prev) => ({ ...prev, activeIconId: icon.id, activeTextId: null }))
    setIconDrag({ mode: 'move', id: icon.id, startX: e.clientX, startY: e.clientY, startIconX: px.x, startIconY: px.y })
  }

  const onTextPointerDown = (e: React.PointerEvent<HTMLDivElement>, layer: ModalTextLayer) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    setModalEdits((prev) => ({ ...prev, activeTextId: layer.id }))
    setTextDrag({
      mode: 'move',
      id: layer.id,
      startX: e.clientX,
      startY: e.clientY,
      startLayerX: layer.x,
      startLayerY: layer.y,
    })
  }

  const onImagePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const edge = 20
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const nearLeft = x < edge
    const nearRight = x > rect.width - edge
    const nearTop = y < edge
    const nearBottom = y > rect.height - edge

    if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
      setImageAdjustDrag({ mode: 'zoom', startX: e.clientX, startY: e.clientY, startZoom: modalEdits.zoom, axis: 'corner' })
      return
    }
    if (nearLeft || nearRight) {
      setImageAdjustDrag({ mode: 'zoom', startX: e.clientX, startY: e.clientY, startZoom: modalEdits.zoom, axis: 'side-x' })
      return
    }
    if (nearTop || nearBottom) {
      setImageAdjustDrag({ mode: 'zoom', startX: e.clientX, startY: e.clientY, startZoom: modalEdits.zoom, axis: 'side-y' })
      return
    }

    setImageAdjustDrag({
      mode: 'move',
      startX: e.clientX,
      startY: e.clientY,
      startPanX: modalEdits.panX,
      startPanY: modalEdits.panY,
    })
  }

  const onHandlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, layer: ModalTextLayer) => {
    e.preventDefault()
    e.stopPropagation()
    const stamp = modalStampFrameRef.current
    if (!stamp) return
    ;(e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId)
    const rect = stamp.getBoundingClientRect()
    const centerX = rect.left + (rect.width * layer.x) / 100
    const centerY = rect.top + (rect.height * layer.y) / 100
    const dx = e.clientX - centerX
    const dy = e.clientY - centerY
    setModalEdits((prev) => ({ ...prev, activeTextId: layer.id }))
    setTextDrag({
      mode: 'transform',
      id: layer.id,
      centerX,
      centerY,
      startAngle: Math.atan2(dy, dx),
      startDist: Math.max(8, Math.hypot(dx, dy)),
      startSize: layer.size,
      startRotation: layer.rotation,
    })
  }

  useEffect(() => {
    if (textDrag.mode === 'none') return
    const onMove = (ev: PointerEvent) => {
      if (textDrag.mode === 'move') {
        const stamp = modalStampFrameRef.current
        if (!stamp) return
        const rect = stamp.getBoundingClientRect()
        const xPct = ((ev.clientX - rect.left) / rect.width) * 100
        const yPct = ((ev.clientY - rect.top) / rect.height) * 100
        updateLayer(textDrag.id, (layer) => ({
          ...layer,
          x: clamp(xPct, 0, 100),
          y: clamp(yPct, 0, 100),
        }))
        return
      }

      if (textDrag.mode === 'transform') {
        const dx = ev.clientX - textDrag.centerX
        const dy = ev.clientY - textDrag.centerY
        const angle = Math.atan2(dy, dx)
        const dist = Math.max(8, Math.hypot(dx, dy))
        const rotDelta = ((angle - textDrag.startAngle) * 180) / Math.PI
        const sizeRatio = dist / textDrag.startDist
        updateLayer(textDrag.id, (layer) => ({
          ...layer,
          rotation: textDrag.startRotation + rotDelta,
          size: clamp(Math.round(textDrag.startSize * sizeRatio), 12, 180),
        }))
      }
    }

    const onUp = () => setTextDrag({ mode: 'none' })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [textDrag])

  useEffect(() => {
    if (iconDrag.mode === 'none') return
    const onMove = (ev: PointerEvent) => {
      if (iconDrag.mode === 'move') {
        const frame = modalIconOverlayRef.current
        if (!frame) return
        const rect = frame.getBoundingClientRect()
        const dx = ev.clientX - iconDrag.startX
        const dy = ev.clientY - iconDrag.startY
        updateIconLayer(iconDrag.id, (icon) => {
          const nextX = iconDrag.startIconX + dx
          const nextY = iconDrag.startIconY + dy
          const half = icon.size / 2
          return { ...icon, x: clamp(nextX, half, rect.width - half), y: clamp(nextY, half, rect.height - half) }
        })
      }
    }

    const onUp = () => setIconDrag({ mode: 'none' })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [iconDrag])

  useEffect(() => {
    if (imageAdjustDrag.mode === 'none') return
    const onMove = (ev: PointerEvent) => {
      if (imageAdjustDrag.mode === 'move') {
        const dx = ev.clientX - imageAdjustDrag.startX
        const dy = ev.clientY - imageAdjustDrag.startY
        setModalEdits((prev) => ({
          ...prev,
          panX: clamp(imageAdjustDrag.startPanX + dx * 0.08, -120, 120),
          panY: clamp(imageAdjustDrag.startPanY + dy * 0.08, -120, 120),
        }))
        return
      }

      const dx = ev.clientX - imageAdjustDrag.startX
      const dy = ev.clientY - imageAdjustDrag.startY
      const delta = imageAdjustDrag.axis === 'corner' ? dx - dy : imageAdjustDrag.axis === 'side-x' ? dx : -dy
      setModalEdits((prev) => ({ ...prev, zoom: clamp(imageAdjustDrag.startZoom + delta * 0.01, 0.1, 10) }))
    }

    const onUp = () => setImageAdjustDrag({ mode: 'none' })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [imageAdjustDrag])

  const renderEditedStamp = (src: string, edits: ModalStampEdits, includeText = true) =>
    new Promise<string>((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(src)
          return
        }

        ctx.imageSmoothingEnabled = false
        ;(ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'low'

        const drawW = canvas.width * edits.zoom
        const drawH = canvas.height * edits.zoom
        const dx = (canvas.width - drawW) / 2 + (edits.panX / 100) * canvas.width
        const dy = (canvas.height - drawH) / 2 + (edits.panY / 100) * canvas.height
        ctx.drawImage(img, dx, dy, drawW, drawH)

        if (edits.fade > 0 || edits.dither > 0 || edits.texture > 0) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const data = imageData.data

          if (edits.fade > 0) {
            const t = edits.fade / 100
            for (let i = 0; i < data.length; i += 4) {
              data[i] = Math.min(255, Math.round(data[i] + (255 - data[i]) * t * 0.45))
              data[i + 1] = Math.min(255, Math.round(data[i + 1] + (255 - data[i + 1]) * t * 0.45))
              data[i + 2] = Math.min(255, Math.round(data[i + 2] + (255 - data[i + 2]) * t * 0.45))
            }
          }

          if (edits.dither > 0) {
            const bayer4 = [
              [0, 8, 2, 10],
              [12, 4, 14, 6],
              [3, 11, 1, 9],
              [15, 7, 13, 5],
            ]
            const strength = edits.dither / 100
            const levels = Math.max(3, Math.round(3 + strength * 5))
            const q = 255 / (levels - 1)
            for (let y = 0; y < canvas.height; y += 1) {
              for (let x = 0; x < canvas.width; x += 1) {
                const i = (y * canvas.width + x) * 4
                const threshold = (bayer4[y % 4][x % 4] - 7.5) / 7.5
                for (let c = 0; c < 3; c += 1) {
                  const adjusted = data[i + c] + threshold * 18 * strength
                  data[i + c] = Math.round(Math.max(0, Math.min(255, Math.round(adjusted / q) * q)))
                }
              }
            }
          }

          if (edits.texture > 0) {
            const t = edits.texture / 100
            const isHalftone = edits.texturePreset.startsWith('halftone-')
            const dotStep = 8

            for (let y = 0; y < canvas.height; y += 1) {
              for (let x = 0; x < canvas.width; x += 1) {
                const i = (y * canvas.width + x) * 4
                const baseNoise = (Math.random() - 0.5) * 30 * t
                let pattern = 0

                if (edits.texturePreset === 'paper') {
                  pattern = Math.sin((x + y * 0.32) * 0.09) * 9 * t
                } else if (edits.texturePreset === 'wavy') {
                  pattern = (Math.sin(y * 0.07 + Math.sin(x * 0.01) * 2.4) * 16 + Math.sin(x * 0.02) * 5) * t
                } else if (edits.texturePreset === 'grit') {
                  pattern = ((x * 17 + y * 13) % 23 < 2 ? -34 : 0) * t
                } else {
                  const cx = (x % dotStep) - dotStep / 2
                  const cy = (y % dotStep) - dotStep / 2
                  const dist = Math.hypot(cx, cy)
                  const radius = 1.6 + t * 2.8
                  const dot = dist < radius ? -34 * t : 0

                  const applyC = edits.texturePreset === 'halftone-cmyk' || edits.texturePreset === 'halftone-c'
                  const applyM = edits.texturePreset === 'halftone-cmyk' || edits.texturePreset === 'halftone-m'
                  const applyY = edits.texturePreset === 'halftone-cmyk' || edits.texturePreset === 'halftone-y'
                  const applyK = edits.texturePreset === 'halftone-cmyk' || edits.texturePreset === 'halftone-k'

                  if (applyC) data[i] = clamp(Math.round(data[i] + dot * 0.35), 0, 255)
                  if (applyM) data[i + 1] = clamp(Math.round(data[i + 1] + dot * 0.35), 0, 255)
                  if (applyY) data[i + 2] = clamp(Math.round(data[i + 2] + dot * 0.35), 0, 255)
                  if (applyK) {
                    const kDelta = dot * 0.48
                    data[i] = clamp(Math.round(data[i] + kDelta), 0, 255)
                    data[i + 1] = clamp(Math.round(data[i + 1] + kDelta), 0, 255)
                    data[i + 2] = clamp(Math.round(data[i + 2] + kDelta), 0, 255)
                  }

                  pattern = 0
                }

                if (!isHalftone) {
                  const delta = baseNoise + pattern
                  data[i] = clamp(Math.round(data[i] + delta), 0, 255)
                  data[i + 1] = clamp(Math.round(data[i + 1] + delta * 0.92), 0, 255)
                  data[i + 2] = clamp(Math.round(data[i + 2] + delta * 0.88), 0, 255)
                }
              }
            }
          }

          ctx.putImageData(imageData, 0, 0)
        }

        if (includeText) {
          edits.textLayers.forEach((layer) => {
            if (!layer.text.trim()) return
            const tx = (canvas.width * layer.x) / 100
            const ty = (canvas.height * layer.y) / 100
            ctx.save()
            ctx.globalAlpha = clamp(layer.opacity / 100, 0, 1)
            ctx.translate(tx, ty)
            ctx.rotate((layer.rotation * Math.PI) / 180)
            ctx.fillStyle = layer.color
            const fontSpec = getModalFontSpec(layer.font)
            ctx.font = `${fontSpec.style} ${fontSpec.weight} ${layer.size}px "${fontSpec.family}", sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(layer.text, 0, 0)
            ctx.restore()
          })

        }

        resolve(canvas.toDataURL('image/png'))
      }
      img.src = src
    })

  useEffect(() => {
    if (!selectedStamp) {
      setModalStampSrc('')
      return
    }

    const merged = { ...createDefaultModalEdits(), ...(selectedStamp.stamp.modalEdits ?? {}) }
    if (merged.wallColor === '#24314a') merged.wallColor = '#14161b'
    if (merged.stampColor === '#fbf4e5') merged.stampColor = '#ece4d3'
    setModalEdits(merged)
  }, [selectedStamp?.index])

  useEffect(() => {
    if (!selectedStamp) {
      setModalStampSrc('')
      return
    }
    if (!modalEdits.activeTextId && modalEdits.textLayers.length > 0) {
      setModalEdits((prev) => ({ ...prev, activeTextId: prev.textLayers[0].id }))
      return
    }
    if (!modalEdits.activeIconId && modalEdits.iconLayers.length > 0) {
      setModalEdits((prev) => ({ ...prev, activeIconId: prev.iconLayers[0].id }))
      return
    }
    renderEditedStamp(selectedStamp.stamp.src, modalEdits, false).then(setModalStampSrc)
  }, [selectedStamp, modalEdits])

  const resetModalEdits = () => {
    setModalEdits(createDefaultModalEdits())
  }

  const closeModal = async () => {
    if (!selectedStamp) {
      setSelectedStamp(null)
      return
    }

    const baseSrc = selectedStamp.stamp.baseSrc || selectedStamp.stamp.src
    const saved = await renderEditedStamp(baseSrc, modalEdits, false)
    const storedEdits = structuredClone(modalEdits)

    setStamps((prev) =>
      prev.map((item, idx) =>
        idx === selectedStamp.index
          ? { ...item, src: saved, baseSrc, modalEdits: storedEdits }
          : item,
      ),
    )

    setSelectedStamp(null)
  }

  const renderModalSceneImage = async (sizePct = exportSizePct, transparentBackground = false) => {
    if (!selectedStamp) return ''
    const stampEl = modalStampFrameRef.current
    const imageEl = modalImageElementRef.current
    const iconOverlayEl = modalIconOverlayRef.current
    if (!stampEl || !imageEl || !iconOverlayEl) return ''

    const stampRect = stampEl.getBoundingClientRect()
    const imageRect = imageEl.getBoundingClientRect()
    const scale = 2 * (sizePct / 100)

    const stampW = stampRect.width * scale
    const stampH = stampRect.height * scale
    const stampMax = Math.max(stampW, stampH)
    const exportPadding = transparentBackground ? 0 : Math.round(stampMax * 0.2)
    const canvasWidth = transparentBackground
      ? Math.max(1, Math.round(stampW))
      : Math.max(1, Math.round(stampMax + exportPadding * 2))
    const canvasHeight = transparentBackground
      ? Math.max(1, Math.round(stampH))
      : Math.max(1, Math.round(stampMax + exportPadding * 2))

    const stampX = transparentBackground ? 0 : (canvasWidth - stampW) / 2
    const stampY = transparentBackground ? 0 : (canvasHeight - stampH) / 2

    const imageOffsetX = (imageRect.left - stampRect.left) * scale
    const imageOffsetY = (imageRect.top - stampRect.top) * scale
    const imageW = imageRect.width * scale
    const imageH = imageRect.height * scale
    const imageX = stampX + imageOffsetX
    const imageY = stampY + imageOffsetY

    const canvas = document.createElement('canvas')
    canvas.width = canvasWidth
    canvas.height = canvasHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    ctx.imageSmoothingEnabled = false
    ;(ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'low'

    ctx.clearRect(0, 0, canvasWidth, canvasHeight)
    if (!transparentBackground) {
      ctx.fillStyle = modalEdits.wallColor
      ctx.fillRect(0, 0, canvasWidth, canvasHeight)
    }

    ctx.fillStyle = modalEdits.stampColor
    ctx.fillRect(stampX, stampY, stampW, stampH)

    const drawPerforationHoles = () => {
      const perf = Math.max(4, modalEdits.perforationSize * scale)
      const holeRadius = perf * 0.38
      const holeStep = perf * 1.18

      if (transparentBackground) {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        for (let x = stampX; x <= stampX + stampW; x += holeStep) {
          ctx.beginPath()
          ctx.arc(x, stampY, holeRadius, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x, stampY + stampH, holeRadius, 0, Math.PI * 2)
          ctx.fill()
        }
        for (let y = stampY; y <= stampY + stampH; y += holeStep) {
          ctx.beginPath()
          ctx.arc(stampX, y, holeRadius, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.arc(stampX + stampW, y, holeRadius, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
        return
      }

      ctx.fillStyle = modalEdits.wallColor
      for (let x = stampX; x <= stampX + stampW; x += holeStep) {
        ctx.beginPath()
        ctx.arc(x, stampY, holeRadius, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, stampY + stampH, holeRadius, 0, Math.PI * 2)
        ctx.fill()
      }
      for (let y = stampY; y <= stampY + stampH; y += holeStep) {
        ctx.beginPath()
        ctx.arc(stampX, y, holeRadius, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(stampX + stampW, y, holeRadius, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const baseSrc = selectedStamp.stamp.baseSrc || selectedStamp.stamp.src
    const processedImage = await renderEditedStamp(baseSrc, modalEdits, false)

    await new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, imageX, imageY, imageW, imageH)

        modalEdits.textLayers.forEach((layer) => {
          if (!layer.text.trim()) return
          const tx = stampX + (layer.x / 100) * stampW
          const ty = stampY + (layer.y / 100) * stampH
          ctx.save()
          ctx.globalAlpha = clamp(layer.opacity / 100, 0, 1)
          ctx.translate(tx, ty)
          ctx.rotate((layer.rotation * Math.PI) / 180)
          ctx.fillStyle = layer.color
          const fontSpec = getModalFontSpec(layer.font)
          ctx.font = `${fontSpec.style} ${fontSpec.weight} ${layer.size * scale}px "${fontSpec.family}", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(layer.text, 0, 0)
          ctx.restore()
        })
        resolve()
      }
      img.onerror = () => resolve()
      img.src = processedImage
    })

    const iconRectMap = new Map<string, DOMRect>()
    iconOverlayEl.querySelectorAll<HTMLElement>('[data-icon-id]').forEach((el) => {
      const id = el.dataset.iconId
      if (!id) return
      const r = el.getBoundingClientRect()
      if (r.width > 0.5 && r.height > 0.5) iconRectMap.set(id, r)
    })

    await Promise.all(
      modalEdits.iconLayers.map(
        (icon) =>
          new Promise<void>((resolve) => {
            const iconImg = new Image()
            iconImg.onload = () => {
              const rect = iconRectMap.get(icon.id)
              let dx: number
              let dy: number
              let dw: number
              let dh: number

              if (rect && rect.width > 0.5 && rect.height > 0.5) {
                dx = stampX + (rect.left - stampRect.left) * scale
                dy = stampY + (rect.top - stampRect.top) * scale
                dw = rect.width * scale
                dh = rect.height * scale
              } else {
                const overlayRect = iconOverlayEl.getBoundingClientRect()
                const sx = (overlayRect.width * scale) / Math.max(1, overlayRect.width)
                const sy = (overlayRect.height * scale) / Math.max(1, overlayRect.height)
                dw = icon.size * sx
                dh = (dw * iconImg.naturalHeight) / Math.max(1, iconImg.naturalWidth)
                const cx = stampX + icon.x * sx
                const cy = stampY + icon.y * sy
                dx = cx - dw / 2
                dy = cy - dh / 2
              }

              ctx.save()
              ctx.globalAlpha = clamp(icon.opacity / 100, 0, 1)
              ctx.filter = icon.inverse ? 'invert(1)' : 'none'
              ctx.drawImage(iconImg, dx, dy, dw, dh)
              ctx.filter = 'none'
              ctx.restore()
              resolve()
            }
            iconImg.onerror = () => resolve()
            iconImg.src = icon.src
          }),
      ),
    )

    // Draw perforation holes last so they stay visible on top of image/icon layers.
    drawPerforationHoles()

    return canvas.toDataURL('image/png')
  }

  const exportModalImage = async (sizePct = exportSizePct) => {
    const src = await renderModalSceneImage(sizePct)
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = `stamp-scene-${Date.now()}.png`
    a.click()
  }

  const effectButtons: { key: keyof StampEffects; label: string; icon: string }[] = [
    { key: 'darkBorder', label: 'Border', icon: '▣' },
    { key: 'twoTone', label: '2-Tone', icon: '◪' },
    { key: 'inverse', label: 'Inverse', icon: '◫' },
    { key: 'popArt', label: 'Pop Art', icon: '✸' },
    { key: 'hopePoster', label: 'Hope Poster', icon: '★' },
    { key: 'moma', label: 'MoMA', icon: '◈' },
    { key: 'sandstorm', label: 'Sandstorm', icon: '◧' },
    { key: 'lineHalftone', label: 'Line Tone', icon: '▧' },
  ]

  return (
    <main className={themeMode === 'night' ? 'app simple-ui theme-night' : 'app simple-ui theme-day'}>
      {error && <p className="error">{error}</p>}

      <div ref={contentAreaRef} className="main-content-shell">
          <section className="workspace simple-layout">
            <div className="editor-topbar" aria-label="Theme mode">
              <label htmlFor="dark-mode-toggle" className="theme-switch-label" data-dark-mode={themeMode === 'night'}>
                <div className="switch">
                  <input
                    id="dark-mode-toggle"
                    type="checkbox"
                    checked={themeMode === 'night'}
                    onChange={(e) => setThemeMode(e.target.checked ? 'night' : 'day')}
                  />
                  <div className="insetcover">
                    <div className="sun-moon sun" />
                    <div className="sun-moon moon" />
                    <div className="stars" />
                  </div>
                  <div className="sun-moon-shadow" />
                  <div className="shadow-overlay" />
                </div>
              </label>
            </div>

            <div className={isDatabaseOpen ? 'workspace-switch show-db' : 'workspace-switch'}>
              <div className="workspace-pane editor-pane">
                <div
                  ref={editorMainRef}
                  className={
                    hasImage
                      ? `editor-main has-image${isHistoryOpen ? ' has-history' : ''}`
                      : `editor-main${isHistoryOpen ? ' has-history' : ''}`
                  }
                >
                  <aside className="editor-effects">
                    {hasImage && (
                      <>
                        <nav className="effect-nav open" aria-label="Effects">
                          <div className="nav-mode-group" role="tablist" aria-label="Preview mode">
                            <button type="button" className={previewMode === 'single' ? 'effect-nav-item active' : 'effect-nav-item'} onClick={() => setPreviewMode('single')}>
                              <span className="effect-nav-icon" aria-hidden="true">◻</span>
                              <span className="effect-nav-label">Single</span>
                            </button>
                            <button
                              type="button"
                              className={previewMode === 'grid2' ? 'effect-nav-item active' : 'effect-nav-item'}
                              onClick={() => {
                                setPreviewMode('grid2')
                                setSelectedGridCell((prev) => Math.min(prev, 3))
                                applyProfile(gridProfiles[Math.min(selectedGridCell, 3)])
                              }}
                            >
                              <span className="effect-nav-icon" aria-hidden="true">▣</span>
                              <span className="effect-nav-label">2x2</span>
                            </button>
                            <button
                              type="button"
                              className={previewMode === 'grid' ? 'effect-nav-item active' : 'effect-nav-item'}
                              onClick={() => {
                                setPreviewMode('grid')
                                applyProfile(gridProfiles[selectedGridCell])
                              }}
                            >
                              <span className="effect-nav-icon" aria-hidden="true">▦</span>
                              <span className="effect-nav-label">3x3</span>
                            </button>
                          </div>
                          {effectButtons.map((effect) => (
                            <button
                              key={effect.key}
                              type="button"
                              className={effects[effect.key] ? 'effect-nav-item active' : 'effect-nav-item'}
                              onClick={() => toggleEffect(effect.key)}
                              title={effect.label}
                              aria-pressed={effects[effect.key]}
                            >
                              <span className="effect-nav-icon" aria-hidden="true">{effect.icon}</span>
                              <span className="effect-nav-label">{effect.label}</span>
                            </button>
                          ))}
                          <button type="button" className="effect-nav-item reset" onClick={resetEffects}>
                            <span className="effect-nav-icon" aria-hidden="true">↺</span>
                            <span className="effect-nav-label">Reset</span>
                          </button>

                          <div className="effect-nav-sliders">
                            <label><span>Brightness</span><input type="range" min={BRIGHTNESS_MIN} max={BRIGHTNESS_MAX} step={1} value={brightnessLevel} onChange={(e) => updateLevel('brightnessLevel', Number(e.target.value))} /></label>
                            <label><span>Contrast</span><input type="range" min={-100} max={100} step={1} value={contrastLevel} onChange={(e) => updateLevel('contrastLevel', Number(e.target.value))} /></label>
                            <label><span>Saturation</span><input type="range" min={-100} max={100} step={1} value={saturationLevel} onChange={(e) => updateLevel('saturationLevel', Number(e.target.value))} /></label>
                            <label><span>Sharpness</span><input type="range" min={0} max={100} step={1} value={sharpnessLevel} onChange={(e) => updateLevel('sharpnessLevel', Number(e.target.value))} /></label>
                            <label><span>Dither</span><input type="range" min={0} max={100} step={1} value={ditherLevel} onChange={(e) => updateLevel('ditherLevel', Number(e.target.value))} /></label>
                            <label><span>Pixelate</span><input type="range" min={0} max={PIXELATE_MAX} step={1} value={pixelateLevel} onChange={(e) => updateLevel('pixelateLevel', Number(e.target.value))} /></label>
                            <label><span>Mosaic Hex</span><input type="range" min={0} max={MOSAIC_HEX_MAX} step={1} value={mosaicHexLevel} onChange={(e) => updateLevel('mosaicHexLevel', Number(e.target.value))} /></label>
                            <label><span>Glitch</span><input type="range" min={0} max={GLITCH_MAX} step={1} value={glitchLevel} onChange={(e) => updateLevel('glitchLevel', Number(e.target.value))} /></label>
                            <label><span>Line Art</span><input type="range" min={0} max={100} step={1} value={lineArtLevel} onChange={(e) => updateLevel('lineArtLevel', Number(e.target.value))} /></label>
                          </div>
                        </nav>
                      </>
                    )}
                  </aside>

                  <div className="editor-preview-column">
                    <div className={isDragOverPreview ? 'preview-wrap drag-over' : 'preview-wrap'} onDragOver={onPreviewDragOver} onDragLeave={onPreviewDragLeave} onDrop={onPreviewDrop}>
                      {isLoading && <div className="placeholder">Loading image...</div>}
                      {!hasImage && !isLoading && (
                        <div className="empty-stamp-dropzone">
                          <input
                            ref={emptyUploadInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden-upload-input"
                            onChange={onEmptyUploadChange}
                          />
                          <button
                            type="button"
                            className="empty-stamp-shell"
                            onClick={() => emptyUploadInputRef.current?.click()}
                          >
                            <div className="empty-stamp-image" />
                            <div className="empty-stamp-cta">
                              <span>Click or drag an image to upload</span>
                            </div>
                          </button>
                          <div className="url-import-below">
                            <span className="or-text">or import from URL</span>
                            <div className="url-import-inline">
                              <input
                                value={urlInput}
                                onChange={(e) => setUrlInput(e.target.value)}
                                placeholder="https://example.com/image.jpg"
                              />
                              <button type="button" onClick={loadFromUrl}>Import</button>
                            </div>
                          </div>
                        </div>
                      )}
                      {isDragOverPreview && <div className="drop-overlay">Drop to upload image</div>}
                      <canvas ref={canvasRef} className={hasImage ? 'preview show' : 'preview'} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
                    </div>

                    <div className="bottom-controls">
                      <div className="preset-row minimal" role="radiogroup" aria-label="Clip presets">
                        {PRESET_OPTIONS.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            className={preset === option.key ? 'preset-btn icon-only active' : 'preset-btn icon-only'}
                            onClick={() => applyPreset(option.key)}
                            title={option.label}
                          >
                            <span className={`preset-icon ${option.key}`} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                      <button onClick={exportStamp} disabled={!hasImage} className="clip-btn">Generate Stamp</button>
                      <button onClick={resetUploadedImage} disabled={!hasImage} className="clip-btn">Reset</button>
                    </div>
                  </div>

                  <aside className={isHistoryOpen ? 'history-pane open' : 'history-pane'}>
                    <div className="history-list">
                      {historyImages.length > 0 ? (
                        historyImages.map((src, index) => (
                          <button
                            key={`${src}-${index}`}
                            type="button"
                            className="history-item"
                            onClick={() => {
                              skipNextHistoryWriteRef.current = true
                              setImageSrc(src)
                              setIsHistoryOpen(false)
                            }}
                            title="Recall image"
                          >
                            <img src={src} alt={`History image ${index + 1}`} />
                          </button>
                        ))
                      ) : (
                        <p className="history-empty">No images yet.</p>
                      )}
                    </div>
                  </aside>
                </div>
              </div>

              <div className="workspace-pane database-pane">
                <section className="database-section database-section-full">
                  <div className="database-panel open database-panel-replace database-slide-left" style={{ height: `${databasePanelHeight}px` }}>
                    {databaseStamps.length > 0 ? (
                      <>
                        <div className="database-grid">
                          {pagedDatabaseStamps.map((stamp, index) => (
                            <button
                              key={stamp.id}
                              type="button"
                              className="database-card"
                              onClick={() => setSelectedDatabaseStamp(stamp)}
                              title="Expand stamp"
                            >
                              <img src={stamp.src} alt={`Database stamp ${(databasePage - 1) * DATABASE_PAGE_SIZE + index + 1}`} />
                            </button>
                          ))}
                        </div>
                        <div className="database-pagination">
                          <button
                            type="button"
                            className="clip-btn"
                            onClick={() => setDatabasePage((p) => Math.max(1, p - 1))}
                            disabled={databasePage === 1}
                          >
                            Prev
                          </button>
                          <span>Page {databasePage} / {totalDatabasePages}</span>
                          <button
                            type="button"
                            className="clip-btn"
                            onClick={() => setDatabasePage((p) => Math.min(totalDatabasePages, p + 1))}
                            disabled={databasePage === totalDatabasePages}
                          >
                            Next
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="database-empty">No submitted stamps yet.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </section>

          <section className="bottom-stamps">
            {stamps.length > 0 ? (
              <div className="stamps-rail">
                {stamps.map((stamp, index) => {
                  const isLandscape = stamp.ratio > 1.05
                  const isPortrait = stamp.ratio < 0.95
                  const widthFactor = isLandscape ? 1.3 : isPortrait ? 0.72 : 1
                  const scale = isLandscape ? 1.12 : 1
                  return (
                    <button
                      key={stamp.id}
                      className={stamp.id === newestStampId
                        ? `stamp-frame rail-item stamp-enter${stamp.preset === 'expand' ? ' stamp-frame-expand' : ''}`
                        : `stamp-frame rail-item${stamp.preset === 'expand' ? ' stamp-frame-expand' : ''}`}
                      type="button"
                      style={
                        {
                          '--stamp-ratio': String(stamp.ratio),
                          '--stamp-width-factor': String(widthFactor),
                          '--stamp-scale': String(scale),
                        } as CSSProperties
                      }
                      onClick={() => setSelectedStamp({ stamp, index })}
                      aria-label={`Open clipped stamp ${index + 1}`}
                      title="Click to preview"
                    >
                      <div className="stamp-perf" aria-hidden="true" />
                      <div className="stamp-right" aria-hidden="true" />
                      <div className="stamp-bottom" aria-hidden="true" />
                      <img src={stamp.src} alt={`Clipped stamp ${index + 1}`} />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="stamps-rail stamps-rail-empty" aria-hidden="true" />
            )}
          </section>

          <section className="database-section">
            <div className="pane-buttons">
              <button
                type="button"
                className="clip-btn database-toggle-btn"
                onClick={() => {
                  setIsDatabaseOpen((v) => !v)
                  setIsHistoryOpen(false)
                }}
              >
                {isDatabaseOpen ? 'Back to Editor' : 'Database'}
              </button>
              <button
                type="button"
                className="clip-btn database-toggle-btn"
                onClick={() => {
                  setIsDatabaseOpen(false)
                  setIsHistoryOpen((v) => !v)
                }}
              >
                {isHistoryOpen ? 'Close History' : 'History'}
              </button>
            </div>
          </section>
        </div>

      {selectedDatabaseStamp && (
        <div
          className="database-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedDatabaseStamp(null)}
        >
          <div
            className="database-lightbox-content"
            style={{ backgroundColor: selectedDatabaseStamp.wallColor ?? '#10141d' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="lightbox-close database-lightbox-close"
              onClick={() => setSelectedDatabaseStamp(null)}
            >
              Close
            </button>
            <div className="database-expanded-stamp">
              <img src={selectedDatabaseStamp.src} alt="Expanded database stamp" />
            </div>
          </div>
        </div>
      )}

      {selectedStamp && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => void closeModal()}>
          <div
            className="lightbox-content"
            style={{
              '--wall-bg': modalEdits.wallColor,
              '--stamp-paper': modalEdits.stampColor,
            } as CSSProperties}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="lightbox-close"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void closeModal()
              }}
            >
              Close
            </button>

            <div className="lightbox-editor">
              <div className="editor-settings">
              <div className="editor-actions">
                <button
                  type="button"
                  onClick={() => {
                    const next = createDefaultTextLayer()
                    setModalEdits((prev) => ({
                      ...prev,
                      textLayers: [...prev.textLayers, next],
                      activeTextId: next.id,
                    }))
                  }}
                >
                  Add text
                </button>
                <button type="button" onClick={resetModalEdits}>Reset</button>
                <div className="export-menu-wrap">
                  <button type="button" onClick={() => setShowExportMenu((v) => !v)}>
                    Export ▾
                  </button>
                  {showExportMenu && (
                    <div className="export-menu">
                      <button type="button" onClick={() => { setExportSizePct(100); setShowExportMenu(false); void exportModalImage(100) }}>Full (100%)</button>
                      <button type="button" onClick={() => { setExportSizePct(75); setShowExportMenu(false); void exportModalImage(75) }}>75%</button>
                      <button type="button" onClick={() => { setExportSizePct(50); setShowExportMenu(false); void exportModalImage(50) }}>50%</button>
                      <button type="button" onClick={() => { setExportSizePct(25); setShowExportMenu(false); void exportModalImage(25) }}>25%</button>
                    </div>
                  )}
                </div>
              </div>

              <label>
                Wall color
                <input
                  type="color"
                  value={modalEdits.wallColor}
                  onChange={(e) => setModalEdits((prev) => ({ ...prev, wallColor: e.target.value }))}
                />
              </label>
              <label>
                Stamp color
                <input
                  type="color"
                  value={modalEdits.stampColor}
                  onChange={(e) => setModalEdits((prev) => ({ ...prev, stampColor: e.target.value }))}
                />
              </label>
              <label>
                Texture style
                <select
                  value={modalEdits.texturePreset}
                  onChange={(e) =>
                    setModalEdits((prev) => ({
                      ...prev,
                      texturePreset: e.target.value as ModalStampEdits['texturePreset'],
                    }))
                  }
                >
                  <option value="paper">Paper fibers</option>
                  <option value="wavy">Wavy print</option>
                  <option value="grit">Grit speckle</option>
                  <option value="halftone-cmyk">Halftone CMYK</option>
                  <option value="halftone-c">Halftone Cyan</option>
                  <option value="halftone-m">Halftone Magenta</option>
                  <option value="halftone-y">Halftone Yellow</option>
                  <option value="halftone-k">Halftone Black</option>
                </select>
              </label>
              <label>
                Texture
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={modalEdits.texture}
                  onChange={(e) => setModalEdits((prev) => ({ ...prev, texture: Number(e.target.value) }))}
                />
              </label>
              <label>
                Zoom / crop
                <input
                  type="range"
                  min={0.1}
                  max={10}
                  step={0.01}
                  value={modalEdits.zoom}
                  onChange={(e) => setModalEdits((prev) => ({ ...prev, zoom: Number(e.target.value) }))}
                />
              </label>
              <label>
                Dither
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={modalEdits.dither}
                  onChange={(e) => setModalEdits((prev) => ({ ...prev, dither: Number(e.target.value) }))}
                />
              </label>
              <label>
                Perforation holes
                <input
                  type="range"
                  min={18}
                  max={56}
                  value={modalEdits.perforationSize}
                  onChange={(e) => setModalEdits((prev) => ({ ...prev, perforationSize: Number(e.target.value) }))}
                />
              </label>

              <div className="modal-divider" aria-hidden="true" />

              <div className="text-layers-list">
                {modalEdits.textLayers.map((layer) => (
                  <div key={layer.id} className="layer-row">
                    {editingLayerId === layer.id ? (
                      <input
                        autoFocus
                        className="layer-inline-input"
                        value={layer.text}
                        onChange={(e) => updateLayer(layer.id, (l) => ({ ...l, text: e.target.value }))}
                        onBlur={() => setEditingLayerId(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') setEditingLayerId(null)
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={modalEdits.activeTextId === layer.id ? 'layer-chip active' : 'layer-chip'}
                        onClick={() => setModalEdits((prev) => ({ ...prev, activeTextId: layer.id }))}
                        onDoubleClick={() => {
                          setModalEdits((prev) => ({ ...prev, activeTextId: layer.id }))
                          setEditingLayerId(layer.id)
                        }}
                      >
                        {layer.text.trim() || 'Text'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="layer-add"
                      onClick={() => {
                        const next = createDefaultTextLayer()
                        next.text = 'New text'
                        next.y = 50
                        next.size = 36
                        setModalEdits((prev) => ({
                          ...prev,
                          textLayers: [...prev.textLayers, next],
                          activeTextId: next.id,
                        }))
                      }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="layer-delete"
                      onClick={() => {
                        setModalEdits((prev) => {
                          const nextLayers = prev.textLayers.filter((l) => l.id !== layer.id)
                          const activeExists = nextLayers.some((l) => l.id === prev.activeTextId)
                          return {
                            ...prev,
                            textLayers: nextLayers,
                            activeTextId: activeExists ? prev.activeTextId : nextLayers[0]?.id ?? null,
                          }
                        })
                        if (editingLayerId === layer.id) setEditingLayerId(null)
                      }}
                    >
                      -
                    </button>
                  </div>
                ))}
              </div>

              {getActiveTextLayer() && (
                <>
                  <p className="text-gesture-help">Drag text to move. Drag corner handle to resize + rotate.</p>
                  <label>
                    Font
                    <select
                      className="modal-font-select"
                      value={getActiveTextLayer()?.font ?? 'Stardom'}
                      style={{
                        fontFamily: `"${getModalFontSpec(getActiveTextLayer()?.font ?? 'Stardom').family}", sans-serif`,
                        fontWeight: getModalFontSpec(getActiveTextLayer()?.font ?? 'Stardom').weight,
                        fontStyle: getModalFontSpec(getActiveTextLayer()?.font ?? 'Stardom').style,
                      }}
                      onChange={(e) => updateLayer(modalEdits.activeTextId as string, (layer) => ({ ...layer, font: e.target.value }))}
                    >
                      {MODAL_FONT_OPTIONS.map((font) => (
                        <option
                          key={font.label}
                          value={font.label}
                          style={{ fontFamily: `"${font.family}", sans-serif`, fontWeight: font.weight, fontStyle: font.style }}
                        >
                          {font.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Text color
                    <input
                      type="color"
                      value={getActiveTextLayer()?.color ?? '#ffffff'}
                      onChange={(e) => updateLayer(modalEdits.activeTextId as string, (layer) => ({ ...layer, color: e.target.value }))}
                    />
                  </label>
                  <label>
                    Text opacity
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={getActiveTextLayer()?.opacity ?? 100}
                      onChange={(e) => updateLayer(modalEdits.activeTextId as string, (layer) => ({ ...layer, opacity: Number(e.target.value) }))}
                    />
                  </label>
                </>
              )}

              <button
                type="button"
                className="clip-btn modal-submit-btn"
                onClick={() => void submitStampToDatabase()}
                disabled={isSubmittingToDatabase}
              >
                {isSubmittingToDatabase ? 'Submitting…' : 'Submit'}
              </button>
              {databaseNotice && <p className="database-notice">{databaseNotice}</p>}
              </div>

            </div>

            <div className="lightbox-preview-column" ref={modalPreviewRef}>
              <div
                ref={modalStampFrameRef}
                className={selectedStamp.stamp.preset === 'expand' ? 'stamp-frame lightbox-stamp stamp-frame-expand' : 'stamp-frame lightbox-stamp'}
                style={
                  {
                    '--stamp-ratio': String(selectedStamp.stamp.ratio),
                    '--stamp-width-factor': '1',
                    '--stamp-scale': '1',
                    '--perforation-size': `${modalEdits.perforationSize}px`,
                    '--stamp-image-padding': selectedStamp.stamp.preset === 'expand' ? '0px' : '14px',
                    '--stamp-padding-top-bottom': selectedStamp.stamp.preset === 'expand' ? '0px' : '16px',
                    '--stamp-padding-left-right': selectedStamp.stamp.preset === 'expand' ? '0px' : '16px',
                  } as CSSProperties
                }
              >
                <div className="stamp-perf" aria-hidden="true" />
                <div className="stamp-right" aria-hidden="true" />
                <div className="stamp-bottom" aria-hidden="true" />
                <img
                  ref={modalImageElementRef}
                  src={modalStampSrc || selectedStamp.stamp.src}
                  alt="Enlarged clipped stamp"
                  className="modal-edit-image"
                  draggable={false}
                  onPointerDown={onImagePointerDown}
                />
                <div className="image-crop-guides" aria-hidden="true">
                  <span className="guide corner tl" />
                  <span className="guide corner tr" />
                  <span className="guide corner bl" />
                  <span className="guide corner br" />
                  <span className="guide side top" />
                  <span className="guide side right" />
                  <span className="guide side bottom" />
                  <span className="guide side left" />
                </div>
                <div className="modal-icon-overlay" ref={modalIconOverlayRef}>
                  {modalEdits.iconLayers.map((icon) => (
                    <div
                      key={icon.id}
                      data-icon-id={icon.id}
                      className={modalEdits.activeIconId === icon.id ? 'modal-icon-layer active' : 'modal-icon-layer'}
                      style={{
                        left: `${icon.x}px`,
                        top: `${icon.y}px`,
                        width: `${icon.size}px`,
                        filter: icon.inverse ? 'invert(1)' : 'none',
                      }}
                      onPointerDown={(e) => onIconPointerDown(e, icon)}
                    >
                      <img src={icon.src} alt="stamp icon layer" style={{ opacity: icon.opacity / 100 }} />
                    </div>
                  ))}
                </div>
                {modalEdits.textLayers.map((layer) => {
                  const fontSpec = getModalFontSpec(layer.font)
                  return (
                  <div
                    key={layer.id}
                    className={modalEdits.activeTextId === layer.id ? 'modal-text-layer active' : 'modal-text-layer'}
                    style={{
                      left: `${layer.x}%`,
                      top: `${layer.y}%`,
                      color: layer.color,
                      fontSize: `${layer.size}px`,
                      fontFamily: `"${fontSpec.family}", sans-serif`,
                      fontWeight: fontSpec.weight,
                      fontStyle: fontSpec.style,
                      opacity: layer.opacity / 100,
                      transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
                    }}
                    onPointerDown={(e) => onTextPointerDown(e, layer)}
                  >
                    {layer.text}
                    {modalEdits.activeTextId === layer.id && (
                      <button className="text-handle" type="button" onPointerDown={(e) => onHandlePointerDown(e, layer)}>
                        ↻
                      </button>
                    )}
                  </div>
                )})}
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}

export default App
