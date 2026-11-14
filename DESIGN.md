---
name: Lineage
description: A DAW-style studio where every block and note carries its author.
colors:
  workspace: "#3e464c"
  panel: "#343b40"
  well: "#2a3034"
  well-grid: "#2e353a"
  black-row: "#262b2f"
  title-top: "#58636b"
  title-bottom: "#4a545b"
  line: "#1c2124"
  bevel: "#5b676f"
  lcd: "#171b1d"
  text: "#d3d9dc"
  text-dim: "#a1adb3"
  orange: "#ff9a1f"
  on-orange: "#1d1a14"
  note-green: "#8bd16b"
  note-edge: "#355f24"
  on-note: "#142411"
  diff-new: "#46e06a"
  diff-deleted: "#ff5a52"
  diff-moved: "#ffd23f"
  diff-same: "#6c777d"
  type-rhythm: "#d2766e"
  type-chords: "#72a6d2"
  type-bass: "#a98bd6"
  type-melody: "#6cbca1"
typography:
  brand:
    fontFamily: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  title:
    fontFamily: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  body:
    fontFamily: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  readout:
    fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 600
  code:
    fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: "16px"
rounded:
  sm: "2px"
spacing:
  gutter: "3px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
components:
  button:
    backgroundColor: "{colors.title-bottom}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "26px"
    padding: "0 10px"
  button-on:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.on-orange}"
    rounded: "{rounded.sm}"
    height: "26px"
    padding: "0 10px"
  panel-title:
    backgroundColor: "{colors.title-bottom}"
    textColor: "{colors.text}"
    typography: "{typography.title}"
    height: "24px"
    padding: "0 8px"
  input-search:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "28px"
    padding: "0 8px"
  lcd-readout:
    backgroundColor: "{colors.lcd}"
    textColor: "{colors.orange}"
    typography: "{typography.readout}"
    rounded: "{rounded.sm}"
    height: "28px"
  segmented-on:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.on-orange}"
  piece-id:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text-dim}"
    typography: "{typography.code}"
    rounded: "{rounded.sm}"
  note:
    backgroundColor: "{colors.note-green}"
    textColor: "{colors.on-note}"
    rounded: "{rounded.sm}"
    height: "13px"
---

# Design System: Lineage

## Overview

**Creative North Star: "The Credited Studio"**

Lineage looks and behaves like the DAW judges already know: FL Studio's default theme and working layout (Browser left, Playlist over Piano Roll in the centre, a dock on the right), in FL's own slate-and-orange palette. This is a pinned brand commitment: FL's conventions and colours, never its logo, fruit mark or name.

The difference is that authorship is drawn into the instrument itself, not parked in a side panel. Every playlist clip header, browser row and piano-roll title names its author and licence; the user's own pieces burn orange everywhere they appear. Density is high (12px UI, 2–3px gutters, 24–28px controls) because this is a working tool, not a landing page.

**Key Characteristics:**
- Slate panels with 1px top-light / bottom-dark bevels and near-black hairline borders.
- Orange is the single "live" signal: active toggles, play, focus, playhead, and "this is yours".
- Piece type is colour-coded once and reused across clips, browser rows and tree nodes.
- Tabular mono readouts in sunken LCD wells.

## Colors

A dark slate workshop with one hot accent (orange), one working colour (note green), and two fixed semantic sets: piece types and diff states.

### Primary
- **FL Orange** (orange): active and pressed states, play button, segmented-control selection, focus ring, text selection, playhead, LCD digits, and every piece authored by the current user ("you"). Text on it is **Burnt Ink** (on-orange).

### Secondary
- **Note Green** (note-green) with **Moss Edge** (note-edge) outline and **Deep Moss** (on-note) label: piano-roll notes at rest, the cursor readout, the "in song" marker.

### Tertiary: piece types
- **Rhythm Clay** (type-rhythm), **Chord Sky** (type-chords), **Bass Lilac** (type-bass), **Melody Jade** (type-melody). Pastel, FL-pattern-clip style. Applied through one `--tc` variable per type: clip header and mini-roll fill, the 3px left stripe on browser ids, and origin-tree node heads. Clip bodies are the type colour mixed 30% into the well.

### Diff states (fixed by the team, CLAUDE.md §5)
- **Diff Green** (diff-new): new note, solid.
- **Diff Red** (diff-deleted): deleted note, dashed red ghost on a 16% red wash.
- **Diff Yellow** (diff-moved): moved note, solid at the new position; the old position is a dashed yellow ghost joined by a dashed yellow connector line.
- **Diff Grey** (diff-same): unchanged notes recede to grey while diff mode is on.

### Neutral
- **Workspace Slate** (workspace): page ground between panels.
- **Panel Slate** (panel): panel bodies, bot chat messages, tree nodes.
- **Well** (well) and **Grid Well** (well-grid): sunken content areas (playlist, piano roll grid, chat, search, tree canvas).
- **Black-key Row** (black-row): grid row lines.
- **Title Steel** (title-top → title-bottom): panel title-bar gradient, hover fill for icon buttons.
- **Hairline** (line): every border and divider. **Bevel** (bevel): the 1px inset top highlight.
- **LCD Black** (lcd): tempo and cursor readouts.
- **Console Text** (text) and **Dim Text** (text-dim): primary and secondary text.

### Named Rules
**The You Are Orange Rule.** A piece whose author is the current user renders orange wherever authorship shows: clip header and mini-roll, credits name, tree node head and border. No other piece may use orange as its identity colour.

**The One Map Rule.** Piece-type colours and diff colours are separate vocabularies. Never reuse a type colour to mean a diff state or vice versa.

## Typography

**UI Font:** Segoe UI (with system-ui, -apple-system, Helvetica Neue, Arial)
**Mono Font:** ui-monospace (with SFMono-Regular, Menlo, Consolas)

