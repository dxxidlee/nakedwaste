import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'

const QUESTIONS = [
  'Describe a moment you felt completely alone.',
  'What do you believe that you cannot fully explain?',
  'When did you last feel like a different version of yourself?',
  'What are you afraid people see when they look at you?',
  'Describe something you have never said out loud.',
] as const

const IKI_BASELINE = 150
const BASE_SPACING = 14
const MAX_SPACING = 120
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function toGraphemes(value: string) {
  return Array.from(graphemeSegmenter.segment(value), part => part.segment)
}

function clampSpacing(iki: number | undefined) {
  if (!iki) return 0
  return Math.min(Math.max((iki / IKI_BASELINE) * BASE_SPACING, 0), MAX_SPACING)
}

function diffGraphemes(previous: string[], next: string[]) {
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) {
    start += 1
  }

  let previousEnd = previous.length - 1
  let nextEnd = next.length - 1
  while (
    previousEnd >= start &&
    nextEnd >= start &&
    previous[previousEnd] === next[nextEnd]
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }

  return {
    start,
    removedCount: Math.max(0, previousEnd - start + 1),
    insertedCount: Math.max(0, nextEnd - start + 1),
  }
}

type WordToken = {
  chars: Array<{ value: string; sourceIndex: number }>
}

function tokenizeWords(graphemes: string[]) {
  const words: WordToken[] = []
  let current: Array<{ value: string; sourceIndex: number }> = []

  graphemes.forEach((grapheme, index) => {
    if (grapheme === ' ') {
      if (current.length > 0) {
        words.push({ chars: current })
        current = []
      }
      return
    }

    current.push({ value: grapheme, sourceIndex: index })
  })

  if (current.length > 0) {
    words.push({ chars: current })
  }

  return words
}

