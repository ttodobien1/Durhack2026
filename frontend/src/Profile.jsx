import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpen, Disc3, GitFork, Globe, Link, Lock, Mail, MapPin, Music2, Pencil, Play, RotateCcw, Search, Square, Trash2, Upload, Users } from 'lucide-react'
import { api, ME } from './api.js'
import * as audio from './audio.js'
import { Arrangement, Counts, withMeta } from './projectMeta.jsx'
import { Avatar, SiteBar } from './Site.jsx'
import { ACCENTS, authorsFor, contributions, fetchProfile, isMine, loadProfile, useUser } from './profile.js'
import { renderMarkdown } from './markdown.js'
import { typeLabel } from './components/Browser.jsx'
import { ProjectMenu } from './components/ProjectMenu.jsx'
import { Reuse } from './components/Reuse.jsx'
import { usePieceReuse } from './reuse.js'
import './profile.css'
import './social.css'

/** Website as typed in settings, made safe to link: only http(s). */
export const safeUrl = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

export function Profile({ name }) {
  const [user, setUser] = useUser()
  const own = (user?.name ?? ME) === name
  // Shown at once from this browser's copy, then replaced by the backend's version (the source of truth).
  const [profile, setProfile] = useState(() => loadProfile(name))
  // "#/u/<name>?tab=projects" opens a tab directly (the My projects button in the project page uses it).
  const [tab, setTab] = useState(() => {
    const wanted = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab')
    return ['overview', 'projects', 'pieces'].includes(wanted) ? wanted : 'overview'
  })
  const [data, setData] = useState(null) // { pieces, projects, byId, usedBy } | { error }
  const [playing, setPlaying] = useState(null)

  useEffect(() => {
    let live = true
    fetchProfile(name).then((remote) => live && remote && setProfile(remote))
    return () => {
      live = false
    }
  }, [name])

  // Only this person's pieces and projects: never the whole library (hundreds of pieces with all their notes).
  useEffect(() => {
    const authors = authorsFor(name)
    let live = true
    const unique = (list) => [...new Map(list.map((x) => [x.id, x])).values()]
    // Everyone sees public projects; on your own profile your private ones are added, like GitHub.
    const ownSongs = own ? Promise.all(authors.map((a) => api.projects(a))).then((lists) => lists.flat()) : []
    const theirPieces = Promise.all(authors.map((a) => api.search({ autor: a }))).then((lists) => lists.flat().filter((p) => authors.includes(p.autor)))
    Promise.all([theirPieces, api.projects(), ownSongs]).then(
      async ([found, publicSongs, mine]) => {
        const pieces = unique(found)
        const songs = unique([...publicSongs, ...mine])
        const projects = songs.filter((s) => authors.includes(s.autor))
        const byId = Object.fromEntries(pieces.map((p) => [p.id, p]))
        // Pieces their projects use (for descriptions and thumbnails); each is fetched once per visit (api.js cache).
        const used = [...new Set(projects.flatMap((s) => s.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id))))].filter((id) => !byId[id])
        for (const p of await Promise.all(used.map((id) => api.getPiece(id).catch(() => null)))) if (p) byId[p.id] = p
        const ids = new Set(pieces.map((p) => p.id))
        if (!live) return
        setData({
          pieces,
          byId,
          projects: projects.map((s) => withMeta(s, byId)),
          usedBy: songs.filter((s) => !authors.includes(s.autor) && s.pistas.some((t) => t.bloques.some((b) => ids.has(b.pieza_id)))).length,
        })
      },
      (e) => live && setData({ error: e.message }),
    )
    return () => {
      live = false
      audio.stop()
    }
  }, [name, own])

  // Your deleted projects (only on your own profile): restorable for 20 days, then the server removes them.
  const [trash, setTrash] = useState([])
  useEffect(() => {
    if (!own || !user) return
    let live = true
    api.trash().then(
      (list) => live && setTrash(list),
      () => live && setTrash([]),
    )
    return () => {
      live = false
    }
  }, [name, own, user])

  // Projects you collaborate on (own profile only), shown under your projects.
  const [shared, setShared] = useState([])
  useEffect(() => {
    if (!own || !user) return
    let live = true
    api.shared().then(
      (list) => live && setShared(list),
      () => {},
    )
    return () => {
      live = false
    }
  }, [own, user])

  // Your pieces: switch who may use one (the server says why when it cannot, e.g. a public project uses it).
  const [pieceError, setPieceError] = useState(null)
  const setPieceVisibility = async (piece, publica) => {
    setPieceError(null)
    try {
      const stored = await api.setPieceVisibility(piece.id, publica)
      setData((d) => ({ ...d, pieces: d.pieces.map((x) => (x.id === piece.id ? { ...x, publica: stored.publica ?? publica } : x)) }))
    } catch (e) {
      setPieceError(`${piece.nombre}: ${e.message}`)
    }
  }

  const removeProject = (p) => {
    setData((d) => ({ ...d, projects: d.projects.filter((x) => x.id !== p.id) }))
    setTrash((t) => [{ ...p, borrada: new Date().toISOString(), se_borra: new Date(Date.now() + 20 * 86400e3).toISOString() }, ...t])
  }
  const restoreProject = async (id) => {
    const song = await api.restoreProject(id)
    // Its pieces may not be loaded yet (it was already in the trash when the page opened): fetch them for the card.
    const used = [...new Set(song.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))].filter((pid) => !data.byId[pid])
    const found = await Promise.all(used.map((pid) => api.getPiece(pid).catch(() => null)))
    setTrash((t) => t.filter((x) => x.id !== id))
    setData((d) => {
      const byId = { ...d.byId }
      for (const p of found) if (p) byId[p.id] = p
      return { ...d, byId, projects: [withMeta(song, byId), ...d.projects] }
    })
  }
  const purgeProject = async (id) => {
    await api.purgeProject(id)
    setTrash((t) => t.filter((x) => x.id !== id))
  }

  const preview = (p) => {
    if (playing === p.id) {
      audio.stop()
      return setPlaying(null)
    }
    const instrument = audio.instrumentFor(p.tipo)
    audio.play({ events: p.notas.map((n) => ({ ...n, instrument })), bpm: p.tempo, lengthBeats: p.compases * 4, loop: false, from: 0, onEnd: () => setPlaying(null) })
    setPlaying(p.id)
  }

  const pieces = data?.pieces ?? []
  const projects = data?.projects ?? []
  const forks = pieces.filter((p) => p.parent_id).length
  const licenses = [...new Set(pieces.map((p) => p.licencia).filter(Boolean))]
  const counts = useMemo(() => data && contributions(name, pieces.length), [data, name, pieces.length])

  return (
    <div className="site" style={{ '--accent': ACCENTS[profile.accent] ?? ACCENTS.green }}>
      <SiteBar user={user} onUser={setUser} />
      <main className="profile">
        <aside className="p-side">
          <Avatar name={name} profile={profile} className="p-avatar" />
          <h1 className="p-names">
            {profile.displayName && <span className="p-display">{profile.displayName}</span>}
            <span className="p-user">{name}</span>
          </h1>
          {profile.bio && <p className="p-bio">{profile.bio}</p>}
          {own ? (
            <a className="tbtn p-edit" href="#/settings">
              Edit profile
            </a>
          ) : (
            <a className="tbtn accent p-edit" href={`#/messages?to=${encodeURIComponent(name)}`} title={`Write to ${name} to collaborate`}>
              <Mail size={14} aria-hidden="true" /> Message
            </a>
          )}
          {data && !data.error && (
            <ul className="p-facts">
              <li>
                <Music2 size={15} aria-hidden="true" /> <b>{pieces.length}</b> {pieces.length === 1 ? 'piece' : 'pieces'} · <b>{forks}</b> {forks === 1 ? 'fork' : 'forks'}
              </li>
              <li>
                <GitFork size={15} aria-hidden="true" /> Used in <b>{data.usedBy}</b> {data.usedBy === 1 ? 'song' : 'songs'} by others
              </li>
              {profile.location && (
                <li>
                  <MapPin size={15} aria-hidden="true" /> {profile.location}
                </li>
              )}
              {profile.website && (
                <li>
                  <Link size={15} aria-hidden="true" />{' '}
                  <a href={safeUrl(profile.website)} target="_blank" rel="noopener noreferrer">
                    {profile.website.replace(/^https?:\/\//i, '')}
                  </a>
                </li>
              )}
            </ul>
          )}
          {licenses.length > 0 && (
            <div className="p-licenses">
              <h2>Licenses</h2>
              {licenses.map((l) => (
                <span key={l} className="tag">
                  {l}
                </span>
              ))}
            </div>
          )}
        </aside>

        <section className="p-main">
          <nav className="p-tabs" role="tablist" aria-label="Profile sections">
            {[
              ['overview', 'Overview', BookOpen],
              ['projects', 'Projects', Disc3, projects.length],
              ['pieces', 'Pieces', Music2, pieces.length],
            ].map(([id, label, Icon, n]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                <Icon size={15} aria-hidden="true" /> {label}
                {n != null && data && <span className="count">{n}</span>}
              </button>
            ))}
          </nav>

          {data?.error && <p className="p-empty">Could not load {name}’s projects and pieces: {data.error}</p>}
          {!data && tab !== 'overview' && <p className="p-empty">Loading…</p>}

          {/* The README does not wait for projects and pieces: it is ready as soon as the profile is. */}
          {tab === 'overview' && (
            <>
              {profile.readme ? (
                <article className="panel readme">
                  <h2 className="readme-head">
                    <span>
                      {name} <span className="dim">/</span> README<span className="dim">.md</span>
                    </span>
                    {own && (
                      <a className="icon small" href="#/settings" aria-label="Edit README" title="Edit README">
                        <Pencil size={13} />
                      </a>
                    )}
                  </h2>
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(profile.readme) }} />
                </article>
              ) : (
                own && (
                  <div className="readme-add">
                    <p>
                      <strong>Add a README to your profile.</strong> Say what you make, which styles you work in and what others may reuse.
                    </p>
                    <a className="tbtn" href="#/settings#readme">
                      Add README
                    </a>
                  </div>
                )
              )}
              {data && !data.error && (
                <>
                  <Pinned profile={profile} projects={projects} pieces={pieces} data={data} />
                  <Heatmap counts={counts} />
                </>
              )}
              {!data && <p className="p-empty">Loading projects and pieces…</p>}
            </>
          )}

          {data && !data.error && tab === 'projects' && (
            <ProjectList
              projects={projects}
              byId={data.byId}
              name={name}
              own={own}
              onUpdate={(id, patch) => setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))}
              onDelete={removeProject}
            />
          )}
          {data && !data.error && tab === 'projects' && own && user && shared.length > 0 && <SharedList projects={shared} />}
          {data && !data.error && tab === 'projects' && own && user && trash.length > 0 && <Trash items={trash} onRestore={restoreProject} onPurge={purgeProject} />}
          {data && !data.error && tab === 'pieces' && (
            <PieceList pieces={pieces} playing={playing} onPreview={preview} name={name} own={own} onVisibility={setPieceVisibility} error={pieceError} />
          )}
        </section>
      </main>
    </div>
  )
}

