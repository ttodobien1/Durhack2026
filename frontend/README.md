# Lineage frontend

```sh
cd frontend
npm install
npm run dev        # http://localhost:5173
node src/diff.test.js   # diff self-check
```

`VITE_API_URL` (see `.env.example`, default `http://localhost:3001`) points at the backend. If it is unreachable the app switches to the in-memory mock in `src/mock.js` and shows a **Mock data** badge, so it always demos.

## Pages

- `#/` landing (`src/Landing.jsx`): hero, public projects with search, tag filters and preview, Log in / Sign up.
- `#/project/<id>` project page (`src/App.jsx`); `#/project/new` starts empty.

Log in / Sign up only remember a username in this browser: accounts are out of scope in CLAUDE.md §2.

## For the backend (role B)

- Projects use the backend's extra song routes (`cambios.md` §3): `GET /canciones`, `GET /canciones/:id`, `POST /canciones` (new project), `PUT /canciones/:id` (Save project / Ctrl+S).
- Track `instrumento` values are Spanish like the seed data: `bateria`, `piano`, `bajo`, `melodia` (English aliases still play).
- Changing a piece's length sends `compases` with the notes in `PUT /piezas/:id`.
- The client calls exactly the routes in CLAUDE.md §4.3 (`src/api.js`).
- `PUT /piezas/:id` is sent as `{ "notas": [...] }`.
- `GET /piezas/:id/diff/:otra` is called as **changed piece first, original second**: `nuevas` = notes only in `:id`.
- `POST /piezas/:id/fork` sends `{ "autor": "you" }`.
- The origin tree is built client-side by walking `parent_id` with `GET /piezas/:id`, so it also reflects unsaved changes.

## For the tree view (role C)

`src/components/OriginTree.jsx` is a placeholder. Keep its props (`song`, `loadPiece`, `onClose`) and restyle or replace the React Flow view freely.

## Layout

| File | What |
| --- | --- |
| `App.jsx` | State: song, selected piece, draft notes, diff, playback |
| `components/Browser.jsx` | Search + type filter, preview, add to song |
| `components/Playlist.jsx` | Song lanes with piece clips (8 bars) |
| `components/PianoRoll.jsx` | Note editor + diff view |
| `components/Copilot.jsx` | Chat to `/copiloto`, suggestion chips, credits |
| `audio.js` | Tone.js playback in beats (sampled piano, synth bass/lead, synthesized clave/congas/bell) |
