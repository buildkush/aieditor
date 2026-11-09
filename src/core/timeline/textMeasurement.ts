/**
 * textMeasurement.ts
 *
 * Accurate DOM and canvas-based measurement of text and caption bounding boxes.
 * Ensures the on-canvas selection bounding box (CanvasTransformOverlay) and
 * rendered text/caption elements (VideoLayerItem) are 100% congruent.
 */

let measurementCanvas: HTMLCanvasElement | null = null
let measurementCtx: CanvasRenderingContext2D | null = null

export interface TextMeasurementOptions {
  text: string
  fontSize: number
  fontFamily?: string
  fontWeight?: string | number
  fontStyle?: string
  lineHeight?: number
  letterSpacing?: number
  padding?: number
  paddingX?: number
  paddingY?: number
  strokeWidth?: number
  maxWidth?: number
  textCase?: string
}

export interface TextDimensions {
  width: number
  height: number
  lines: string[]
}

// In-memory LRU-like cache for measurement results
const measurementCache = new Map<string, TextDimensions>()
const MAX_CACHE_SIZE = 500

function getCacheKey(opt: TextMeasurementOptions): string {
  return `${opt.text}|${opt.fontSize}|${opt.fontFamily || ''}|${opt.fontWeight || ''}|${opt.fontStyle || ''}|${opt.lineHeight || ''}|${opt.letterSpacing || 0}|${opt.padding || 0}|${opt.paddingX || 0}|${opt.paddingY || 0}|${opt.strokeWidth || 0}|${opt.maxWidth || 0}|${opt.textCase || ''}`
}

/**
 * Accurately measures text dimensions (width and height) in project coordinate space.
 */
export function measureTextDimensions(options: TextMeasurementOptions): TextDimensions {
  const cacheKey = getCacheKey(options)
  const cached = measurementCache.get(cacheKey)
  if (cached) return cached

  const {
    text = '',
    fontSize = 64,
    fontFamily = 'Inter, sans-serif',
    fontWeight = '700',
    fontStyle = 'normal',
    lineHeight = 1.2,
    letterSpacing = 0,
    padding = 12,
    paddingX,
    paddingY,
    strokeWidth = 0,
    maxWidth = 1800,
    textCase = 'none',
  } = options

  const padX = paddingX !== undefined ? paddingX : padding
  const padY = paddingY !== undefined ? paddingY : padding

  let cleanText = text || ' '
  if (textCase === 'uppercase') {
    cleanText = cleanText.toUpperCase()
  } else if (textCase === 'lowercase') {
    cleanText = cleanText.toLowerCase()
  } else if (textCase === 'capitalize') {
    cleanText = cleanText.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  const rawLines = cleanText.split('\n')

  let ctx = measurementCtx
  if (!ctx && typeof document !== 'undefined') {
    measurementCanvas = document.createElement('canvas')
    measurementCtx = measurementCanvas.getContext('2d')
    ctx = measurementCtx
  }

  if (ctx) {
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
  }

  // Word-wrap lines if they exceed maxWidth
  const wrappedLines: string[] = []
  for (const rawLine of rawLines) {
    if (!rawLine) {
      wrappedLines.push('')
      continue
    }

    if (!ctx) {
      wrappedLines.push(rawLine)
      continue
    }

    const words = rawLine.split(' ')
    let currentLine = words[0] || ''

    for (let i = 1; i < words.length; i++) {
      const testLine = `${currentLine} ${words[i]}`
      const testWidth = ctx.measureText(testLine).width + Math.max(0, testLine.length - 1) * letterSpacing
      if (maxWidth > 0 && testWidth > maxWidth - padX * 2) {
        wrappedLines.push(currentLine)
        currentLine = words[i]
      } else {
        currentLine = testLine
      }
    }
    wrappedLines.push(currentLine)
  }

  let maxLineWidth = 0
  for (const line of wrappedLines) {
    let lineWidth = 0
    if (ctx && line.length > 0) {
      lineWidth = ctx.measureText(line).width + Math.max(0, line.length - 1) * letterSpacing
    } else {
      // Fallback approximation when canvas context is unavailable (e.g. Node tests)
      lineWidth = line.length * fontSize * 0.58 + Math.max(0, line.length - 1) * letterSpacing
    }
    if (lineWidth > maxLineWidth) {
      maxLineWidth = lineWidth
    }
  }

  const effectiveLineHeight = fontSize * lineHeight
  const totalTextHeight = wrappedLines.length * effectiveLineHeight
  const extraPaddingX = (padX || 0) * 2 + (strokeWidth || 0) * 2
  const extraPaddingY = (padY || 0) * 2 + (strokeWidth || 0) * 2

  // Return dimensions with safety padding for font glyph ascenders/descenders
  const width = Math.ceil(Math.max(60, maxLineWidth + extraPaddingX + 16))
  const height = Math.ceil(Math.max(fontSize * lineHeight + extraPaddingY, totalTextHeight + extraPaddingY + 8))

  const result: TextDimensions = {
    width,
    height,
    lines: wrappedLines,
  }

  if (measurementCache.size >= MAX_CACHE_SIZE) {
    const firstKey = measurementCache.keys().next().value
    if (firstKey) measurementCache.delete(firstKey)
  }
  measurementCache.set(cacheKey, result)

  return result
}
