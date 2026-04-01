# PRD: Pause/Portrait
*A typesetting tool that captures the human texture of typed language*

David Lee | PSAM 3060 Currents: Typesetting | Parsons School of Design | Spring 2026

---

## 1. Overview

Written language has a robotic problem. When humans type, all the paralinguistic data that makes speech feel human -- the hesitations, the long exhales before a hard answer, the quick bursts of certainty -- gets stripped out. What remains is clean, evenly spaced text that carries none of the emotional texture of how it was produced.

Pause/Portrait is a browser-based typesetting tool that restores that texture. It presents a short questionnaire (5-8 deep, personal questions), captures how the user types each response -- specifically the timing between keystrokes -- and renders those pauses as proportional per-character spacing in the typeset output using `@chenglou/pretext` for pixel-accurate glyph layout. A webcam integration captures facial snapshots during each response. The final output is a downloadable PDF: a typographic self-portrait where the spacing and images together encode the emotional and cognitive experience of answering.

---

## 2. Problem Statement

Conventional typesetting tools treat all typed input as equal. A word typed with three seconds of hesitation before each character looks identical to a word typed in a confident 0.3-second burst. The gap between speech and text is not just phonetic -- it is temporal and emotional. Typed language, as currently rendered, has no way to represent that gap.

This matters most in personal narrative. When someone speaks about a difficult memory or an uncertain belief, you can hear it. When they type the same thing, it reads flat. The tool addresses this specific failure.

---

## 3. Goals

### Primary
- Capture keystroke timing per character during questionnaire responses
- Map inter-keystroke pause duration linearly to per-character spacing using pretext for pixel-accurate glyph layout
- Capture one or more webcam snapshots per question response
- Render output as a downloadable, print-ready 8.5x11" PDF

### Secondary
- Produce a live Canvas preview of the typeset text as the user types
- Design the questionnaire to provoke genuine hesitation and emotional engagement
- Create a visually cohesive document that functions as both a typographic experiment and a personal artifact

---

## 4. Non-Goals
- Audio/voice input (out of scope for v1)
- Multi-user or collaborative sessions
- Variable font weight based on confidence (deferred -- no reliable signal without audio)
- Mobile support (desktop browser only)
- Cloud storage or account system

---

## 5. Users

Single user, self-directed. The person using this tool is both the subject and the audience. They sit alone, answer the questionnaire, and receive a printed artifact of their own interiority. The tool is not a diagnostic -- it is a portrait.

Context: academic prototype presented as part of PSAM 3060 at Parsons. Audience includes the user themselves, classmates, and the instructor.

---

## 6. Core Mechanics

### 6.1 Keystroke Timing

On each keypress, record a high-precision timestamp via `performance.now()`. The inter-keystroke interval (IKI) is the gap in milliseconds between consecutive keypresses, stored per character index in the response string.

IKI maps linearly to additional horizontal offset per character:

```
x_offset[i] = (IKI[i] / IKI_baseline) * base_spacing
```

- `IKI_baseline`: 150ms (comfortable typing pace)
- Pauses shorter than baseline → normal/tight spacing
- Pauses longer than baseline → expanded spacing, proportional to duration
- Hard cap: 5x baseline (750ms) to prevent runaway expansion

The result is text that visually breathes and hesitates in the exact rhythm the user did -- at character-level precision, not word-level.

### 6.2 Rendering with pretext

Use `@chenglou/pretext` (`npm install @chenglou/pretext`) for all text layout and measurement. Do NOT use CSS `letter-spacing` -- it applies uniformly across words and breaks line reflow when spacing expands.

pretext provides:
- Pixel-accurate glyph width measurement without DOM reflow
- Per-line layout data via `layoutWithLines()`
- Cursor-based iterator `layoutNextLine()` for variable-width line routing

This enables:
- **Per-character absolute x-positioning**: each character placed at a manually computed x-coordinate = glyph width (pretext) + IKI-derived offset
- **Correct line reflow**: expanded spacing is accounted for in line-break calculations
- **Canvas rendering**: live preview renders to `<canvas>` using pretext layout + `ctx.fillText()` per character, no DOM involvement
- **High-fidelity PDF export**: canvas captured via `toDataURL()` and inserted into jsPDF -- no html2canvas