const dominantType = (song, byId) => {
  const count = {}
  for (const t of song.pistas) for (const b of t.bloques) if (byId[b.pieza_id]) count[byId[b.pieza_id].tipo] = (count[byId[b.pieza_id].tipo] ?? 0) + 1
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0]
}
const Visibility = ({ song }) =>
  song.publica === false ? (
    <span className="public private" title="Only listed for you">
      <Lock size={10} aria-hidden="true" /> Private
    </span>
  ) : (
    <span className="public">Public</span>
  )
const pieceCount = (song) => new Set(song.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id))).size

/** Pinned projects, or like GitHub's "Popular" fallback: biggest projects, else most-forked pieces. */
function Pinned({ profile, projects, pieces, data }) {
  const pinned = profile.pinned.map((id) => projects.find((p) => p.id === id)).filter(Boolean)
  const cards = pinned.length ? pinned : [...projects].sort((a, b) => pieceCount(b) - pieceCount(a)).slice(0, 6)
  const popularPieces = cards.length ? [] : pieces.slice(0, 6)
  if (!cards.length && !popularPieces.length) return null
  return (
    <section className="pinned">
      <h2>{pinned.length ? 'Pinned' : cards.length ? 'Popular projects' : 'Pieces'}</h2>
      <ul>
        {cards.map((p) => (
          <li key={p.id} className="pin-card">
            <div className="pin-top">
              <Disc3 size={15} aria-hidden="true" />
              <a href={`#/project/${p.id}`}>{p.nombre}</a>
              <Visibility song={p} />
            </div>
            <p>{p.descripcion}</p>
            <div className={`pin-meta t-${dominantType(p, data.byId)}`}>
              <i className="dot" aria-hidden="true" /> {p.tempo} BPM · {pieceCount(p)} pieces
            </div>
          </li>
        ))}
        {popularPieces.map((p) => (
          <li key={p.id} className="pin-card">
            <div className="pin-top">
              <Music2 size={15} aria-hidden="true" />
              <span className="pin-name">{p.nombre}</span>
              <span className="public">{p.id}</span>
            </div>
            <p>
              {typeLabel(p.tipo)}
              {p.tonalidad && ` in ${p.tonalidad}`}, {p.compases} {p.compases === 1 ? 'bar' : 'bars'}. {p.fuente}
            </p>
            <div className={`pin-meta t-${p.tipo}`}>
              <i className="dot" aria-hidden="true" /> {p.licencia}
              {p.parent_id && (
                <span>
                  <GitFork size={13} aria-hidden="true" /> fork of {p.parent_id}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longDate = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' })

/** GitHub-style contribution graph: one column per week, Sunday on top. */
export function Heatmap({ counts }) {
  if (!counts) return null
  const days = Object.entries(counts)
  const total = days.reduce((s, [, n]) => s + n, 0)
  const max = Math.max(1, ...days.map(([, n]) => n))
  const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)))
  // A month label sits over the first week whose Sunday falls in that month; drop the first if the next is too close.
  const months = []
  for (let w = 0; w < 52; w++) {
    const m = new Date(`${days[w * 7][0]}T12:00`).getMonth()
    if (months.at(-1)?.[1] !== m) months.push([w, m])
  }
  if (months[1] && months[1][0] - months[0][0] < 3) months.shift()
  return (
    <section className="contrib">
      <h2>
        {total} {total === 1 ? 'contribution' : 'contributions'} in the last year
      </h2>
      <div className="panel contrib-box">
        <div className="hm-scroll" ref={(el) => el && (el.scrollLeft = el.scrollWidth)}>{/* open on the latest weeks, like GitHub */}
          <div className="hm" role="img" aria-label={`${total} contributions in the last year`}>
            {['Mon', 'Wed', 'Fri'].map((d, i) => (
              <span key={d} className="hm-day" style={{ gridRow: 3 + i * 2 }}>
                {d}
              </span>
            ))}
            {months.map(([w, m]) => (
              <span key={`m${w}`} className="hm-month" style={{ gridColumn: w + 2 }}>
                {MONTHS[m]}
              </span>
            ))}
            {days.map(([iso, n], i) => {
              const date = new Date(`${iso}T12:00`)
              return (
                <i
                  key={iso}
                  className={`l${level(n)}`}
                  style={{ gridColumn: Math.floor(i / 7) + 2, gridRow: date.getDay() + 2 }}
                  title={`${n || 'No'} ${n === 1 ? 'contribution' : 'contributions'} on ${longDate.format(date)}`}
                />
              )
            })}
          </div>
        </div>
        <div className="hm-foot">
          <span>Forks, saved pieces and saved projects</span>
          <span className="hm-legend" aria-hidden="true">
            Less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`l${l}`} />)} More
          </span>
        </div>
      </div>
    </section>
  )
}

function ProjectList({ projects, byId, name, own, onUpdate, onDelete }) {
  const [q, setQ] = useState('')
  const text = q.trim().toLowerCase()
  const shown = projects.filter((p) => !text || `${p.nombre} ${p.descripcion} ${p.etiquetas.join(' ')}`.toLowerCase().includes(text))
  if (!projects.length) return <p className="p-empty">{own ? <>You have no projects yet. <a href="#/project/new">Start one</a>.</> : `${name} has no public projects yet.`}</p>
  return (
    <>
      <label className="search p-find">
        <Search size={14} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a project…" aria-label="Find a project" />
      </label>
      <ul className="projects p-list">
        {shown.length === 0 && <li className="p-empty">No projects match “{q}”.</li>}
        {shown.map((p) => (
          <li key={p.id} className="proj">
            <div className="proj-main">
              <div className="proj-name">
                <a href={`#/project/${p.id}`}>{p.nombre}</a> <Visibility song={p} />
              </div>
              <p>{p.descripcion}</p>
              <div className="proj-tags">
                {p.etiquetas.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              <div className={`proj-meta pin-meta t-${dominantType(p, byId)}`}>
                <i className="dot" aria-hidden="true" /> {p.tempo} BPM · {pieceCount(p)} pieces
                <Counts p={p} />
              </div>
            </div>
            <div className="proj-side">
              <Arrangement song={p} pieces={byId} />
              <div className="proj-actions">
                <a className="tbtn" href={`#/project/${p.id}`}>
                  Open <ArrowRight size={13} />
                </a>
                {/* Options (Privacy / Tree / History / Delete) only for your own projects */}
                {own && (
                  <ProjectMenu
                    project={p}
                    onChange={(patch) => onUpdate(p.id, patch)}
                    onTree={() => (location.hash = `#/project/${p.id}?history=tree`)}
                    onHistory={() => (location.hash = `#/project/${p.id}?history=versions`)}
                    onDelete={() => onDelete(p)}
                  />
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Projects you collaborate on (you joined with an invitation link). */
function SharedList({ projects }) {
  return (
    <section className="trash">
      <h2>
        <Users size={15} aria-hidden="true" /> Shared with you <span className="count">{projects.length}</span>
      </h2>
      <p className="trash-note">Projects you joined as a collaborator: you open and edit them with their author.</p>
      <ul className="p-list">
        {projects.map((p) => (
          <li key={p.id} className="trash-row">
            <div className="trash-main">
              <a className="shared-name" href={`#/project/${p.id}`}>
                <span className="dim">{p.autor} /</span> {p.nombre}
              </a>{' '}
              <Visibility song={p} />
              <div className="trash-meta">
                {p.tempo} BPM · {pieceCount(p)} pieces · v{p.version}
              </div>
            </div>
            <div className="trash-actions">
              <a className="tbtn" href={`#/project/${p.id}`}>
                Open <ArrowRight size={13} />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const daysLeft = (iso) => {
  const days = Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 86400e3))
  return days === 0 ? 'today' : `in ${days} ${days === 1 ? 'day' : 'days'}`
}

/** Your deleted projects: restore one, or delete it forever right away (after an "are you sure?" step). */
function Trash({ items, onRestore, onPurge }) {
  const [asking, setAsking] = useState(null) // id of the project waiting for "Delete forever?"
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const run = async (id, action) => {
    setBusy(id)
    setError(null)
    try {
      await action(id)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(null)
      setAsking(null)
    }
  }
  return (
    <section className="trash">
      <h2>
        <Trash2 size={15} aria-hidden="true" /> Trash <span className="count">{items.length}</span>
      </h2>
      <p className="trash-note">Deleted projects stay here for 20 days, then they are deleted forever.</p>
      <ul className="p-list">
        {items.map((p) => (
          <li key={p.id} className="trash-row">
            <div className="trash-main">
              <span className="trash-name">{p.nombre}</span> <Visibility song={p} />
              <div className="trash-meta">
                Deleted {shortDate.format(new Date(p.borrada))} · deleted forever {daysLeft(p.se_borra)}
              </div>
            </div>
            <div className="trash-actions">
              {asking === p.id ? (
                <>
                  <span className="trash-ask">Delete forever? This cannot be undone.</span>
                  <button className="tbtn" onClick={() => setAsking(null)} disabled={busy === p.id} autoFocus>
                    Cancel
                  </button>
                  <button className="tbtn danger" onClick={() => run(p.id, onPurge)} disabled={busy === p.id}>
                    <Trash2 size={13} aria-hidden="true" /> {busy === p.id ? 'Deleting…' : 'Delete forever'}
                  </button>
                </>
              ) : (
                <>
                  <button className="tbtn" onClick={() => run(p.id, onRestore)} disabled={busy === p.id}>
                    <RotateCcw size={13} aria-hidden="true" /> {busy === p.id ? 'Restoring…' : 'Restore'}
                  </button>
                  <button className="tbtn" onClick={() => setAsking(p.id)} disabled={busy === p.id} aria-label={`Delete ${p.nombre} forever`}>
                    <Trash2 size={13} aria-hidden="true" /> Delete forever
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

// own: your profile, where each piece of yours has its Public / Private switch (onVisibility(piece, publica)).
function PieceList({ pieces, playing, onPreview, name, own, onVisibility, error }) {
  const reuse = usePieceReuse(pieces.map((p) => p.id))
  const upload = own && (
    <>
      <a className="tbtn p-upload" href="#/upload">
        <Upload size={13} aria-hidden="true" /> Publish pieces from a MIDI song
      </a>
      <p className="fine p-pieces-note">Public pieces can be found, played and forked by anyone (credited to you). Private ones only open for you and the people of your projects that use them.</p>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
  if (!pieces.length)
    return (
      <>
        <p className="p-empty">{own ? 'You have no pieces yet. Fork one in a project, or split a MIDI song into pieces.' : `${name} has not published any pieces yet.`}</p>
        {upload}
      </>
    )
  return (
    <>
    {upload}
    <ul className="p-list p-pieces">
      {pieces.map((p) => (
        <li key={p.id} className={`t-${p.tipo}`}>
          <button className={`tbtn square ${playing === p.id ? 'on' : ''}`} onClick={() => onPreview(p)} aria-label={`${playing === p.id ? 'Stop' : 'Preview'} ${p.nombre}`}>
            {playing === p.id ? <Square size={12} /> : <Play size={13} />}
          </button>
          <div>
            <div className="pc-name">
              <i className="dot" aria-hidden="true" /> {p.nombre} <span className="code">{p.id}</span>
            </div>
            <div className="pc-meta">
              {[typeLabel(p.tipo), p.tonalidad, `${p.tempo} BPM`, `${p.compases} ${p.compases === 1 ? 'bar' : 'bars'}`, p.licencia].filter(Boolean).join(' · ')}
              {p.parent_id && (
                <>
                  {' '}
                  · <GitFork size={12} aria-hidden="true" /> forked from <span className="code">{p.parent_id}</span>
                </>
              )}
              <Reuse kind="pieza" id={p.id} count={reuse[p.id]?.total} label />
            </div>
          </div>
          {own && isMine(p.autor) && (
            <button
              className={`vis pc-vis ${p.publica === false ? 'private' : ''}`}
              onClick={() => onVisibility(p, p.publica === false)}
              aria-label={`${p.nombre} is ${p.publica === false ? 'private' : 'public'}. Click to make it ${p.publica === false ? 'public' : 'private'}`}
              title={p.publica === false ? 'Private. Click to make it public.' : 'Public. Click to make it private.'}
            >
              {p.publica === false ? <Lock size={11} aria-hidden="true" /> : <Globe size={11} aria-hidden="true" />}
              {p.publica === false ? 'Private' : 'Public'}
            </button>
          )}
        </li>
      ))}
    </ul>
    </>
  )
}
