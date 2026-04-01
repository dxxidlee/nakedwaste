import { forwardRef, useEffect, useMemo, useRef } from 'react'
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext'

const IKI_BASELINE = 150
const IKI_CAP = IKI_BASELINE * 5
const BASE_SPACING = 6

type CanvasProps = {
  text: string
  ikis: number[]
  width?: number
  font?: string
  lineHeight?: number
  padding?: number
}

type OffsetAwareLine = {
  graphemes: string[]
  startIndex: number
}

function clampIki(iki: number | undefined) {
  if (!iki) return 0
  return Math.min(Math.max(iki, 0), IKI_CAP)
}

function getGlyphWidth(grapheme: string, font: string, cache: Map<string, number>) {
  const cached = cache.get(grapheme)
  if (cached !== undefined) {
    return cached
  }

  const prepared = prepareWithSegments(grapheme, font, { whiteSpace: 'pre-wrap' }) as {
    widths?: number[]
  }
  const width = prepared.widths?.[0] ?? 0
  cache.set(grapheme, width)
  return width
}

function getIkiOffset(iki: number | undefined) {
  return (clampIki(iki) / IKI_BASELINE) * BASE_SPACING
}

function buildOffsetAwareLines(
  text: string,
  ikis: number[],
  font: string,
  maxWidth: number,
  glyphWidthCache: Map<string, number>,
) {
  const prepared = prepareWithSegments(text, font, { whiteSpace: 'pre-wrap' })
  const { lines } = layoutWithLines(prepared, maxWidth, 1)
  const offsetAwareLines: OffsetAwareLine[] = []
  let globalIndex = 0

  for (const line of lines) {
    const graphemes = Array.from(line.text)
    let currentLine: string[] = []
    let currentWidth = 0
    let currentStartIndex = globalIndex
    let lastBreakableIndex = -1

    const flushLine = (endExclusive: number) => {
      const nextLine = currentLine.slice(0, endExclusive)
      if (nextLine.length > 0) {
        offsetAwareLines.push({
          graphemes: nextLine,
          startIndex: currentStartIndex,
        })
      }

      const remainder = currentLine.slice(endExclusive)
      currentStartIndex += endExclusive
      currentLine = remainder
      currentWidth = remainder.reduce((sum, grapheme, index) => {
        const charIndex = currentStartIndex + index
        return (
          sum +
          getGlyphWidth(grapheme, font, glyphWidthCache) +
          getIkiOffset(ikis[charIndex])
        )
      }, 0)
      lastBreakableIndex = remainder.findLastIndex(grapheme => /\s/.test(grapheme))
    }

    graphemes.forEach(grapheme => {
      const charIndex = globalIndex
      const advance =
        getGlyphWidth(grapheme, font, glyphWidthCache) + getIkiOffset(ikis[charIndex])

      if (currentLine.length > 0 && currentWidth + advance > maxWidth) {
        const breakIndex = lastBreakableIndex >= 0 ? lastBreakableIndex + 1 : currentLine.length
        flushLine(breakIndex)
      }

      currentLine.push(grapheme)
      currentWidth += advance

      if (/\s/.test(grapheme)) {
        lastBreakableIndex = currentLine.length - 1
      }

      globalIndex += 1
    })

    if (currentLine.length > 0) {
      offsetAwareLines.push({
        graphemes: currentLine,
        startIndex: currentStartIndex,
      })
    } else if (graphemes.length === 0) {
      offsetAwareLines.push({
        graphemes: [],
        startIndex: globalIndex,
      })
    }
  }

  return offsetAwareLines
}

export const Canvas = forwardRef<HTMLCanvasElement, CanvasProps>(function Canvas(
  {
    text,
    ikis,
    width = 720,
    font = '24px "Courier New", monospace',
    lineHeight = 34,
    padding = 32,
  },
  forwardedRef,
) {
  const internalRef = useRef<HTMLCanvasElement | null>(null)
  const glyphWidthCache = useMemo(() => new Map<string, number>(), [])

  useEffect(() => {
    const canvas = internalRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const availableWidth = width - padding * 2
    const lines = buildOffsetAwareLines(text, ikis, font, availableWidth, glyphWidthCache)
    const canvasHeight = Math.max(lineHeight + padding * 2, lines.length * lineHeight + padding * 2)

    canvas.width = width
    canvas.height = canvasHeight

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#111111'
    ctx.font = font
    ctx.textBaseline = 'top'

    lines.forEach((line, lineIndex) => {
      let x = padding
      const y = padding + lineIndex * lineHeight

      for (const [index, grapheme] of line.graphemes.entries()) {
        const charIndex = line.startIndex + index
        ctx.fillText(grapheme, x, y)
        const glyphWidth = getGlyphWidth(grapheme, font, glyphWidthCache)
        const ikiOffset = getIkiOffset(ikis[charIndex])
        x += glyphWidth + ikiOffset
      }
    })
  }, [font, glyphWidthCache, ikis, lineHeight, padding, text, width])

  return (
    <canvas
      ref={node => {
        internalRef.current = node

        if (typeof forwardedRef === 'function') {
          forwardedRef(node)
        } else if (forwardedRef) {
          forwardedRef.current = node
        }
      }}
    />
  )
})
