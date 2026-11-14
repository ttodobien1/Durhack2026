import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitBranch, Pause, Play, Save, Square, Volume2, VolumeX } from 'lucide-react'
import { api, isMock, ME } from './api.js'
import * as audio from './audio.js'
import { Browser } from './components/Browser.jsx'
import { Playlist } from './components/Playlist.jsx'
import { PianoRoll } from './components/PianoRoll.jsx'
import { Copilot } from './components/Copilot.jsx'
import { OriginTree } from './components/OriginTree.jsx'
import { usePlayhead } from './usePlayhead.js'


const FILL_BARS = 8 // a piece added from the Browser repeats across the first 8 bars

const emptySong = { id: 'c-new', nombre: 'Untitled project', autor: ME, tempo: 96, pistas: [] }

export default function App({ projectId = 'new' }) {
  const [pieces, setPieces] = useState({}) // id → Pieza cache
  const [song, setSong] = useState(emptySong)
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null) // unsaved notes of the selected piece
  const [draftBars, setDraftBars] = useState(null) // unsaved length (compases) of the selected piece
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(emptySong)) // song as last loaded or saved
  const [diff, setDiff] = useState(null)
  const [playing, setPlaying] = useState(null) // 'song' | piece id | null
  const [treeOpen, setTreeOpen] = useState(false)
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
  const [volume, setVolume] = useState(audio.getVolume)

  // Load the project from the landing page ("new" starts empty); stop audio when leaving the page.
  useEffect(() => {
    if (projectId !== 'new')
      api.project(projectId).then(async (p) => {
        const ids = [...new Set(p.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))]
        remember(await Promise.all(ids.map(api.getPiece)))
        setSong(p)
        setSavedJson(JSON.stringify(p))
      }, fail)
    return () => audio.stop()
  }, [projectId, remember])

  // Song playback ----------------------------------------------------------
  const songEvents = useMemo(
    () =>
      song.pistas.flatMap((pista) =>
        pista.bloques.flatMap((b) =>
          (pieces[b.pieza_id]?.notas ?? []).map((n) => ({ ...n, instrument: pista.instrumento, inicio: n.inicio + b.compas * 4 })),
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

  // Space toggles the song (except while typing); Ctrl/Cmd+S saves the project.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        return saveProject()
      }
      if (e.code !== 'Space' || e.target.closest('input, textarea, button, select')) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Project saving (POST /canciones for a new project, PUT /canciones/:id after that).
  const songDirty = JSON.stringify(song) !== savedJson
  const [savingSong, setSavingSong] = useState(false)
  const saveProject = async () => {
    if (savingSong || !song.pistas.length) return
    setSavingSong(true)
    try {
      if ((draft || draftBars) && !(await save())) return
      const saved = await api.saveProject(song)
      setSong(saved)
      setSavedJson(JSON.stringify(saved))
      if (!location.hash.endsWith(saved.id)) history.replaceState(null, '', `#/project/${saved.id}`) // new id, same page
    } catch (e) {
      fail(e)
    } finally {
      setSavingSong(false)
    }
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
  const removeLane = (i) => setSong((s) => ({ ...s, pistas: s.pistas.filter((_, j) => j !== i) }))
  const editLanes = (fn) => setSong((s) => ({ ...s, pistas: fn(s.pistas.map((t) => ({ ...t, bloques: [...t.bloques] }))) }))
  // Move (or copy) block j of lane `from` to bar `compas` of lane `to`.
  const moveBlock = (from, j, to, compas, copy) =>
    editLanes((pistas) => {
      const block = { ...pistas[from].bloques[j], compas }
      if (!copy) pistas[from].bloques.splice(j, 1)
      pistas[to].bloques.push(block)
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
  const removeBlock = (lane, j) => editLanes((pistas) => (pistas[lane].bloques.splice(j, 1), pistas))

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
    try {
      const copy = await api.fork(selected.id, ME)
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
    try {
      const saved = await api.saveNotes(selected.id, notes, bars)
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

  const songPos = playing && playing !== 'song' ? null : beat // song playhead, hidden while a piece previews

  return (
    <div className="app">
      <header className="toolbar">
        <a className="brand" href="#/" title="Back to Lineage home">
          <LineageMark />
          <span>Lineage</span>
        </a>
        <input
          className="song-name"
          aria-label="Song name"
          value={song.nombre}
          onChange={(e) => setSong({ ...song, nombre: e.target.value })}
        />
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
          <Save size={14} /> {savingSong ? 'Saving…' : songDirty ? 'Save project' : 'Saved'}
        </button>
        <div className="spacer" />
        {isMock() && <span className="badge" title="Backend unreachable, using local mock data">Mock data</span>}
        <button className="tbtn" onClick={() => setTreeOpen(true)} disabled={!song.pistas.length}>
          <GitBranch size={14} /> Origin tree
        </button>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <Browser onResults={remember} onSelect={select} onAdd={addToSong} onPreview={previewPiece} playing={playing} selectedId={selectedId} fail={fail} />

      <main className="center">
        <Playlist
          song={song}
          pieces={pieces}
          selectedId={selectedId}
          onSelect={select}
          songBars={songBars}
          onRemoveLane={removeLane}
          onMoveBlock={moveBlock}
          onAddBlock={addBlock}
          onRemoveBlock={removeBlock}
          onSeek={seek}
          onStarter={() => setAsk({ at: Date.now() })}
          playhead={songPos}
        />
        <PianoRoll
          piece={selected}
          parent={selected?.parent_id ? pieces[selected.parent_id] : null}
          notes={notes}
          dirty={!!draft || !!draftBars}
          bars={bars}
          onBars={setDraftBars}
          editable={selected?.autor === ME && !diff}
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

      <Copilot song={song} pieces={pieces} onAddMany={addMany} onSelect={select} onTree={() => setTreeOpen(true)} remember={remember} fail={fail} ask={ask} />

      {treeOpen && <OriginTree song={song} loadPiece={loadPiece} onClose={() => setTreeOpen(false)} />}
    </div>
  )
}

export function LineageMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3v8a4 4 0 0 0 4 4h2M5 11a4 4 0 0 1 4-4h4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="5" cy="3" r="2" fill="currentColor" />
      <circle cx="15" cy="7" r="2.5" fill="var(--orange)" />
      <circle cx="13" cy="15" r="2.5" fill="var(--note)" />
    </svg>
  )
}
