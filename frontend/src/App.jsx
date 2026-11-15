import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsUpDown, FolderOpen, Globe, GitBranch, Lock, Pause, Play, Save, Square, Volume2, VolumeX } from 'lucide-react'
import { api, isMock, ME } from './api.js'
import * as audio from './audio.js'
import { Browser } from './components/Browser.jsx'
import { Playlist } from './components/Playlist.jsx'
import { LANE_NAMES, TIPO_OF_INSTRUMENTO } from './lanes.js'
import { PianoRoll } from './components/PianoRoll.jsx'
import { Copilot } from './components/Copilot.jsx'
import { History } from './components/History.jsx'
import { NewPieceDialog } from './components/NewPieceDialog.jsx'
import { SaveDialog } from './components/SaveDialog.jsx'
import { usePlayhead } from './usePlayhead.js'
import { usePaneSplit } from './usePaneSplit.js'
import { isMine, loadUser, recordContribution, useUser } from './profile.js'
import { AuthDialog, Avatar, StemmaMark } from './Site.jsx'


const FILL_BARS = 8 // a piece added from the Browser repeats across the first 8 bars

// A function so `autor` is whoever is logged in when the project opens (ME changes on log in / out).
const emptySong = () => ({ id: 'c-new', nombre: 'Untitled project', autor: ME, tempo: 96, publica: true, pistas: [] })

