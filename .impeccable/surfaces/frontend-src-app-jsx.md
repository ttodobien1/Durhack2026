---
version: 1
slug: "frontend-src-app-jsx"
primary_target: "frontend/src/App.jsx"
related_targets: []
---

# Surface: Stemma studio (single-screen app)

Mode: Operate. Audience: DurHack judges on their own laptops. Task: search pieces → play → add to song → fork → edit notes → see diff → play song → open origin tree. Copilot suggests existing pieces only.

## Direction contract

THESIS: Stemma is a DAW the judges already know, FL Studio's working layout and colours, where every block and note carries its author. It refuses the "lineage as a side panel" arrangement: credits live in the playlist blocks, the browser rows and the piano roll title.
OWN-WORLD: FL Studio default theme. Slate panels (#2f3539 / #3d454b / #262b2f), light text #c8d0d4, orange #ff9a1f for active and play, green #7fc95b piano-roll notes with dark outline, pastel pattern clips in the playlist, 1px top-light / bottom-dark bevels, dense 12–13px UI, tabular mono readouts.
STORY: The judge sees a song already arranged from pieces by several authors, plays it, forks the montuno, drags a note, hits Diff and sees green/red/yellow against the parent, then opens the origin tree: who made what, and what's theirs.
FIRST VIEWPORT: Top toolbar: logo, song name, transport (play/stop), tempo, Diff toggle, Origin tree button. Left 280px Browser: search, type filters, piece rows (id, name, author, license, preview). Centre: Playlist (instrument lanes with piece blocks over a bar ruler) on top, Piano Roll (keyboard + grid, selected piece, Fork/Save) below. Right 320px dock: Copilot chat with suggested piece chips + Credits list.
FORM: seed: none (pinned) "Make the theme FL Studio, same colours as FL Studio" + request: "Library with search + playback (Tone.js), song track editor, piano roll (editable) with diff coloring (green new, red deleted, yellow moved), fork button, copilot chat panel, origin tree view slot (React Flow, built by role C)"
SIGNATURE: Diff mode in the piano roll. Unchanged notes drop to grey, new notes green, deleted notes red ghosts, moved notes yellow with a thin line from old to new position. Plus a live readout of pitch/beat/length under the cursor.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