Core rendering loop:

```js
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const prepared = prepareWithSegments(responseText, font, { whiteSpace: 'pre-wrap' })
const { lines } = layoutWithLines(prepared, columnWidth, lineHeight)

let charIndex = 0
for (const line of lines) {
  let x = marginLeft
  for (const grapheme of [...line.text]) {
    const ikiOffset = (IKI[charIndex] / IKI_BASELINE) * BASE_SPACING
    ctx.fillText(grapheme, x, y)
    x += glyphWidth(grapheme) + ikiOffset  // glyphWidth from pretext measurement
    charIndex++
  }
  y += lineHeight
}
```

### 6.3 Webcam Capture

Request `MediaDevices.getUserMedia()` on load with explicit user consent prompt. Snapshots captured automatically per response:

- **On first keypress** after question appears
- **On response submission**
- **On 3-second pause** (no keypress for 3000ms) -- flags a moment of significant hesitation

Photos stored as JPEG in memory only (never uploaded). Embedded into PDF alongside the typeset response for that question.

### 6.4 Questionnaire

5-8 questions designed to surface genuine hesitation. Open-ended, personal, slightly uncomfortable. Presented one at a time, full-screen, minimal UI. No progress indicator, word count, or timer.

Proposed questions (final set TBD):
1. Describe a moment you felt completely alone.
2. What do you believe that you cannot fully explain?
3. When did you last feel like a different version of yourself?
4. What are you afraid people see when they look at you?
5. Describe something you have never said out loud.

### 6.5 Live Preview

A `<canvas>` element renders typeset output in real time as the user types, using the pretext rendering loop from 6.2. The user watches their pauses accumulate as spacing in the text live.

---

## 7. Output: PDF Spec

| Property | Value |
|----------|-------|
| Page size | 8.5 x 11 inches (US Letter), portrait |
| Margins | 1 inch all sides |
| Layout | Single column, continuous flow |
| Typography | TBD -- monospace or grotesque, black on white, no color |
| Question display | Lighter weight / smaller size above each response block |
| Response display | Full size, per-character IKI spacing applied, rendered from Canvas |
| Image placement | Webcam snapshots inline with corresponding response (layout TBD) |
| Export path | `canvas.toDataURL()` → jsPDF. No html2canvas. |

---

## 8. Tech Stack

| Package | Purpose |
|---------|---------|
| React + Vite | Component architecture, questionnaire state |
| `@chenglou/pretext` | Text measurement, per-line layout, grapheme cursors |
| Canvas API | Live preview rendering + PDF source capture |
| `MediaDevices.getUserMedia()` | Webcam access, JPEG snapshot capture |
| `jspdf` | PDF assembly from Canvas frames + embedded photos |
| Vercel | Deployment |

No backend. Everything runs client-side.

---

## 9. Screens & States

1. **Welcome** -- title, brief framing, camera permission prompt, start button
2. **Question** -- full-screen question, text input, live Canvas preview, submit on Enter or button
3. **Transition** -- brief black screen (~1.5s) between responses
4. **Review** -- all responses typeset together, generate PDF button
5. **Download** -- PDF assembly + file download triggered

---

## 10. Open Questions

- Typeface: monospace (clinical) vs grotesque (warmer)? Needs visual testing.
- Photo layout in PDF: strip above response, inset, or full-width?
- Should user see photos before PDF generation, or is the reveal part of the artifact?
- Is the live preview helpful or a distraction? Toggleable?
- Spacing cap: 5x baseline may still be too extreme -- needs calibration with real typing data.
- Should the 3s-pause snapshot trigger be disclosed to the user or silent?

---

## 11. Build Order (Tonight)

1. Vite + React scaffold, install `@chenglou/pretext` and `jspdf`
2. Keystroke capture hook -- `performance.now()` timestamps, IKI array per response
3. pretext rendering loop on Canvas -- get one sentence rendering with spacing working
4. Questionnaire state machine -- one question at a time, responses stored in array
5. Webcam capture -- getUserMedia, snapshot on keypress / submit / 3s pause
6. PDF assembly -- Canvas frames + photos into jsPDF
7. Full flow end-to-end

Do not touch visual design tonight. Get it working ugly first.

---

*Pause/Portrait | PRD v1.1 | March 2026*