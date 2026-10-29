# Design Language: "Doodle Desk"

Research basis: Nielsen Norman Group on microinteractions (trigger -> small, purposeful feedback; show system status, support undo, express brand, keep animations short and non-intrusive) and Material 3 layout guidance (clear hierarchy, landmarks and a single H1, 44 px minimum pointer targets, 8 px spacing, visible focus, sufficient contrast). Personality: a friendly desk where your files get "printed".

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

## Start menu (home)
The first screen is a menu, not a tool: Texy the mascot (happy) next to "What shall we make today?", a pill-shaped search box (`/` focuses it), then one section per category (small caps heading) with sticker cards. A card has a yellow icon tile, name, one-line description, chips (`.tex → .pdf`, `Ready` teal or `Needs setup` berry with the exact install command) and a numbered key badge (`1`-`9` opens that tool). Cards stagger in (60 ms steps), lift and tilt 0.4deg on hover, press down on click. Cards are plain links (`#/tool/<id>`), so they work with keyboard, middle-click and screen readers. Empty search: a friendly "Nothing matches" line; no tools: "No tools are installed in this build".

## Tool page (workbench)
Top bar: `← All tools` pill, tool icon + name (h2), then the tool's options (select / checkbox rendered from its manifest), the Auto-run switch (text tools) and the coral action button with the tool's own verb (Compile, Convert, ...). Below: editor (or a dashed file drop for binary tools) on the left, result on the right, a thin status bar (chars/size, engine version or install hint). Result kinds: PDF viewer, sandboxed HTML preview, or a "Your DOCX file is ready" card with Texy. Everything tool-specific comes from the manifest; do not hard-code tool names in UI components.

## Component inventory
`Header` (brand link, in `App`), `Home`, `Workbench`, `OptionsBar`, `EditorPane`, `FilePane`, `ResultPane`, `StatusPill`, `Mascot`, `Confetti`, `ErrorLog`, footer (in `App`).
