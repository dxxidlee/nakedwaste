import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { jsPDF } from 'jspdf'
import { Canvas } from './components/Canvas'
import { isTrackedKey, useKeystroke } from './hooks/useKeystroke'

const QUESTIONS = [
  'Describe a moment you felt completely alone.',
  'What do you believe that you cannot fully explain?',
  'When did you last feel like a different version of yourself?',
  'What are you afraid people see when they look at you?',
  'Describe something you have never said out loud.',
] as const

type SnapshotReason = 'first-keypress' | 'submit' | 'pause'

type SessionSnapshot = {
  reason: SnapshotReason
  capturedAt: number
  dataUrl: string
}

type SessionResponse = {
  question: string
  text: string
  ikis: number[]
  snapshots: SessionSnapshot[]
}

type SessionState = {
  startedAt: number
  status: 'questionnaire' | 'review'
  currentQuestionIndex: number
  responses: SessionResponse[]
}

function createEmptySession(): SessionState {
  return {
    startedAt: Date.now(),
    status: 'questionnaire',
    currentQuestionIndex: 0,
    responses: QUESTIONS.map(question => ({
      question,
      text: '',
      ikis: [],
      snapshots: [],
    })),
  }
}

export default function App() {
  const questionCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const reviewCanvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({})
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const pauseTimeoutRef = useRef<number | null>(null)
  const [session, setSession] = useState<SessionState>(() => createEmptySession())
  const [cameraStatus, setCameraStatus] = useState<'loading' | 'ready' | 'denied'>('loading')
  const { text, ikis, bind, setText } = useKeystroke()
  const currentQuestion = QUESTIONS[session.currentQuestionIndex]
  const currentResponse = session.responses[session.currentQuestionIndex]

  const stats = useMemo(() => {
    if (ikis.length === 0) {
      return { count: 0, average: 0, max: 0 }
    }

    const total = ikis.reduce((sum, value) => sum + value, 0)

    return {
      count: ikis.length,
      average: Math.round(total / ikis.length),
      max: Math.round(Math.max(...ikis)),
    }
  }, [ikis])

  useEffect(() => {
    let cancelled = false

    async function enableCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        mediaStreamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setCameraStatus('ready')
      } catch {
        if (!cancelled) {
          setCameraStatus('denied')
        }
      }
    }

    enableCamera()

    return () => {
      cancelled = true
      if (pauseTimeoutRef.current !== null) {
        window.clearTimeout(pauseTimeoutRef.current)
      }
      mediaStreamRef.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  useEffect(() => {
    setSession(previous => {
      const responses = previous.responses.slice()
      responses[previous.currentQuestionIndex] = {
        ...responses[previous.currentQuestionIndex],
        text,
        ikis,
      }

      return {
        ...previous,
        responses,
      }
    })
  }, [ikis, text])

  useEffect(() => {
    setText(session.responses[session.currentQuestionIndex]?.text ?? '')
  }, [session.currentQuestionIndex, setText])

  const captureSnapshot = useCallback((reason: SnapshotReason) => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || cameraStatus !== 'ready') {
      return
    }

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.drawImage(video, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)

    setSession(previous => {
      const responses = previous.responses.slice()
      const response = responses[previous.currentQuestionIndex]
      responses[previous.currentQuestionIndex] = {
        ...response,
        snapshots: response.snapshots.concat({
          reason,
          capturedAt: Date.now(),
          dataUrl,
        }),
      }

      return {
        ...previous,
        responses,
      }
    })
  }, [cameraStatus])

  const schedulePauseSnapshot = useCallback(() => {
    if (pauseTimeoutRef.current !== null) {
      window.clearTimeout(pauseTimeoutRef.current)
    }

    pauseTimeoutRef.current = window.setTimeout(() => {
      captureSnapshot('pause')
    }, 3000)
  }, [captureSnapshot])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      bind.onKeyDown?.(event)

      if (!isTrackedKey(event)) {
        return
      }

      const hasFirstKeypressSnapshot = currentResponse.snapshots.some(
        snapshot => snapshot.reason === 'first-keypress',
      )

      if (!hasFirstKeypressSnapshot) {
        captureSnapshot('first-keypress')
      }

      schedulePauseSnapshot()
    },
    [bind, captureSnapshot, currentResponse.snapshots, schedulePauseSnapshot],
  )

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      bind.onChange?.(event)
    },
    [bind],
  )

  const goToNextQuestion = useCallback(() => {
    setSession(previous => {
      const isLastQuestion = previous.currentQuestionIndex === previous.responses.length - 1
      return {
        ...previous,
        status: isLastQuestion ? 'review' : previous.status,
        currentQuestionIndex: isLastQuestion
          ? previous.currentQuestionIndex
          : previous.currentQuestionIndex + 1,
      }
    })
  }, [])

  const handleSubmit = useCallback(() => {
    if (pauseTimeoutRef.current !== null) {
      window.clearTimeout(pauseTimeoutRef.current)
      pauseTimeoutRef.current = null
    }

    captureSnapshot('submit')
    goToNextQuestion()
  }, [captureSnapshot, goToNextQuestion])

  function exportPdf() {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'letter',
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 72
    let y = margin

    pdf.setFont('courier', 'normal')

    session.responses.forEach((response, index) => {
      const canvas =
        session.status === 'review'
          ? reviewCanvasRefs.current[index]
          : index === session.currentQuestionIndex
            ? questionCanvasRef.current
            : null

      if (y > margin) {
        pdf.addPage()
        y = margin
      }

      pdf.setFontSize(14)
      const questionLines = pdf.splitTextToSize(response.question, pageWidth - margin * 2)
      pdf.text(questionLines, margin, y)
      y += questionLines.length * 18

      if (canvas) {
        const imageWidth = pageWidth - margin * 2
        const imageHeight = (canvas.height / canvas.width) * imageWidth
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, y + 8, imageWidth, imageHeight)
        y += imageHeight + 20
      }

      response.snapshots.slice(0, 2).forEach(snapshot => {
        const snapshotWidth = 160
        const snapshotHeight = 120

        if (y + snapshotHeight > pageHeight - margin) {
          pdf.addPage()
          y = margin
        }

        pdf.addImage(snapshot.dataUrl, 'JPEG', margin, y, snapshotWidth, snapshotHeight)
        y += snapshotHeight + 12
      })

      y += 12
    })

    pdf.save('pause-portrait.pdf')
  }

  if (session.status === 'review') {
    return (
      <main className="app-shell">
        <section className="controls">
          <p className="eyebrow">Pause/Portrait</p>
          <h1>Review session</h1>
          <p className="prompt">All responses, IKIs, and webcam captures are stored in one in-memory session object.</p>
          <div className="stats">
            <span>{session.responses.length} responses</span>
            <span>{session.responses.reduce((sum, response) => sum + response.snapshots.length, 0)} snapshots</span>
            <span>camera {cameraStatus}</span>
          </div>
          <button type="button" onClick={exportPdf}>
            Export canvas to PDF
          </button>
        </section>

        <section className="preview">
          {session.responses.map((response, index) => (
            <div key={response.question}>
              <p className="prompt">{response.question}</p>
              <Canvas
                ref={node => {
                  reviewCanvasRefs.current[index] = node
                }}
                text={response.text}
                ikis={response.ikis}
              />
              <div className="stats">
                <span>{response.text.length} chars</span>
                <span>{response.snapshots.length} snapshots</span>
              </div>
            </div>
          ))}
        </section>
        <video ref={videoRef} autoPlay muted playsInline hidden />
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="controls">
        <p className="eyebrow">Pause/Portrait</p>
        <h1>{currentQuestion}</h1>
        <textarea
          value={bind.value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className="response-input"
          placeholder="Type a response and watch the spacing breathe."
          rows={8}
        />

        <div className="stats">
          <span>{stats.count} chars</span>
          <span>{stats.average}ms avg IKI</span>
          <span>{stats.max}ms max IKI</span>
          <span>{currentResponse.snapshots.length} snapshots</span>
          <span>camera {cameraStatus}</span>
        </div>

        <button type="button" onClick={handleSubmit}>
          Submit response
        </button>
      </section>

      <section className="preview">
        <Canvas ref={questionCanvasRef} text={text} ikis={ikis} />
      </section>
      <video ref={videoRef} autoPlay muted playsInline hidden />
    </main>
  )
}
