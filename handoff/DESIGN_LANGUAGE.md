# Design Language: "Doodle Desk"

Research basis: Nielsen Norman Group on microinteractions (trigger -> small, purposeful feedback; show system status, support undo, express brand, keep animations short and non-intrusive) and Material 3 layout guidance (clear hierarchy, landmarks and a single H1, 44 px minimum pointer targets, 8 px spacing, visible focus, sufficient contrast). Personality: a friendly desk where your LaTeX gets "printed".

## Principles
1. **One screen, two halves.** Left = write/drop, right = result. Nothing else competes.
2. **Every action answers back.** Compile = the mascot works, success = a small celebration, failure = a gentle wobble plus a readable log. No silent states.
3. **Fun, not noisy.** Animations last 150-600 ms, never loop on idle content, and are disabled under `prefers-reduced-motion`.
4. **Light on the eyes.** Warm paper background, no pure white or pure black, saturated accents used as small doses.
5. **Accessible.** Contrast >= 4.5:1 for text, visible focus rings, ARIA landmarks, buttons >= 44 px, keyboard shortcut Cmd/Ctrl+Enter to compile.

## Color tokens (light, default)
| Token | Hex | Use |
| --- | --- | --- |
| `--paper` | `#FFF8EC` | App background (warm cream) |
| `--card` | `#FFFDF7` | Panels |
| `--ink` | `#2D2A4A` | Text, borders (deep indigo, not black) |
| `--ink-soft` | `#5B5878` | Secondary text |
| `--coral` | `#FF7A70` | Primary action |
| `--teal` | `#2BB5A6` | Success / download |
| `--sun` | `#FFC857` | Highlights, mascot |
| `--lav` | `#9B8AFB` | Accents, drop zone |
| `--sky` | `#59C3F0` | Info / progress |
| `--berry` | `#E0457B` | Errors |
Dark variant (`prefers-color-scheme: dark`): `--paper #1F1D33`, `--card #2A2845`, `--ink #F4EFE3`, accents lightly desaturated. Same names.

## Typography
System stacks only (no web fonts, CSP forbids CDNs): UI `ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif`; code `ui-monospace, "SF Mono", Menlo, monospace`. Title 28/800, body 15/500, code 14/1.55.

## Shape and depth
Radius 16 px panels, 999 px pills. 2 px ink outline plus a hard offset shadow (`4px 4px 0 var(--ink)`) for a sticker feel; buttons press down (shadow collapses) on `:active`.

## Layout
Header (logo + tagline + actions) -> `main` split view (grid 1fr 1fr, collapses to stacked under 860 px) -> footer status bar (chars, size limit, engine state).
Left pane: toolbar (Open file, Sample, Clear, Auto-compile toggle), editor with line gutter, whole-pane drop target (dashed lavender border, bobbing "drop it" doodle). Right pane: toolbar (status pill, Download), preview iframe, empty state with mascot.

## Motion catalog
| Trigger | Feedback | Duration |
| --- | --- | --- |
| Page load | Logo bounces in, panels slide up staggered | 500 ms |
| File dragged over | Border animates dashes, doodle wiggles | loop while hovering |
| Compile start | Mascot "pencil" scribbles, status pill pulses sky | until done |
| Compile success | Confetti burst (CSS only, 12 particles), pill turns teal, Download button pops | 700 ms |
| Compile error | Panel shake, pill turns berry, log panel slides in | 400 ms |
| Button hover/press | Lift 2 px / press down | 120 ms |
| Copy / download | Button label swaps with a tick | 1.2 s |

## Microcopy tone
Short, warm, slightly cheeky: "Drop your .tex here", "Typesetting... hold my coffee", "Ta-da! Your PDF is ready", "Hmm, LaTeX is grumpy. Here is why:". Never blame the user; always show the actionable log line.

## Component inventory
`Header`, `DropZone`, `EditorPane`, `Toolbar`, `StatusPill`, `PreviewPane`, `Mascot`, `Confetti`, `ErrorLog`, `Footer`.