export default function App({ projectId = 'new' }) {
  const [pieces, setPieces] = useState({}) // id → Pieza cache
  const [song, setSong] = useState(emptySong)
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null) // unsaved notes of the selected piece
  const [draftBars, setDraftBars] = useState(null) // unsaved length (compases) of the selected piece
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(emptySong())) // song as last loaded or saved
  const [diff, setDiff] = useState(null)
  const [playing, setPlaying] = useState(null) // 'song' | piece id | null
  // Project history window: null | 'tree' | 'changes' | 'versions' | 'merge' | 'credits'.
  // "#/project/<id>?history=<tab>" opens it right away (the Tree / History options in My projects).
  const [historyTab, setHistoryTab] = useState(() => {
    const tab = location.hash.match(/[?&]history=(\w+)/)?.[1]
    return ['tree', 'changes', 'versions', 'merge', 'credits'].includes(tab) ? tab : null
  })
  const [notice, setNotice] = useState(null) // short confirmation shown under the toolbar
  const [ask, setAsk] = useState(null) // starter prompt sent from the empty Playlist
  const [error, setError] = useState(null)
  const beat = usePlayhead()

  const remember = useCallback((list) => setPieces((p) => ({ ...p, ...Object.fromEntries(list.map((x) => [x.id, x])) })), [])

  const loadPiece = useCallback(
    async (id) => {
      if (pieces[id]) return pieces[id]
      const p = await api.getPiece(id)
      remember([p])
      return p
    },
    [pieces, remember],
  )

  const fail = (e) => setError(e.message || String(e))
  // Saving, forking and publishing need a signed-in user; the dialog finishes the action after login.
  const [user, setUser] = useUser()
  const [auth, setAuth] = useState(null) // { mode, reason, then }
  const signedIn = (reason, then) => {
    if (loadUser()) return true
    setAuth({ mode: 'login', reason, then })
    return false
  }
  const [volume, setVolume] = useState(audio.getVolume)
  // Per-lane fader and mute, by lane index. Not saved: the song contract (§4.2) has no mix fields.
  const [mix, setMix] = useState([])
  useEffect(() => {
    audio.setMix(mix)
  }, [mix])
  const setLaneMix = (i, patch) =>
    setMix((m) => {
      const next = [...m]
      next[i] = { vol: 1, mute: false, ...m[i], ...patch }
      return next
    })

  // Load the project from the landing page ("new" starts empty); stop audio when leaving the page.
  useEffect(() => {
    if (projectId !== 'new')
      api.project(projectId).then(async (p) => {
        const ids = [...new Set(p.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))]
        remember(await Promise.all(ids.map(api.getPiece)))
        undoLog.current.skip = true // loading is not an undo step
        setSong(p)
        setSavedJson(JSON.stringify(p))
      }, fail)
    return () => audio.stop()
  }, [projectId, remember])

  // Song playback ----------------------------------------------------------
  const songEvents = useMemo(
    () =>
      song.pistas.flatMap((pista, lane) =>
        pista.bloques.flatMap((b) =>
          (pieces[b.pieza_id]?.notas ?? []).map((n) => ({ ...n, instrument: pista.instrumento, lane, inicio: n.inicio + b.compas * 4 })),
        ),
      ),
    [song, pieces],
  )
  // The song loops up to the end of its last block, at least 4 bars.
  const songBars = Math.max(
    4,
    ...song.pistas.flatMap((t) => t.bloques.map((b) => b.compas + (pieces[b.pieza_id]?.compases ?? 0))),
  )
  const songBeats = songBars * 4

  const playSong = (from) => {
    if (!songEvents.length) return
    audio.play({ events: songEvents, bpm: song.tempo, lengthBeats: songBeats, loop: true, from })
    setPlaying('song')
  }
  const pause = () => {
    audio.pause()
    setPlaying(null)
  }
  const stop = () => {
    audio.stop()
    setPlaying(null)
  }
  const togglePlay = () => (playing === 'song' ? pause() : playSong())
  const seek = (b) => {
    if (playing && playing !== 'song') stop() // a piece preview owns the transport; take it back for the song
    audio.seek(Math.min(b, songBeats - 1))
  }
  const previewPiece = (piece, notes = piece.notas, len = piece.compases) => {
    if (playing === piece.id) return stop()
    const instrument = audio.instrumentFor(piece.tipo)
    audio.play({
      events: notes.map((n) => ({ ...n, instrument })),
      bpm: song.tempo,
      lengthBeats: len * 4,
      loop: false,
      from: 0,
      onEnd: () => setPlaying(null),
    })
    setPlaying(piece.id)
  }

  // Reload the loop when the song changes mid-play, keeping the playhead where it is.
  useEffect(() => {
    if (playing !== 'song') return
    if (!songEvents.length) return stop()
    playSong(audio.currentBeat() % songBeats)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songEvents, songBeats])

  useEffect(() => {
    audio.setBpm(song.tempo)
  }, [song.tempo])

  // Undo / redo for the song: every change to it (clips, tracks, tempo, name) is one step.
  const undoLog = useRef({ past: [], future: [], prev: null, skip: true })
  useEffect(() => {
    const u = undoLog.current
    if (u.skip) u.skip = false
    else if (u.prev && u.prev !== song) {
      u.past = [...u.past.slice(-99), u.prev]
      u.future = []
    }
    u.prev = song
  }, [song])
  const travel = (from, to) => {
    const u = undoLog.current
    if (!u[from].length) return
    u[to].push(song)
    u.skip = true
    setSong({ ...u[from].pop(), id: song.id }) // keep the saved id so the next save updates instead of duplicating
  }

  // Space toggles the song (except while typing); Ctrl/Cmd+S saves; Ctrl/Cmd+Z undoes and Ctrl/Cmd+Y (or Shift+Z) redoes.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 's') {
        e.preventDefault()
        if (saveAs) return // the Save as window is already open
        // Your own saved project: quick save, same name and visibility. Otherwise the Save as flow.
        return songMine && song.id !== 'c-new' && loadUser() ? quickSave() : saveProject()
      }
      if (mod && (k === 'z' || k === 'y')) {
        if (e.target.closest('input, textarea, select')) return // native text undo
        if (isMine(selected?.autor) && !diff && !e.target.closest('.playlist')) return // the piano roll undoes its own notes
        e.preventDefault()
        return k === 'y' || e.shiftKey ? travel('future', 'past') : travel('past', 'future')
      }
      if (e.code !== 'Space' || e.target.closest('input, textarea, button, select')) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Project saving (POST /canciones for a new project, PUT /canciones/:id after that).
  // Save → logged in? (else log in first) → "Save as" window: name + public/private → Keep working or My projects.
  const songDirty = JSON.stringify(song) !== savedJson
  const [savingSong, setSavingSong] = useState(false)
  const [saveAs, setSaveAs] = useState(null) // null | { saved: null | Cancion } while the Save as window is open
  const songMine = song.id === 'c-new' || isMine(song.autor) // a new project is yours even if you logged in after starting it

  /** Saves with optional name/visibility changes (and `mensaje`, what changed). Throws on failure; returns the saved project. */
  const writeProject = async ({ mensaje, ...changes } = {}) => {
    const me = loadUser().name
    setSavingSong(true)
    try {
      if ((draft || draftBars) && !(await save())) throw new Error('Could not save your edits to the selected piece.')
      const next = { ...song, ...changes }
      // Someone else's project is saved as your copy, never over theirs: a fork of it, made from the version you opened.
      const toSave = songMine
        ? { ...next, autor: song.id === 'c-new' ? me : song.autor }
        : { ...next, id: 'c-new', autor: me, parent_id: song.id !== 'c-new' ? song.id : null, parent_version: song.version || null }
      const saved = await api.saveProject({ ...toSave, mensaje })
      recordContribution()
      undoLog.current.skip = true // saving is not an undo step
      setSong(saved)
      setSavedJson(JSON.stringify(saved))
      if (!location.hash.endsWith(saved.id)) history.replaceState(null, '', `#/project/${saved.id}`) // new id, same page
      return saved
    } finally {
      setSavingSong(false)
    }
  }
  const saveProject = () => {
    if (savingSong || !song.pistas.length) return
    if (!signedIn('Log in to save this project.', () => setSaveAs({ saved: null }))) return
    setSaveAs({ saved: null })
  }
  const quickSave = () => {
    if (savingSong || !song.pistas.length || !songDirty) return
    writeProject().catch(fail)
  }
  // Project history: open an old version in the editor (as unsaved changes), or take the result of a merge.
  const openVersion = async (numero) => {
    try {
      const version = await api.version(song.id, numero)
      if (!version) throw new Error('Opening old versions needs the Stemma server.')
      const { nombre, tempo, pistas } = version.snapshot
      remember(await Promise.all([...new Set(pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))].map(api.getPiece)))
      setSong((s) => ({ ...s, nombre, tempo, pistas }))
      setHistoryTab(null)
      setNotice(`Opened v${numero} as unsaved changes. Save it to make it v${(song.version || 0) + 1}, or undo (Ctrl+Z) to go back.`)
    } catch (e) {
      fail(e)
    }
  }
  const takeMerge = async ({ cancion, version }) => {
    const ids = [...new Set(cancion.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))]
    remember(await Promise.all(ids.map(api.getPiece)))
    undoLog.current.skip = true // a merge is saved on the server already, not an undo step
    setSong(cancion)
    setSavedJson(JSON.stringify(cancion))
    recordContribution()
    setHistoryTab('versions')
    setNotice(`Merged: saved as v${version.numero}.`)
  }

  const goMyProjects = () => {
    if (!signedIn('Log in to see your projects.', goMyProjects)) return
    if (songDirty && song.pistas.length && !window.confirm('This project has unsaved changes. Leave without saving?')) return
    location.hash = `#/u/${encodeURIComponent(loadUser().name)}?tab=projects`
  }

  // Song editing -----------------------------------------------------------
  const addToSong = (piece) => {
    remember([piece])
    const instrumento = audio.instrumentFor(piece.tipo)
    setSong((s) => {
      if (s.pistas.some((t) => t.bloques.some((b) => b.pieza_id === piece.id))) return s
      const bloques = []
      for (let compas = 0; compas < FILL_BARS; compas += piece.compases) bloques.push({ pieza_id: piece.id, compas })
      return { ...s, pistas: [...s.pistas, { instrumento, bloques }] }
    })
  }
  const addMany = async (ids) => {
    try {
      for (const p of await Promise.all(ids.map(loadPiece))) addToSong(p)
    } catch (e) {
      fail(e)
    }
  }
  const removeLane = (i) => {
    setSong((s) => ({ ...s, pistas: s.pistas.filter((_, j) => j !== i) }))
    setMix((m) => m.toSpliced(i, 1))
  }
  const editLanes = (fn) => setSong((s) => ({ ...s, pistas: fn(s.pistas.map((t) => ({ ...t, bloques: [...t.bloques] }))) }))
  // Move (or copy) blocks [{ lane, j }] by dLane lanes and dBar bars; Playlist checks the target is free.
  const moveBlocks = (items, dLane, dBar, copy) =>
    editLanes((pistas) => {
      const moved = items.map(({ lane, j }) => ({ lane, block: pistas[lane].bloques[j] }))
      if (!copy) for (const t of pistas) t.bloques = t.bloques.filter((b) => !moved.some((m) => m.block === b))
      for (const { lane, block } of moved) pistas[lane + dLane].bloques.push({ ...block, compas: block.compas + dBar })
      return pistas
    })
  const addBlock = (lane, pieza_id, compas) => editLanes((pistas) => (pistas[lane].bloques.push({ pieza_id, compas }), pistas))
  // After a piece changes length, push later blocks in its lanes right so nothing overlaps.
  const ripple = (id, len) =>
    editLanes((pistas) =>
      pistas.map((t) => {
        if (!t.bloques.some((b) => b.pieza_id === id)) return t
        let end = 0
        const bloques = [...t.bloques].sort((a, b) => a.compas - b.compas).map((b) => {
          const compas = Math.max(b.compas, end)
          end = compas + (b.pieza_id === id ? len : (pieces[b.pieza_id]?.compases ?? 1))
          return { ...b, compas }
        })
        return { ...t, bloques }
      }),
    )
  const removeBlocks = (items) =>
    editLanes((pistas) => pistas.map((t, lane) => ({ ...t, bloques: t.bloques.filter((_, j) => !items.some((x) => x.lane === lane && x.j === j)) })))

  // Piece editing ----------------------------------------------------------
  const select = async (id) => {
    try {
      await loadPiece(id)
      setSelectedId(id)
      setDraft(null)
      setDraftBars(null)
      setDiff(null)
    } catch (e) {
      fail(e)
    }
  }

  const selected = pieces[selectedId]
  const notes = draft ?? selected?.notas ?? []
  const bars = draftBars ?? selected?.compases ?? 1

  const fork = async () => {
    if (!signedIn('Log in to fork this piece and edit your copy.', fork)) return
    try {
      const copy = await api.fork(selected.id, loadUser().name)
      recordContribution()
      remember([copy])
      // The song now uses your version wherever it used the original.
      setSong((s) => ({
        ...s,
        pistas: s.pistas.map((t) => ({ ...t, bloques: t.bloques.map((b) => (b.pieza_id === selected.id ? { ...b, pieza_id: copy.id } : b)) })),
      }))
      setSelectedId(copy.id)
      setDraft(null)
      setDraftBars(null)
      setDiff(null)
    } catch (e) {
      fail(e)
    }
  }

  const save = async () => {
    if (!signedIn('Log in to save your changes to this piece.', save)) return false
    try {
      const saved = await api.saveNotes(selected.id, notes, bars)
      recordContribution()
      remember([{ ...selected, ...saved, notas: saved.notas ?? notes, compases: saved.compases ?? bars }])
      if (bars !== selected.compases) ripple(selected.id, bars)
      setDraft(null)
      setDraftBars(null)
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }

  const toggleDiff = async () => {
    if (diff) return setDiff(null)
    try {
      if (draft && !(await save())) return
      await loadPiece(selected.parent_id)
      setDiff(await api.diff(selected.id, selected.parent_id))
    } catch (e) {
      fail(e)
    }
  }

  // New pieces of your own ("+" on a track or on the Playlist title bar) -------------------------
  // newPiece: { lane: index | null, instrumento (new track) | null, tipo, name } while the New piece window is open
  const [newPiece, setNewPiece] = useState(null)
  const startNewPiece = (lane = null, instrumento = null) => {
    if (!signedIn('Log in to compose your own pieces.', () => startNewPiece(lane, instrumento))) return
    const track = lane == null ? null : song.pistas[lane]
    const tipo = track
      ? (pieces[track.bloques[0]?.pieza_id]?.tipo ?? TIPO_OF_INSTRUMENTO[track.instrumento] ?? 'acordes')
      : instrumento
        ? (TIPO_OF_INSTRUMENTO[instrumento] ?? 'acordes')
        : null
    const shown = track?.instrumento ?? instrumento
    setNewPiece({ lane, instrumento: track ? null : instrumento, tipo, name: shown ? (LANE_NAMES[shown] ?? shown) : null })
  }
  const createPiece = async ({ nombre, tipo, compases, tonalidad }) => {
    const piece = await api.createPiece({
      nombre,
      tipo,
      compases,
      tonalidad,
      tempo: song.tempo,
      estilo: ['rap'],
      licencia: 'CC BY 4.0',
      fuente: 'Created in Stemma',
      notas: [],
      publica: false, // private until it is saved in a public project
    })
    remember([piece])
    recordContribution()
    const { lane, instrumento } = newPiece
    setSong((s) => {
      if (lane == null || !s.pistas[lane]) {
        // A new track, with the instrument picked under the tracks (or the usual one for the piece type).
        return { ...s, pistas: [...s.pistas, { instrumento: instrumento ?? audio.instrumentFor(tipo), bloques: [{ pieza_id: piece.id, compas: 0 }] }] }
      }
      // On an existing track: right after its last block.
      const end = Math.max(0, ...s.pistas[lane].bloques.map((b) => b.compas + (pieces[b.pieza_id]?.compases ?? 1)))
      return { ...s, pistas: s.pistas.map((t, i) => (i === lane ? { ...t, bloques: [...t.bloques, { pieza_id: piece.id, compas: end }] } : t)) }
    })
    setSelectedId(piece.id)
    setDraft(null)
    setDraftBars(null)
    setDiff(null)
    setNewPiece(null)
    setNotice(`Created ${piece.nombre} (${piece.id}). Draw its notes in the piano roll and press Save. Only you see it until you save it in a public project.`)
  }

  // Version tree: bring a piece back as it was in an older version, or keep working from that point ---------
  // info: the piece as it was there (id, notas, compases...) + successors (ids of its later states in the tree).
  const restorePiece = async (info, { edit = false } = {}) => {
    try {
      const live = await loadPiece(info.id)
      const sameNotes = JSON.stringify(live.notas) === JSON.stringify(info.notas) && live.compases === info.compases
      const yours = isMine(live.autor)
      let target = live
      let restoreNotes = false // the old notes go into the piano roll as unsaved edits of your own piece
      if (!sameNotes && yours) restoreNotes = true
      else if (!sameNotes || (edit && !yours)) {
        // Someone else's piece: your own fork of it, with the notes it had there.
        if (!signedIn(`Log in to ${edit ? 'keep working on' : 'bring back'} this piece as your own fork.`, () => restorePiece(info, { edit }))) return
        const copy = await api.fork(info.id, loadUser().name)
        target = sameNotes ? copy : { ...copy, ...(await api.saveNotes(copy.id, info.notas, info.compases)), notas: info.notas, compases: info.compases }
        recordContribution()
      }
      remember([target])
      // Where it goes: in place of the piece that stands there now (itself or a later state), else on a new track.
      const used = new Set(song.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))
      const current = used.has(info.id) ? info.id : info.successors.find((id) => used.has(id))
      if (!current) addToSong(target)
      else if (current !== target.id)
        setSong((s) => ({ ...s, pistas: s.pistas.map((t) => ({ ...t, bloques: t.bloques.map((b) => (b.pieza_id === current ? { ...b, pieza_id: target.id } : b)) })) }))
      setSelectedId(target.id)
      setDiff(null)
      setDraft(restoreNotes ? info.notas : null)
      setDraftBars(restoreNotes && info.compases !== live.compases ? info.compases : null)
      if (edit) setHistoryTab(null)
      const where = `as it was in ${info.where}`
      setNotice(
        restoreNotes
          ? `${target.nombre} is back ${where}, as unsaved edits: press Save in the piano roll to keep them, then save the project.`
          : target.id !== info.id
            ? `${target.nombre} is your own fork of ${info.id} ${where}${edit ? ': keep working on it in the piano roll.' : '. Save the project to keep it.'}`
            : `${target.nombre} is back in the project ${where}. Save the project to keep it.`,
      )
    } catch (e) {
      fail(e)
    }
  }
  // Unsaved piano roll edits, so the tree's "Now" row shows what you hear.
  const drafts = useMemo(
    () => (selectedId && (draft || draftBars) ? { [selectedId]: { notas: draft ?? selected?.notas ?? [], compases: draftBars ?? selected?.compases ?? 1 } } : {}),
    [selectedId, draft, draftBars, selected],
  )

  const songPos = playing && playing !== 'song' ? null : beat // song playhead, hidden while a piece previews
  // Playlist / piano roll split: the ↕ handle in the piano roll's title bar moves it (usePaneSplit.js).
  const pane = usePaneSplit()
  const paneHandle = (
    <span className={`pane-handle ${pane.maximized ? 'max' : ''}`} {...pane.handleProps}>
      <ChevronsUpDown size={14} aria-hidden="true" />
    </span>
  )

  return (
    <div className="app">
      <header className="toolbar">
        <a className="brand" href="#/" title="Back to Stemma home">
          <StemmaMark />
          <span>Stemma</span>
        </a>
        <input
          className="song-name"
          aria-label="Song name"
          value={song.nombre}
          onChange={(e) => setSong({ ...song, nombre: e.target.value })}
        />
        <button
          className={`vis ${song.publica === false ? 'private' : ''}`}
          onClick={() => setSong({ ...song, publica: song.publica === false })}
          aria-label={`Visibility: ${song.publica === false ? 'private' : 'public'}. Click to make it ${song.publica === false ? 'public' : 'private'}`}
          title={
            song.publica === false
              ? 'Private: hidden from Explore and from other people’s view of your profile. Anyone with the link can still open it (Stemma has no accounts yet). Click to make public, then save.'
              : 'Public: listed in Explore and on your profile. Click to make private, then save.'
          }
        >
          {song.publica === false ? <Lock size={12} aria-hidden="true" /> : <Globe size={12} aria-hidden="true" />}
          {song.publica === false ? 'Private' : 'Public'}
        </button>
        <div className="transport">
          <button
            className={`tbtn square ${playing === 'song' ? 'on' : ''}`}
            onClick={togglePlay}
            disabled={!songEvents.length}
            aria-label={playing === 'song' ? 'Pause' : 'Play'}
            title={`${playing === 'song' ? 'Pause' : 'Play'} (Space)`}
          >
            {playing === 'song' ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="tbtn square" onClick={stop} disabled={!playing && beat === 0} aria-label="Stop" title="Stop and return to the start">
            <Square size={13} />
          </button>
          <label className="lcd" title="Tempo">
            <input
              type="number"
              min="60"
              max="200"
              value={song.tempo}
              onChange={(e) => setSong({ ...song, tempo: Math.min(200, Math.max(60, +e.target.value || 96)) })}
            />
            <span>BPM</span>
          </label>
          <label className="volume" title={`Master volume ${volume}%`}>
            {volume ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              aria-label="Master volume"
              onChange={(e) => {
                setVolume(+e.target.value)
                audio.setVolume(+e.target.value)
              }}
            />
          </label>
          <div className="lcd" aria-label="Position">
            {songPos == null ? '–' : `${Math.floor(songPos / 4) + 1}:${Math.floor(songPos % 4) + 1}`}
          </div>
        </div>
        <button className="tbtn" onClick={saveProject} disabled={!songDirty || savingSong || !song.pistas.length} title="Save project (Ctrl+S)">
          <Save size={14} /> {savingSong ? 'Saving…' : !songDirty ? 'Saved' : songMine ? 'Save project' : 'Save a copy'}
        </button>
        <button className="tbtn" onClick={goMyProjects} title="All your projects, public and private">
          <FolderOpen size={14} /> My projects
        </button>
        <div className="spacer" />
        {isMock() && <span className="badge" title="Backend unreachable, using local mock data">Mock data</span>}
        <button
          className="tbtn"
          onClick={() => setHistoryTab('tree')}
          disabled={!song.pistas.length && song.id === 'c-new'}
          title="Origin tree, changes, versions, merge and credits of this project"
        >
          <GitBranch size={14} /> History{song.version > 0 && <span className="ver-chip">v{song.version}</span>}
        </button>
        {user ? (
          <a className="user-link" href={`#/u/${encodeURIComponent(user.name)}`} title="Your profile">
            <Avatar name={user.name} size={22} />
            <span>{user.name}</span>
          </a>
        ) : (
          <button className="tbtn" onClick={() => setAuth({ mode: 'login' })} title="Log in to save, fork and publish">
            Log in
          </button>
        )}
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {notice && !error && (
        <div className="error notice" role="status">
          {notice}
          <button onClick={() => setNotice(null)}>OK</button>
        </div>
      )}

      <Browser
        onResults={remember}
        onSelect={select}
        onAdd={addToSong}
        onPreview={previewPiece}
        onNeedLogin={(then) => signedIn('Log in to keep your favorite pieces.', then)}
        playing={playing}
        selectedId={selectedId}
        fail={fail}
      />

      <main className={`center ${pane.className}`} ref={pane.ref} style={pane.style}>
        <Playlist
          song={song}
          pieces={pieces}
          selectedId={selectedId}
          onSelect={select}
          songBars={songBars}
          onRemoveLane={removeLane}
          onMoveBlocks={moveBlocks}
          onAddBlock={addBlock}
          onRemoveBlocks={removeBlocks}
          mix={mix}
          onMix={setLaneMix}
          onSeek={seek}
          onStarter={() => setAsk({ at: Date.now() })}
          onNewPiece={startNewPiece}
          playhead={songPos}
        />
        <div className="pane-strip" {...pane.stripProps} />
        <PianoRoll
          handle={paneHandle}
          piece={selected}
          parent={selected?.parent_id ? pieces[selected.parent_id] : null}
          notes={notes}
          dirty={!!draft || !!draftBars}
          bars={bars}
          onBars={setDraftBars}
          editable={isMine(selected?.autor) && !diff}
          diff={diff}
          onChange={setDraft}
          onFork={fork}
          onSave={save}
          onToggleDiff={toggleDiff}
          onPreview={() => previewPiece(selected, notes, bars)}
          previewing={playing === selected?.id}
          playhead={playing === selected?.id ? beat : null}
        />
      </main>

      <Copilot song={song} pieces={pieces} onAddMany={addMany} onSelect={select} onTree={() => setHistoryTab('tree')} remember={remember} fail={fail} ask={ask} />

      {auth && (
        <AuthDialog
          mode={auth.mode}
          reason={auth.reason}
          onMode={(mode) => setAuth({ ...auth, mode })}
          onClose={() => setAuth(null)}
          onDone={(u) => {
            setUser(u)
            setAuth(null)
            auth.then?.()
          }}
        />
      )}

      {newPiece && (
        <NewPieceDialog tipo={newPiece.tipo} lane={newPiece.name} newTrack={newPiece.lane == null} onCreate={createPiece} onClose={() => setNewPiece(null)} />
      )}

      {saveAs && (
        <SaveDialog
          song={song}
          copy={!songMine}
          saved={saveAs.saved}
          onSave={async (changes) => setSaveAs({ saved: await writeProject(changes) })}
          onClose={() => setSaveAs(null)}
          onMyProjects={() => {
            setSaveAs(null)
            goMyProjects()
          }}
        />
      )}

      {historyTab && (
        <History
          song={song}
          tab={historyTab}
          onTab={setHistoryTab}
          onClose={() => setHistoryTab(null)}
          loadPiece={loadPiece}
          dirty={songDirty && song.pistas.length > 0}
          canEdit={songMine && Boolean(user)}
          onOpenVersion={openVersion}
          onMerged={takeMerge}
          pieces={pieces}
          drafts={drafts}
          playing={playing}
          onPreview={(p) => previewPiece(p, p.notas, p.compases)}
          onRestorePiece={restorePiece}
        />
      )}
    </div>
  )
}