**Character:** The native, unshowy face of a desktop DAW, small and tight, paired with tabular mono for anything that counts.

### Hierarchy
- **Brand** (700, 15px): wordmark in the toolbar only.
- **Title** (600, 12–13px): panel title bars, song name, tree summary.
- **Body** (400, 12px, 1.4): all UI text; `font-variant-numeric: tabular-nums` globally.
- **Label** (400, 11px): piece meta, lane piece name, clip headers (600), segmented buttons.
- **Readout** (mono 600, 13px): LCD tempo; cursor readout is mono 500, 11px.
- **Code** (mono 500, 10.5px/16px): piece ids.

### Named Rules
**The Numbers Are Mono Rule.** Tempo, bar numbers, pitch/beat/length readouts and piece ids are monospace; prose never is.

## Layout

A fixed three-column studio grid: 280px Browser, flexible centre, 320px dock, under a 44px toolbar, separated by 3px gutters on the workspace slate. The centre stacks Playlist (min 170px, 40%) over Piano Roll. Panels scroll internally; the page itself does not at desktop widths. Rhythm is 4/6/8/12px; controls are 26px (buttons), 28px (inputs, LCDs), 24px (title bars), 52px playlist lanes, 20px ruler. Below 1000px the columns stack (toolbar wraps, browser capped at 320px, playlist 260px, roll 420px).

## Elevation & Depth

Depth is FL-style bevel, not floating shadow. Surfaces get a 1px inset top highlight (bevel) and a hairline dark border; pressed and sunken things (LCDs, active buttons) get an inset dark shadow. Real drop shadows exist only on things that genuinely float: the origin-tree window and tree nodes.

### Shadow Vocabulary
- **Bevel** (`box-shadow: inset 0 1px 0 #5b676f`): panels, toolbar; buttons use `inset 0 1px 0 #6c7880`.
- **Sunken** (`box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.5)`): LCD readouts; pressed buttons at 0.45.
- **Window** (`box-shadow: 0 18px 50px rgb(0 0 0 / 0.55)`): the modal origin-tree window.
- **Node** (`box-shadow: 0 3px 10px rgb(0 0 0 / 0.35)`): tree nodes; "mine" adds a 2px orange halo at 35%.
- **Playhead glow** (`box-shadow: 0 0 4px rgb(255 154 31 / 0.5)`).

### Named Rules
**The Bevel Not Float Rule.** In-app chrome is raised or sunken with 1px insets. Drop shadows are reserved for windows and graph nodes.

## Shapes

Nearly square: 2px radius on everything interactive (buttons, inputs, clips, notes, chat messages, tree nodes); 1px on legend swatches. Borders are always 1px hairline; dashed borders are reserved for diff ghosts.

## Components

### Buttons
- **Shape:** 2px, 26px tall, 10px side padding, hairline border.
- **Default:** raised steel gradient (#56616a → #48525a) with bevel; hover lightens one step; active sinks (inset shadow, flat #444d54).
- **On / Accent:** orange gradient (#ffad45 → #f08a10), Burnt Ink text, 600 weight. Used for Play while playing, Diff on, and the primary call to action.
- **Icon:** 26px (20px small), transparent until hover, dim glyph brightening to text. Icons are inline SVG.

### Segmented control (type filters)
Hairline-bordered strip of equal buttons on title-steel; the selected one fills orange.

### Inputs
- **Style:** well background, hairline border, 2px radius, 28px.
- **Focus:** border turns orange; global `:focus-visible` is a 2px orange outline.
- **Song name:** borderless until hover or focus, then becomes a well.

### Panels
Panel slate body with bevel and hairline; a 24px title bar in the title-steel gradient carries the panel name and, in the piano roll, the author/licence credit.

### Browser piece row
Mono id chip with a 3px type-colour left stripe, name (600) over dim meta (author · licence). Hover lifts to #3b4348; selected gets a warm #474232 fill and a 2px orange inset left edge.

### Playlist clip (signature)
Type-coloured header strip (name left, "by author" right, dark #15191b text) over a mini piano-roll in the type colour on a 30% tinted body. Mine = orange header and mini. Selected = 2px white outline.

### Piano roll and diff mode (signature)
Light keyboard (#e9ecee, black keys #22272a) beside a well grid with bar / beat / row lines. Notes are 13px green bars with moss outline and a darker 4px resize grip when editable; selected notes go pale (#d6f5c4, white edge). In diff mode the four diff states apply exactly as in Colors, with a legend in the tool row. A mono green readout shows pitch/beat/length under the cursor.

### Origin tree node
200px panel-slate card, 2px radius, node shadow; type-coloured head with dark id chip. Mine = orange head, orange border and halo. Ancestors not in the song sit at 80% opacity.

### LCD readout
Sunken LCD-black well, orange mono digits, dimmer orange (#c27720) unit label.

## Do's and Don'ts

### Do:
- **Do** use orange (#ff9a1f) only for live state, focus, the playhead, and the current user's pieces.
- **Do** colour a piece by its type through the shared type variable so clips, browser stripes and tree heads stay in sync.
- **Do** keep the diff mapping fixed: green new, red dashed ghost deleted, yellow moved with dashed ghost and connector, grey unchanged.
- **Do** show author and licence wherever a piece is shown.
- **Do** keep raised/sunken depth to 1px insets and 2px corners.

### Don't:
- **Don't** use FL Studio's logo, fruit mark or name anywhere.
- **Don't** give a non-user piece an orange identity, or use a type colour to signal a diff state.
- **Don't** put drop shadows on in-app chrome; they belong to the tree window and nodes.
- **Don't** use dashed borders except for diff ghosts.
