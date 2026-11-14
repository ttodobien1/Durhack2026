# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React (Vite), Tone.js, @tonejs/midi, React Flow (origin tree). Backend: Node + Express + SQLite. Fixed by the team in CLAUDE.md.

## Users

Hackathon judges at DurHack 2026 (theme: "Composition"), clicking through the app on their own laptops at the table, after or alongside a 2‑minute live demo. Secondary: the musician persona in the demo, who composes a salsa romántica song from reusable pieces.

## Product Purpose

Stemma is "the GitHub of musical ideas": songs are composed from short reusable MIDI pieces (rhythm, chords, melody, bass). Each piece keeps its author, license and parent. The user searches pieces, forks one, edits notes in a piano roll, sees a readable musical diff against the parent, and sees the origin tree of their song: which pieces, whose, and what they contributed. Success = a judge understands, within a minute of clicking, who made what in a song.

## Positioning

Traceable origin of every piece plus a readable musical diff. BandLab has forks, Splice/Mozart AI/Veena have AI copilots; none show lineage and a note-level diff. The tree and diff are the last things cut.

## Operating Context

- Desktop laptop browser, mouse/trackpad, audio playback through laptop speakers.
- One style for the demo: salsa romántica. It has to sound good.
- Demo flow: copilot proposes rhythm/montuno/bass → fork montuno → edit in piano roll → diff → play full song → origin tree ("4 pieces from 3 authors, and this is yours").

## Capabilities and Constraints

- MIDI only, never audio. Times are in beats (quarter notes), not seconds. Velocity 0–1.
- Data contracts (Piece, Song, API) in CLAUDE.md §4 are fixed; field names stay in Spanish (`notas`, `tono`, `inicio`, …). All UI copy and code in English.
- Diff colors are fixed by the team: green = new, red = deleted, yellow = moved.
- Copilot only recommends existing pieces and explains why; never composes or generates notes. Artist requests are translated into style traits, never imitation.
- Out of scope: recorded audio, vocals, lyrics, mixing, user accounts, social features.
- Origin tree view is owned by role C; frontend provides the panel and a basic placeholder render.

## Evidence on Hand

- No seed pieces committed yet (role C). Frontend works from local mock data matching contract 4.1/4.2.
- Seed sources: Groove MIDI Dataset (CC BY 4.0), pieces created at the event, PDMX. Attribution (author, license, source) must be visible.
- No testimonials, users or metrics exist; do not fabricate any.

## Product Principles

1. The user is the composer. The copilot suggests and explains; it never composes.
2. Authorship is always visible: every piece shows who made it and under what license.
3. Show what changed in musical terms, not abstract version numbers.
4. End-to-end working beats breadth: search → fork → edit → diff → play → tree.

## Brand Commitments

- The app is themed like FL Studio, in FL Studio's own colours (user pinned: "Make the theme FL Studio, same colours as FL Studio"). Use its conventions (Browser, Playlist, Piano Roll, slate panels, orange highlights, green notes), never its logo, fruit mark or name.