export default function App() {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [text, setText] = useState('')
  const [ikis, setIkis] = useState<number[]>([])
  const [fontStatus, setFontStatus] = useState<'checking' | 'loaded' | 'not-loaded'>('checking')
  const [cameraStatus, setCameraStatus] = useState<'loading' | 'ready' | 'blocked'>('loading')
  const lastTimestampRef = useRef<number | null>(null)
  const pendingTimestampRef = useRef<{ previous: number | null; current: number } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const bgVideoRef = useRef<HTMLVideoElement | null>(null)
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const speedRef = useRef<number>(0.5)
  const displaySpeedRef = useRef<number>(0.5)

  useEffect(() => {
    inputRef.current?.focus()
  }, [questionIndex])

  useEffect(() => {
    let cancelled = false

    async function startWebcam() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        streamRef.current = stream
        if (bgVideoRef.current) {
          bgVideoRef.current.srcObject = stream
          await bgVideoRef.current.play()
        }
        setCameraStatus('ready')
      } catch {
        setCameraStatus('blocked')
      }
    }

    startWebcam()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    const recent = ikis.slice(-8)
    if (recent.length === 0) return
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length
    // IKI_BASELINE (150ms) → t=1 (green/fast); 2× baseline → t=0.5; 4× → ~0.25 (red/slow)
    const t = Math.max(0, Math.min(1, IKI_BASELINE / avg))
    speedRef.current = t
  }, [ikis])

  useEffect(() => {
    let rafId = 0

    function renderInfrared() {
      const video = bgVideoRef.current
      const canvas = bgCanvasRef.current
      if (!video || !canvas) {
        rafId = window.requestAnimationFrame(renderInfrared)
        return
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        rafId = window.requestAnimationFrame(renderInfrared)
        return
      }

      const width = window.innerWidth
      const height = window.innerHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        ctx.fillStyle = '#b7d3ff'
        ctx.fillRect(0, 0, width, height)
        rafId = window.requestAnimationFrame(renderInfrared)
        return
      }

      const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
      const drawWidth = video.videoWidth * scale
      const drawHeight = video.videoHeight * scale
      const offsetX = (width - drawWidth) / 2
      const offsetY = (height - drawHeight) / 2

      ctx.filter = 'grayscale(1) invert(1) contrast(2.2) blur(14px)'
      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight)
      ctx.filter = 'none'

      // Smooth lerp toward target speed each frame
      displaySpeedRef.current += (speedRef.current - displaySpeedRef.current) * 0.04
      const t = displaySpeedRef.current

      const frame = ctx.getImageData(0, 0, width, height)
      const { data } = frame

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0
        const g = data[i + 1] ?? 0
        const b = data[i + 2] ?? 0
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

        const value = Math.min(255, Math.max(0, luma))

        // Tint: slow → red (t=0), fast → green (t=1)
        data[i]     = Math.round(value * (1 - t))
        data[i + 1] = Math.round(value * t)
        data[i + 2] = 0
        data[i + 3] = 255
      }

      ctx.putImageData(frame, 0, 0)
      rafId = window.requestAnimationFrame(renderInfrared)
    }

    rafId = window.requestAnimationFrame(renderInfrared)
    return () => window.cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function checkFont() {
      if (!('fonts' in document)) {
        if (!cancelled) setFontStatus('not-loaded')
        return
      }

      try {
        await document.fonts.load('500 18px "PPNeueMontreal"')
        const loaded = document.fonts.check('500 18px "PPNeueMontreal"')
        if (!cancelled) {
          setFontStatus(loaded ? 'loaded' : 'not-loaded')
        }
      } catch {
        if (!cancelled) setFontStatus('not-loaded')
      }
    }

    checkFont()
    return () => {
      cancelled = true
    }
  }, [])

  const graphemes = useMemo(() => toGraphemes(text), [text])
  const words = useMemo(() => tokenizeWords(graphemes), [graphemes])

  const stats = useMemo(() => {
    if (graphemes.length === 0) return { chars: 0, avg: 0, max: 0 }
    const total = ikis.reduce((sum, value) => sum + value, 0)
    return {
      chars: graphemes.length,
      avg: Math.round(total / graphemes.length),
      max: Math.round(Math.max(0, ...ikis)),
    }
  }, [graphemes.length, ikis])

  function resetInput() {
    setText('')
    setIkis([])
    lastTimestampRef.current = null
    pendingTimestampRef.current = null
  }

  function advanceQuestion() {
    if (questionIndex < QUESTIONS.length - 1) {
      setQuestionIndex(index => index + 1)
      resetInput()
    } else {
      resetInput()
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      advanceQuestion()
      return
    }

    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      (event.nativeEvent as globalThis.KeyboardEvent).isComposing
    ) {
      return
    }

    const isTextKey = event.key.length === 1
    const isEditKey = event.key === 'Backspace' || event.key === 'Delete'
    if (!isTextKey && !isEditKey) {
      return
    }

    const now = performance.now()
    pendingTimestampRef.current = { previous: lastTimestampRef.current, current: now }
    lastTimestampRef.current = now
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value
    const previousGraphemes = toGraphemes(text)
    const nextGraphemes = toGraphemes(nextValue)
    const { start, removedCount, insertedCount } = diffGraphemes(previousGraphemes, nextGraphemes)
    const pending = pendingTimestampRef.current

    setText(nextValue)
    setIkis(previous => {
      const next = previous.slice()
      const inserted = Array.from({ length: insertedCount }, (_, index) => {
        if (index > 0) return 0
        if (!pending || pending.previous === null) return 0
        return Math.max(0, pending.current - pending.previous)
      })
      next.splice(start, removedCount, ...inserted)
      return next
    })
    pendingTimestampRef.current = null
  }

  return (
    <main
      className="app"
      onClick={() => inputRef.current?.focus()}
      style={{ fontFamily: '"PPNeueMontreal", Arial, sans-serif' }}
    >
      <video
        ref={bgVideoRef}
        className="webcam-source"
        autoPlay
        muted
        playsInline
        aria-hidden="true"
      />
      <canvas ref={bgCanvasRef} className="webcam-bg" aria-hidden="true" />
      <div className="webcam-overlay" aria-hidden="true" />
      <section className="frame">
        <p className="question">{QUESTIONS[questionIndex]}</p>

        <textarea
          ref={inputRef}
          value={text}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          className="hidden-input"
          aria-label="response input"
        />

        <section className="typing-surface">
          {words.map((word, wordIndex) => (
            <div
              key={`${wordIndex}-${word.chars.map(char => char.value).join('')}`}
              className="word-box"
              style={{ marginRight: wordIndex < words.length - 1 ? '4px' : '0px' }}
            >
              {word.chars.map((char, charIndex) => (
                <span key={`${wordIndex}-${charIndex}`} className="char-wrap">
                  <span className="char">{char.value}</span>
                  {charIndex < word.chars.length - 1 && (
                    <span
                      className="gap-slot"
                      style={{
                        width: `${Math.max(
                          4,
                          clampSpacing(ikis[char.sourceIndex + 1]),
                        )}px`,
                      }}
                    />
                  )}
                </span>
              ))}
            </div>
          ))}
        </section>

        <footer className="stats">
          <span>
            {stats.chars} chars · {stats.avg}ms avg IKI · {stats.max}ms max IKI · font:{' '}
            {fontStatus} · cam:{cameraStatus}
          </span>
          <button type="button" onClick={advanceQuestion} className="submit">
            Submit
          </button>
        </footer>
      </section>
    </main>
  )
}
