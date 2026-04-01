import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, TextareaHTMLAttributes } from 'react'

const EDITING_KEYS = new Set(['Backspace', 'Delete', 'Enter', 'Tab'])

function isTrackedKey(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (event.nativeEvent as globalThis.KeyboardEvent).isComposing
  ) {
    return false
  }

  return event.key.length === 1 || EDITING_KEYS.has(event.key)
}

function diffChars(previous: string[], next: string[]) {
  let start = 0

  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
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
    insertedChars: next.slice(start, nextEnd + 1),
  }
}

export type UseKeystrokeResult = {
  text: string
  setText: (value: string) => void
  ikis: number[]
  bind: Pick<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onChange' | 'onKeyDown'
  >
}

export function useKeystroke(initialValue = ''): UseKeystrokeResult {
  const initialChars = useMemo(() => Array.from(initialValue), [initialValue])
  const [text, setTextState] = useState(initialValue)
  const [ikis, setIkis] = useState<number[]>(() => initialChars.map(() => 0))
  const lastTimestampRef = useRef<number | null>(null)
  const pendingRef = useRef<{ previousTimestamp: number | null; timestamp: number } | null>(null)

  const setText = useCallback((value: string) => {
    const chars = Array.from(value)
    setTextState(value)
    setIkis(chars.map(() => 0))
    lastTimestampRef.current = null
    pendingRef.current = null
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isTrackedKey(event)) {
      return
    }

    const timestamp = performance.now()
    pendingRef.current = {
      previousTimestamp: lastTimestampRef.current,
      timestamp,
    }
    lastTimestampRef.current = timestamp
  }, [])

  const onChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value

    setTextState(previousValue => {
      const previousChars = Array.from(previousValue)
      const nextChars = Array.from(nextValue)
      const { start, removedCount, insertedChars } = diffChars(previousChars, nextChars)
      const pending = pendingRef.current

      setIkis(previousIkis => {
        const nextIkis = previousIkis.slice()
        const insertedIkis = insertedChars.map((_, index) => {
          if (index > 0) return 0
          if (pending === null || pending.previousTimestamp === null) return 0
          return Math.max(0, pending.timestamp - pending.previousTimestamp)
        })

        nextIkis.splice(start, removedCount, ...insertedIkis)
        return nextIkis
      })

      pendingRef.current = null
      return nextValue
    })
  }, [])

  return {
    text,
    setText,
    ikis,
    bind: {
      value: text,
      onChange,
      onKeyDown,
    },
  }
}
