import { useEffect, useState } from 'react'
import { ArrowRight, Check, FileMusic, Play, RotateCcw, Square } from 'lucide-react'
import { api } from './api.js'
import * as audio from './audio.js'
import { AuthDialog, SiteBar } from './Site.jsx'
import { loadUser, recordContribution, useUser } from './profile.js'
import { splitMidi } from './split.js'
import { TYPES, typeLabel } from './components/Browser.jsx'
import { MiniNotes } from './components/Playlist.jsx'
import './profile.css'
import './upload.css'

const LICENSES = ['CC BY 4.0', 'CC0 1.0']
const MAX_BYTES = 1_000_000

/** #/upload: split a MIDI song into loops, review them, publish the chosen ones to the shared library. */
export function Upload() {
  const [user, setUser] = useUser()
  const autor = user?.name
  const [auth, setAuth] = useState(null) // login dialog opened by Publish while signed out
  const [song, setSong] = useState(null) // { file, tempo, tonalidad, parts, rows }
  const [error, setError] = useState(null)
  const [over, setOver] = useState(false)
  const [estilo, setEstilo] = useState('')
  const [licencia, setLicencia] = useState(LICENSES[0])
  const [playing, setPlaying] = useState(null)
  const [progress, setProgress] = useState(null) // { done, total } while publishing
  const [published, setPublished] = useState(null) // { ok: [Pieza], failed: [{ nombre, error }] }

  useEffect(() => () => audio.stop(), [])

  const load = async (file) => {
    if (!file) return
    audio.stop()
    setPlaying(null)
    setError(null)
    setPublished(null)
    setSong(null)
    if (!/\.midi?$/i.test(file.name)) return setError('Pick a .mid or .midi file. Stemma pieces are MIDI, not recorded audio.')
    if (file.size > MAX_BYTES) return setError('That file is over 1 MB. Pick a single song.')
    try {
      const out = splitMidi(new Uint8Array(await file.arrayBuffer()))
      const base = file.name.replace(/\.midi?$/i, '')
      const seen = {}
      const rows = out.candidates.map((c, i) => {
        seen[c.part] = (seen[c.part] ?? 0) + 1
        return { ...c, key: i, on: true, nombre: `${base} · ${c.part} ${String.fromCharCode(64 + seen[c.part])}`, tonalidad: c.tipo === 'ritmo' ? '' : (out.tonalidad ?? '') }
      })
      setSong({ file: file.name, tempo: out.tempo, tonalidad: out.tonalidad, parts: new Set(rows.map((r) => r.part)).size, rows })
    } catch (e) {
      setError(e.message)
    }
  }

  const edit = (key, patch) => setSong((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const chosen = song?.rows.filter((r) => r.on) ?? []

  const preview = (row) => {
    if (playing === row.key) {
      audio.stop()
      return setPlaying(null)
    }
    const instrument = audio.instrumentFor(row.tipo)
    audio.play({ events: row.notas.map((n) => ({ ...n, instrument })), bpm: song.tempo, lengthBeats: row.compases * 4, loop: false, from: 0, onEnd: () => setPlaying(null) })
    setPlaying(row.key)
  }

  const publish = async () => {
    if (!loadUser()) return setAuth('login') // publishing needs a name to credit
    const autor = loadUser().name
    audio.stop()
    setPlaying(null)
    const tags = estilo.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) // "boom bap" stays one tag
    const ok = []
    const failed = []
    setProgress({ done: 0, total: chosen.length })
    for (const r of chosen) {
      const nombre = r.nombre.trim() || `${song.file} · ${typeLabel(r.tipo)}`
      try {
        ok.push(
          await api.createPiece({
            nombre,
            tipo: r.tipo,
            autor,
            licencia,
            fuente: `Split from ${song.file} in Stemma`,
            tonalidad: r.tonalidad.trim() || null,
            tempo: song.tempo,
            estilo: tags,
            compases: r.compases,
            parent_id: null,
            notas: r.notas,
          }),
        )
        recordContribution()
      } catch (e) {
        failed.push({ nombre, error: e.message })
      }
      setProgress({ done: ok.length + failed.length, total: chosen.length })
    }
    setProgress(null)
    setPublished({ ok, failed })
    setSong(null)
  }

  return (
    <div className="site">
      <SiteBar user={user} onUser={setUser} />
      <main className="upload">
        <header className="up-head">
          <h1>Publish pieces from a MIDI song</h1>
          <p>
            Stemma finds the loops in each track (drums, bass, chords, melody). You pick which ones to publish, and they go into the shared library for anyone
            to use and fork, {autor ? (
              <>
                credited to <b>{autor}</b>.
              </>
            ) : (
              'credited to you. You can split a song now; you need to log in to publish.'
            )}
          </p>
        </header>

        {published ? (
          <section className="panel up-done" aria-live="polite">
            <h2>
              <Check size={18} aria-hidden="true" /> Published {published.ok.length} {published.ok.length === 1 ? 'piece' : 'pieces'} to the library
            </h2>
            {published.ok.length > 0 && (
              <ul>
                {published.ok.map((p) => (
                  <li key={p.id} className={`t-${p.tipo}`}>
                    <span className="code">{p.id}</span> {p.nombre} <span className="dim">· {typeLabel(p.tipo)}</span>
                  </li>
                ))}
              </ul>
            )}
            {published.failed.length > 0 && (
              <div className="auth-error" role="alert">
                {published.failed.length} could not be published:
                <ul>
                  {published.failed.map((f) => (
                    <li key={f.nombre}>
                      {f.nombre}: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="hero-cta">
              <a className="tbtn accent big" href="#/project/new">
                Use them in a new project <ArrowRight size={14} />
              </a>
              <a className="tbtn big" href={`#/u/${encodeURIComponent(autor ?? '')}`}>
                See them on your profile
              </a>
              <button className="tbtn big" onClick={() => setPublished(null)}>
                <RotateCcw size={14} /> Split another song
              </button>
            </div>
          </section>
        ) : (
          <label
            className={`panel drop ${over ? 'over' : ''} ${song ? 'compact' : ''}`}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              load(e.dataTransfer.files[0])
            }}
          >
            <FileMusic size={song ? 18 : 32} aria-hidden="true" />
            <span>
              <b>{song ? 'Split a different song' : 'Drop a MIDI song here'}</b> or click to choose a .mid file
            </span>
            <span className="fine">4/4 songs up to 1 MB. Up to 3 loops per track, 16 per song.</span>
            <input type="file" accept=".mid,.midi,audio/midi" className="visually-hidden" onChange={(e) => (load(e.target.files[0]), (e.target.value = ''))} />
          </label>
        )}

        {error && (
          <p className="auth-error up-error" role="alert">
            {error}
          </p>
        )}

        {song && (
          <section className="panel up-review">
            <div className="up-summary">
              <span>
                <b>{song.file}</b> · {song.tempo} BPM{song.tonalidad && ` · ${song.tonalidad}`} · {song.rows.length} loops in {song.parts}{' '}
                {song.parts === 1 ? 'track' : 'tracks'}
              </span>
              <label className="snap">
                Style
                <input value={estilo} onChange={(e) => setEstilo(e.target.value)} placeholder="rap, boom bap" aria-label="Style tags, comma separated" />
              </label>
              <label className="snap">
                License
                <select value={licencia} onChange={(e) => setLicencia(e.target.value)} aria-label="License">
                  {LICENSES.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
            </div>

            <ul className="up-rows">
              {song.rows.map((r) => (
                <li key={r.key} className={`t-${r.tipo} ${r.on ? '' : 'off'}`}>
                  <input type="checkbox" checked={r.on} onChange={() => edit(r.key, { on: !r.on })} aria-label={`Publish ${r.nombre}`} />
                  <button className={`tbtn square ${playing === r.key ? 'on' : ''}`} onClick={() => preview(r)} aria-label={`${playing === r.key ? 'Stop' : 'Play'} ${r.nombre}`}>
                    {playing === r.key ? <Square size={12} /> : <Play size={13} />}
                  </button>
                  <div className="up-thumb">
                    <MiniNotes notas={r.notas} beats={r.compases * 4} />
                  </div>
                  <input className="up-name" value={r.nombre} onChange={(e) => edit(r.key, { nombre: e.target.value })} aria-label="Piece name" maxLength={80} />
                  <select value={r.tipo} onChange={(e) => edit(r.key, { tipo: e.target.value })} aria-label="Type">
                    {TYPES.filter(([k]) => k).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input className="up-key" value={r.tonalidad} onChange={(e) => edit(r.key, { tonalidad: e.target.value })} aria-label="Key" placeholder="Key" maxLength={4} />
                  <span className="up-meta">
                    {r.compases} bars · bar {r.desde + 1}
                    {r.repeats > 1 && <b> · ×{r.repeats}</b>}
                  </span>
                </li>
              ))}
            </ul>

            <div className="up-foot">
              <span className="fine">
                {chosen.length} of {song.rows.length} selected · {autor ? `credited to ${autor}` : 'log in to publish'} · {licencia}
              </span>
              <button className="tbtn accent big" onClick={publish} disabled={!chosen.length || progress}>
                {progress
                  ? `Publishing ${progress.done} of ${progress.total}…`
                  : `${autor ? 'Publish' : 'Log in to publish'} ${chosen.length} ${chosen.length === 1 ? 'piece' : 'pieces'}`}
              </button>
            </div>
          </section>
        )}
      </main>
      {auth && (
        <AuthDialog
          mode={auth}
          reason="Log in to publish these pieces. They are credited to your username."
          onMode={setAuth}
          onClose={() => setAuth(null)}
          onDone={(u) => {
            setUser(u)
            setAuth(null)
            publish()
          }}
        />
      )}
    </div>
  )
}
