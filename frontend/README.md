# Stemma frontend

```sh
cd frontend
npm install
npm run dev        # http://localhost:5173
node src/diff.test.js   # diff self-check
node src/split.test.js  # MIDI splitter self-check
node src/markdown.test.js
```

`VITE_API_URL` (see `.env.example`, default `http://localhost:3001`) points at the backend. If it is unreachable the app switches to the in-memory mock in `src/mock.js` and shows a **Mock data** badge, so it always demos.

## Pages

- `#/` landing (`src/Landing.jsx`): hero, public projects with search, tag filters and preview, Log in / Sign up.
- `#/project/<id>` project page (`src/App.jsx`); `#/project/new` starts empty. The **History** button opens the project history window (`src/components/History.jsx`), with GitHub-style tabs:
  - **Tree** (`components/VersionTree.jsx`, rows built by `src/versionTree.js`): every version is a row with all its pieces, linked to where each piece was before (same, edited, fork), library origins on top and the unsaved state ("Now") at the bottom. Nodes can be dragged (positions remembered in this browser); clicking a piece shows its change and lets you listen to it, restore it in the project, or continue working from it.
  - **Changes**: what a version changed, track by track and note by note (green new, red deleted, yellow moved), against the previous version or any other.
  - **Versions**: v1, v2… one per save, like commits, with an optional message from the Save window; any version can be opened in the editor.
  - **Merge**: bring in the changes of a fork (or of the original) with conflicts to resolve and harmonic clash warnings.
  - **Credits**: who wrote each note of the song, forks included.
- `#/u/<name>` profile (`src/Profile.jsx`): README, pinned projects, contribution graph, projects and pieces tabs.
- Playlist: the **+** on a track, **+ New piece** in its title bar, or the **+ Add track** row under the tracks (pick an instrument first) opens `components/NewPieceDialog.jsx` and creates an empty piece of your own (`POST /piezas` with `publica: false`, private until it is in a public project) that opens in the piano roll. Editing a beat offers a basic drum kit to draw on.
- `#/upload` split a MIDI song into loops (`src/split.js`, same rules as `data/scripts` 04/05/08) and publish the chosen ones with `POST /piezas`.
- `#/settings` profile settings (`src/Settings.jsx`): name, bio, picture, accent colour, README, pins.

Log in / Sign up use real accounts on the backend (`/auth/registro`, `/auth/login`, see `backend/README.md`); `src/api.js` keeps the session token in this browser and sends it as `Authorization: Bearer`. `ME` in `api.js` is the logged-in username (`"you"` when signed out), so forks and projects are authored and editable by the account. Profiles are saved on the backend (`PUT /auth/yo`, `GET /usuarios/:nombre`) with a copy in this browser (`src/profile.js`). The contribution graph is seeded per username until the backend stores dates; forks and saves made in this browser are added on top.

## For the backend (role B)

- Projects use the backend's extra song routes (`cambios.md` §3): `GET /canciones`, `GET /canciones/:id`, `POST /canciones` (new project), `PUT /canciones/:id` (Save project / Ctrl+S).
- Track `instrumento` values are Spanish like the seed data: `bateria`, `piano`, `bajo`, `melodia` (English aliases still play).
- Changing a piece's length sends `compases` with the notes in `PUT /piezas/:id`.
- The client calls exactly the routes in CLAUDE.md §4.3 (`src/api.js`).
- `PUT /piezas/:id` is sent as `{ "notas": [...] }`.
- `GET /piezas/:id/diff/:otra` is called as **changed piece first, original second**: `nuevas` = notes only in `:id`.
- `POST /piezas/:id/fork` sends `{ "autor": ME }` (the backend uses the logged-in account when there is a token).
- The origin tree is built client-side by walking `parent_id` with `GET /piezas/:id`, so it also reflects unsaved changes.
- Project history uses the routes in `cambios.md` §9 (versions, diff, forks, merge, credits). Saving someone else's project as a copy sends `parent_id` + `parent_version` (a project fork); every save can send `mensaje`. Offline (mock data) only the Tree tab works.

## For the tree view (role C)

The Tree tab of the project history is now `src/components/VersionTree.jsx` (one row per version, see above); it reuses the `tree-node` styles. `src/components/OriginTree.jsx` (the first origin tree) is no longer used by the app and is kept for reference.

## Layout

| File | What |
| --- | --- |
| `App.jsx` | State: song, selected piece, draft notes, diff, playback |
| `components/Browser.jsx` | Search + type filter, preview, add to song |
| `components/Playlist.jsx` | Song lanes with piece clips (8 bars) |
| `components/PianoRoll.jsx` | Note editor + diff view |
| `components/Copilot.jsx` | Chat to `/copiloto`, suggestion chips, credits |
| `components/History.jsx` | Project history window: Tree, Changes, Versions, Merge, Credits (styles in `history.css`) |
| `components/VersionTree.jsx` | Tree tab: versions as rows of pieces, draggable, restore / continue working (`versionTree.js` builds the rows) |
| `components/NewPieceDialog.jsx` | New piece window for the "+" buttons of the Playlist |
| `audio.js` | Tone.js playback in beats (sampled piano, synth bass/lead, synthesized clave/congas/bell) |
