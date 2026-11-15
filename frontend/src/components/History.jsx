// Project history window: the GitHub-style tabs of a project.
//   Tree      every version as a row of its pieces, linked where a piece changed, plus their library origins (VersionTree)
//   Changes   what a version changed: tracks, and note by note for every piece (green new, red deleted, yellow moved)
//   Versions  v1, v2... one per save, like commits; any of them can be compared or opened in the editor
//   Merge     bring in the changes of a fork (or of the original), resolving conflicts
//   Proposals changes people offered to this project, like pull requests: review, merge or decline (cambios.md §14)
//   Credits   who wrote each note of the song, forks included
// Backend routes: cambios.md §9. The Tree tab also works offline; the others need the server.
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CircleCheck, CircleX, GitBranch, GitCommitHorizontal, GitCompare, GitFork, GitMerge, GitPullRequestArrow, History as HistoryIcon, RotateCcw, TriangleAlert, Users, X } from 'lucide-react'
import { api } from '../api.js'
import { isMine } from '../profile.js'
import { Avatar } from '../Site.jsx'
import { typeLabel } from './Browser.jsx'
import { LANE_NAMES } from '../lanes.js'
import { MiniRoll } from './MiniRoll.jsx'
import { diffRoll } from '../rolls.js'
import { VersionTree } from './VersionTree.jsx'
import './history.css'

const who = (autor) => (isMine(autor) ? 'you' : autor)
const laneName = (instrumento) => LANE_NAMES[instrumento] ?? instrumento
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const short = (text, max = 48) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function timeAgo(iso) {
  const s = (new Date(iso) - Date.now()) / 1000
  if (Math.abs(s) < 60) return 'just now'
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}
const dayOf = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

// One color per author in a view; you are always orange.
const PALETTE = ['#72a6d2', '#a98bd6', '#6cbca1', '#d2766e', '#e0c35a', '#5fc4d8', '#d68bb8', '#9fbf5a']
function colorMap(autores) {
  const map = new Map()
  let k = 0
  for (const a of autores) if (!map.has(a)) map.set(a, isMine(a) ? 'var(--orange)' : PALETTE[k++ % PALETTE.length])
  return map
}

/** Runs `load` whenever `key` changes. Keeps the previous data while the next one loads. */
function useLoad(load, key) {
  const [state, setState] = useState({ key: null })
  useEffect(() => {
    let live = true
    load().then(
      (data) => live && setState({ key, data }),
      (e) => live && setState({ key, error: e.message || String(e) }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state : { loading: true, data: state.data }
}

const Loading = () => <p className="hist-empty">Loading…</p>
const Failed = ({ error }) => (
  <p className="hist-empty error-text" role="alert">
    {error}
  </p>
)

/**
 * Props: song (current project), tab + onTab, onClose, dirty (unsaved edits), canEdit (the signed-in user may save
 * this project), onOpenVersion(numero), onMerged({ cancion, version }).
 * For the Tree tab: loadPiece, pieces (editor cache), drafts ({ id: { notas, compases } } unsaved piano roll edits),
 * playing + onPreview(piece) to listen, onRestorePiece(info, { edit }) to bring a piece back or keep working on it.
 * For the Proposals tab: openProposals (count shown on the tab), onProposalClosed() after one is declined or withdrawn.
 */
export function History({ song, tab, onTab, onClose, loadPiece, dirty, canEdit, onOpenVersion, onMerged, pieces, drafts, playing, onPreview, onRestorePiece, openProposals = 0, onProposalClosed }) {
  const saved = Boolean(song.id) && song.id !== 'c-new'
  const hist = useLoad(() => (saved ? api.versions(song.id) : Promise.resolve(null)), `${song.id}:${song.version ?? 0}`)
  const [compare, setCompare] = useState(null) // { hasta, contra } chosen in the Changes tab

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const data = hist.data
  const versions = data?.versiones ?? []
  const offline = saved && !hist.loading && !hist.error && !data // backend unreachable: mock mode
  const showChanges = (hasta, contra = '') => {
    setCompare({ hasta, contra })
    onTab('changes')
  }

  const tabs = [
    ['tree', 'Tree', GitBranch, null, 'Every version with its pieces, and where each piece comes from'],
    ['changes', 'Changes', GitCompare, null, 'What a version changed, track by track and note by note'],
    ['versions', 'Versions', HistoryIcon, versions.length || null, 'Every saved version, like commits'],
    ['merge', 'Merge', GitMerge, null, 'Bring in the changes of a fork or of the original'],
    ['proposals', 'Proposals', GitPullRequestArrow, openProposals || null, 'Changes people offered to this project, like pull requests'],
    ['credits', 'Credits', Users, null, 'Who wrote each note of the song'],
  ]

  let body
  if (tab === 'tree')
    body = (
      <VersionTree
        song={song}
        saved={saved && !offline}
        loadPiece={loadPiece}
        pieces={pieces}
        drafts={drafts}
        playing={playing}
        onPreview={onPreview}
        onRestore={onRestorePiece}
        onShowChanges={(n) => showChanges(n)}
      />
    )
  else if (!saved)
    body = (
      <p className="hist-empty">
        Save this project to start its history. Every save becomes a version (v1, v2…) that you can compare with the others, and when
        someone saves their own copy of it you can merge their changes back.
      </p>
    )
  else if (offline) body = <p className="hist-empty">The history needs the Stemma server, and the app is running on local demo data right now.</p>
  else if (hist.error) body = <Failed error={hist.error} />
  else if (!data) body = <Loading />
  else if (tab === 'changes')
    body = <ChangesTab song={song} versions={versions} origen={data.origen} compare={compare} onCompare={setCompare} />
  else if (tab === 'versions')
    body = <VersionsTab versions={versions} origen={data.origen} onShowChanges={showChanges} onOpen={onOpenVersion} />
  else if (tab === 'merge') body = <MergeTab song={song} canEdit={canEdit} dirty={dirty} onMerged={onMerged} />
  else if (tab === 'proposals') body = <ProposalsTab song={song} canEdit={canEdit} dirty={dirty} onMerged={onMerged} onClosed={onProposalClosed} />
  else body = <CreditsTab song={song} />

  return (
    <div className="window-backdrop" onClick={onClose}>
      <section className="panel window history" role="dialog" aria-modal="true" aria-label="Project history" onClick={(e) => e.stopPropagation()}>
        <h2 className="title roll-title">
          <span>
            Project history <span className="dim">· {song.nombre}</span>
          </span>
          <button className="icon small" onClick={onClose} aria-label="Close project history">
            <X size={13} />
          </button>
        </h2>
        <div className="hist-head">
          <div className="hist-repo">
            <GitBranch size={15} aria-hidden="true" />
            <a href={`#/u/${encodeURIComponent(song.autor)}`}>{song.autor}</a>
            <span className="dim">/</span>
            <b>{song.nombre}</b>
            <span className={`vis-tag ${song.publica === false ? 'private' : ''}`}>{song.publica === false ? 'Private' : 'Public'}</span>
            {saved && song.version > 0 && <span className="ver-tag" title="Latest saved version">v{song.version}</span>}
          </div>
          {data?.origen && (
            <div className="hist-forked">
              <GitFork size={12} aria-hidden="true" /> forked from{' '}
              <a href={`#/project/${data.origen.id}`}>
                {who(data.origen.autor)} / {data.origen.nombre}
              </a>{' '}
              at v{data.origen.version}
            </div>
          )}
          {saved && dirty && <div className="hist-dirty">You have unsaved changes: save to make them v{(song.version || 0) + 1}.</div>}
        </div>
        <nav className="hist-tabs" role="tablist" aria-label="Project history sections">
          {tabs.map(([key, label, Icon, count, hint]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => onTab(key)} title={hint}>
              <Icon size={14} aria-hidden="true" /> {label}
              {count != null && <span className="hist-count">{count}</span>}
            </button>
          ))}
        </nav>
        <div className={`hist-body ${tab === 'tree' ? 'flush' : ''}`} role="tabpanel">
          {body}
        </div>
      </section>
    </div>
  )
}

// --- Changes ----------------------------------------------------------------------------------------

function ChangesTab({ song, versions, origen, compare, onCompare }) {
  const hasta = compare?.hasta ?? versions[0]?.numero
  const contra = compare?.contra ?? ''
  const diff = useLoad(() => api.versionDiff(song.id, hasta, contra || undefined), `${song.id}:${song.version}:${hasta}:${contra}`)
  const label = (v) => `v${v.numero} · ${short(v.mensaje)}`
  const previous =
    hasta > 1 ? `v${hasta - 1} (the version before)` : origen ? `${who(origen.autor)} / ${origen.nombre} v${origen.version} (forked from)` : 'nothing (first version)'
  return (
    <div className="hist-pane">
      <div className="compare-bar">
        <GitCompare size={14} aria-hidden="true" />
        <label>
          base
          <select value={contra} onChange={(e) => onCompare({ hasta, contra: e.target.value ? +e.target.value : '' })}>
            <option value="">{previous}</option>
            {versions
              .filter((v) => v.numero < hasta - 1)
              .map((v) => (
                <option key={v.numero} value={v.numero}>
                  {label(v)}
                </option>
              ))}
          </select>
        </label>
        <ArrowRight size={14} aria-hidden="true" />
        <label>
          compare
          <select value={hasta} onChange={(e) => onCompare({ hasta: +e.target.value, contra: '' })}>
            {versions.map((v) => (
              <option key={v.numero} value={v.numero}>
                {label(v)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {diff.error ? (
        <Failed error={diff.error} />
      ) : !diff.data ? (
        <Loading />
      ) : (
        <div className={diff.loading ? 'stale' : ''}>
          <VersionLine diff={diff.data} />
          <DiffView diff={diff.data} />
        </div>
      )}
    </div>
  )
}

function VersionLine({ diff }) {
  const v = diff.hasta
  return (
    <p className="version-line">
      <Avatar name={v.autor} size={18} /> <b>{who(v.autor)}</b> saved <span className="ver-tag">v{v.numero}</span> {timeAgo(v.fecha)}: “{v.mensaje}”
      {diff.desde && (
        <span className="dim">
          {' '}
          · compared with {diff.desde.cancion_id === v.cancion_id ? '' : `${diff.desde.cancion_id} `}v{diff.desde.numero}
        </span>
      )}
    </p>
  )
}

function Stats({ r }) {
  return (
    <span className="note-stats" title="Notes added, deleted and moved">
      <span className="add">+{r.notas_nuevas}</span> <span className="del">−{r.notas_borradas}</span> <span className="mov">~{r.notas_movidas}</span>
    </span>
  )
}

const bars = (list) => list.map((b) => b.compas + 1).join(', ')
function BlockList({ list, sign }) {
  const byPiece = new Map()
  for (const b of list) byPiece.set(b.pieza_id, [...(byPiece.get(b.pieza_id) ?? []), b])
  return [...byPiece].map(([id, blocks]) => (
    <span key={sign + id} className={sign === '+' ? 'add' : 'del'}>
      {sign} <span className="code">{id}</span> at {blocks.length === 1 ? 'bar' : 'bars'} {bars(blocks)}
    </span>
  ))
}

/** A song diff (GET /canciones/:id/versiones/:n/diff, or the changes of a merge). */
export function DiffView({ diff, empty = 'No musical changes.' }) {
  const r = diff.resumen
  if (r.vacio)
    return (
      <p className="hist-empty">
        <Check size={14} aria-hidden="true" /> {empty}
      </p>
    )
  const chips = [
    r.pistas_nuevas > 0 && ['add', `+${plural(r.pistas_nuevas, 'track')}`],
    r.pistas_borradas > 0 && ['del', `−${plural(r.pistas_borradas, 'track')}`],
    r.pistas_cambiadas > 0 && ['mov', `${plural(r.pistas_cambiadas, 'track')} changed`],
    r.piezas_agregadas > 0 && ['add', `${plural(r.piezas_agregadas, 'piece')} added`],
    r.piezas_editadas > 0 && ['mov', `${plural(r.piezas_editadas, 'piece')} edited`],
    r.piezas_quitadas > 0 && ['del', `${plural(r.piezas_quitadas, 'piece')} removed`],
    diff.tempo && ['', `Tempo ${diff.tempo.antes} → ${diff.tempo.despues} BPM`],
    diff.nombre && ['', `Renamed “${diff.nombre.antes}” → “${diff.nombre.despues}”`],
  ].filter(Boolean)
  return (
    <>
      <div className="diff-stats">
        {chips.map(([cls, text]) => (
          <span key={text} className={`chip ${cls}`}>
            {text}
          </span>
        ))}
        <span className="chip">
          <Stats r={r} /> notes
        </span>
      </div>
      {diff.pistas.length > 0 && (
        <section className="diff-block">
          <h3>
            Tracks <span className="dim">{diff.pistas.length} changed</span>
          </h3>
          <ul className="diff-tracks">
            {diff.pistas.map((p, i) => (
              <li key={i} className={`st-${p.estado}`}>
                <span className="mark" aria-label={p.estado}>
                  {p.estado === 'nueva' ? '+' : p.estado === 'borrada' ? '−' : '~'}
                </span>
                <b>{laneName(p.instrumento)}</b>
                <span className="dim">
                  {p.estado === 'nueva' ? 'new track' : p.estado === 'borrada' ? 'deleted track' : `track ${p.posicion + 1}`}
                  {p.instrumento_antes && ` · was ${laneName(p.instrumento_antes)}`}
                </span>
                <span className="blocks">
                  <BlockList list={p.nuevos} sign="+" />
                  <BlockList list={p.borrados} sign="−" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.piezas.length > 0 && (
        <section className="diff-block">
          <h3>
            Pieces <span className="dim">{diff.piezas.length} changed</span>
          </h3>
          {diff.piezas.map((p) => (
            <PieceDiff key={`${p.estado}-${p.id}`} change={p} />
          ))}
        </section>
      )}
    </>
  )
}

const PIECE_STATE = { editada: ['Edited', 'mov'], reemplazada: ['Fork', 'mov'], agregada: ['Added', 'add'], quitada: ['Removed', 'del'] }

function PieceDiff({ change }) {
  const { nuevas, borradas, movidas } = change.notas
  const notes = diffRoll(change.notas)
  const beats = Math.max(change.compases, change.compases_antes ?? 0, change.reemplaza?.compases ?? 0) * 4
  const [label, cls] = PIECE_STATE[change.estado]
  return (
    <article className={`piece-card t-${change.tipo}`}>
      <header>
        <span className={`state ${cls}`}>{label}</span>
        <span className="code">{change.id}</span>
        <b className="piece-card-name">{change.nombre}</b>
        <span className="dim">
          {typeLabel(change.tipo)} · by <span className={isMine(change.autor) ? 'mine-text' : ''}>{who(change.autor)}</span>
          {change.reemplaza && (
            <>
              {' '}
              · replaces <span className="code">{change.reemplaza.id}</span> by {who(change.reemplaza.autor)}
            </>
          )}
          {change.compases_antes && ` · ${change.compases_antes} → ${change.compases} bars`}
        </span>
        <span className="counts">
          <span className="add">+{nuevas.length}</span> <span className="del">−{borradas.length}</span> <span className="mov">~{movidas.length}</span>
        </span>
      </header>
      <MiniRoll notes={notes} beats={beats} />
    </article>
  )
}

// --- Versions ---------------------------------------------------------------------------------------

function VersionsTab({ versions, origen, onShowChanges, onOpen }) {
  const groups = []
  for (const v of versions) {
    const day = dayOf(v.fecha)
    if (groups.at(-1)?.day === day) groups.at(-1).items.push(v)
    else groups.push({ day, items: [v] })
  }
  const latest = versions[0]?.numero
  return (
    <div className="hist-pane">
      {groups.map((g) => (
        <section key={g.day} className="commit-day">
          <h3>
            <GitCommitHorizontal size={14} aria-hidden="true" /> Versions on {g.day}
          </h3>
          <ul className="commits">
            {g.items.map((v) => (
              <li key={v.numero} className={v.merge ? 'merge' : ''}>
                <div className="commit-main">
                  <b className="commit-msg">
                    {v.merge && <GitMerge size={13} aria-label="Merge" />} {v.mensaje}
                  </b>
                  <span className="commit-meta">
                    <Avatar name={v.autor} size={16} /> <b>{who(v.autor)}</b> saved {timeAgo(v.fecha)}
                    {v.merge && (
                      <>
                        {' '}
                        · merged <a href={`#/project/${v.merge.cancion_id}`}>{v.merge.cancion_id}</a> v{v.merge.numero}
                      </>
                    )}
                  </span>
                  {v.piezas.length > 0 && (
                    <span className="commit-pieces">
                      {v.piezas.slice(0, 4).map((p) => (
                        <span key={`${p.estado}-${p.id}`} className={`piece-chip t-${p.tipo}`} title={`${PIECE_STATE[p.estado][0]}: ${p.nombre} by ${who(p.autor)}`}>
                          {PIECE_STATE[p.estado][0]} {short(p.nombre, 28)} <span className="dim">· {who(p.autor)}</span>
                        </span>
                      ))}
                      {v.piezas.length > 4 && <span className="dim">+{v.piezas.length - 4} more</span>}
                    </span>
                  )}
                </div>
                <Stats r={v.resumen} />
                <span className="ver-tag">v{v.numero}</span>
                <div className="commit-actions">
                  <button className="tbtn" onClick={() => onShowChanges(v.numero)} title="See what this version changed">
                    <GitCompare size={13} aria-hidden="true" /> Changes
                  </button>
                  {v.numero !== latest && (
                    <button className="tbtn" onClick={() => onOpen(v.numero)} title="Load this version in the editor as unsaved changes">
                      <RotateCcw size={13} aria-hidden="true" /> Open
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {origen && (
        <p className="commit-origin">
          <GitFork size={14} aria-hidden="true" /> Forked from{' '}
          <a href={`#/project/${origen.id}`}>
            {who(origen.autor)} / {origen.nombre}
          </a>{' '}
          at v{origen.version}
        </p>
      )}
    </div>
  )
}

// --- Merge ------------------------------------------------------------------------------------------

function MergeTab({ song, canEdit, dirty, onMerged }) {
  const rel = useLoad(() => api.related(song.id), `${song.id}:${song.version}`)
  const [other, setOther] = useState(null)
  if (other) return <MergePreview song={song} other={other} canEdit={canEdit} dirty={dirty} onBack={() => setOther(null)} onMerged={onMerged} />
  if (rel.error) return <Failed error={rel.error} />
  if (!rel.data) return <Loading />
  const { parent, forks } = rel.data
  return (
    <div className="hist-pane">
      <p className="hist-intro">
        Bring the changes of a related project into this one. Stemma compares both with the version they last had in common, applies what
        only one of you changed, and asks you about the spots you both changed.
      </p>
      {parent && (
        <>
          <h3 className="hist-h">Original project</h3>
          <RelatedRow item={parent} isParent onPick={setOther} />
        </>
      )}
      <h3 className="hist-h">
        Forks of this project <span className="hist-count">{forks.length}</span>
      </h3>
      {forks.length ? (
        forks.map((f) => <RelatedRow key={f.id} item={f} onPick={setOther} />)
      ) : (
        <p className="hist-empty">No forks yet. When someone opens this project and saves their own copy, it shows up here and you can merge their changes back.</p>
      )}
    </div>
  )
}

function RelatedRow({ item, isParent, onPick }) {
  return (
    <div className="related">
      {isParent ? <GitBranch size={16} aria-hidden="true" /> : <GitFork size={16} aria-hidden="true" />}
      <div className="related-main">
        <a href={`#/project/${item.id}`}>
          <b>
            {who(item.autor)} / {item.nombre}
          </b>
        </a>
        <span className="dim">
          <span className="code">{item.id}</span> · v{item.version} · updated {timeAgo(item.actualizado)}
          {!isParent && item.parent_version && ` · forked at v${item.parent_version}`}
          {item.publica === false && ' · private'}
        </span>
      </div>
      <button className="tbtn accent" onClick={() => onPick(item)}>
        <GitMerge size={13} aria-hidden="true" /> {isParent ? 'Pull changes' : 'Review and merge'}
      </button>
    </div>
  )
}

// --- Proposals (pull requests) -------------------------------------------------------------------------

const PROPOSAL_STATE = { abierta: ['Open', GitPullRequestArrow], aceptada: ['Merged', CircleCheck], rechazada: ['Declined', CircleX], retirada: ['Withdrawn', CircleX] }

function ProposalsTab({ song, canEdit, dirty, onMerged, onClosed }) {
  const [reload, setReload] = useState(0)
  const list = useLoad(() => api.proposals(song.id), `${song.id}:${song.version}:${reload}`)
  const [review, setReview] = useState(null)
  const [error, setError] = useState(null)
  const close = async (p, estado) => {
    setError(null)
    try {
      await api.closeProposal(song.id, p.id, estado)
      onClosed?.()
      setReview(null)
      setReload((n) => n + 1)
    } catch (e) {
      setError(e.message)
    }
  }
  if (review)
    return (
      <MergePreview
        song={song}
        other={{ id: review.desde.id, nombre: review.desde.nombre, autor: review.autor, version: review.desde.version }}
        canEdit={canEdit}
        dirty={dirty}
        onBack={() => setReview(null)}
        onMerged={onMerged}
        backLabel="All proposals"
        heading={review.titulo}
        note={review.mensaje}
        extra={
          canEdit && (
            <button className="tbtn big" onClick={() => close(review, 'rechazada')}>
              <CircleX size={14} aria-hidden="true" /> Decline
            </button>
          )
        }
      />
    )
  if (list.error) return <Failed error={list.error} />
  if (list.data === null && !list.loading) return <p className="hist-empty">Proposals need the Stemma server, and the app is running on local demo data right now.</p>
  if (!list.data) return <Loading />
  return (
    <div className="hist-pane">
      <p className="hist-intro">
        Changes other artists offered to this project, like pull requests on GitHub. {canEdit ? 'Review each one note by note, then merge it or decline it.' : `${song.autor} reviews them and decides what goes in.`}
      </p>
      {error && <Failed error={error} />}
      {list.data.length === 0 ? (
        <p className="hist-empty">No proposals yet. When someone edits this project and proposes their changes, they show up here.</p>
      ) : (
        list.data.map((p) => {
          const [label, Icon] = PROPOSAL_STATE[p.estado]
          return (
            <div className={`related proposal st-${p.estado}`} key={p.id}>
              <Icon size={16} aria-hidden="true" />
              <div className="related-main">
                <b>{p.titulo}</b>
                <span className="dim">
                  #{p.id} by {who(p.autor)} · {timeAgo(p.fecha)} · from <a href={`#/project/${p.desde.id}`}>{p.desde.nombre}</a> v{p.desde.version}
                </span>
                {p.mensaje && <p className="proposal-msg">{p.mensaje}</p>}
              </div>
              <span className={`vis-tag prop-${p.estado}`}>{label}</span>
              {p.estado === 'abierta' && (
                <>
                  {isMine(p.autor) && (
                    <button className="tbtn" onClick={() => close(p, 'retirada')}>
                      Withdraw
                    </button>
                  )}
                  <button className={`tbtn ${canEdit ? 'accent' : ''}`} onClick={() => setReview(p)}>
                    <GitMerge size={13} aria-hidden="true" /> {canEdit ? 'Review and merge' : 'See the changes'}
                  </button>
                </>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function MergePreview({ song, other, canEdit, dirty, onBack, onMerged, backLabel = 'All related projects', heading, note, extra = null }) {
  const [res, setRes] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const prev = useLoad(() => api.mergePreview(song.id, other.id, res), `${song.id}:${song.version}:${other.id}:${JSON.stringify(res)}`)
  const p = prev.data
  const conflicts = p?.conflictos ?? []
  const nothing = p && p.cambios.resumen.vacio && !conflicts.length

  const merge = async () => {
    setBusy(true)
    setError(null)
    try {
      onMerged(await api.merge(song.id, other.id, res))
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }

  return (
    <div className={`hist-pane ${prev.loading ? 'stale' : ''}`}>
      <button className="link-back" onClick={onBack}>
        <ArrowLeft size={13} aria-hidden="true" /> {backLabel}
      </button>
      {heading && (
        <h3 className="merge-title">
          <GitPullRequestArrow size={16} aria-hidden="true" /> {heading}
        </h3>
      )}
      {note && <p className="proposal-msg">{note}</p>}
      <h3 className="merge-title">
        <GitMerge size={16} aria-hidden="true" /> Merge{' '}
        <b>
          {who(other.autor)} / {other.nombre}
        </b>{' '}
        <span className="ver-tag">v{p?.suyo.version ?? other.version}</span> into <b>{song.nombre}</b>
      </h3>
      {prev.error && <Failed error={prev.error} />}
      {!p && !prev.error && <Loading />}
      {p && (
        <>
          <p className="dim merge-base">
            Common starting point: {p.base.cancion_id === song.id ? 'this project' : p.base.cancion_id === other.id ? `${other.nombre}` : p.base.cancion_id} at v{p.base.numero}.
          </p>
          {nothing && (
            <p className="hist-empty">
              <Check size={14} aria-hidden="true" /> Already up to date: {who(other.autor)}’s project has nothing that yours doesn’t.
            </p>
          )}
          {conflicts.length > 0 && (
            <section className="diff-block">
              <h3>
                <TriangleAlert size={14} aria-hidden="true" /> Conflicts <span className="hist-count warn">{conflicts.length}</span>
              </h3>
              <p className="dim">You both changed these spots. Choose which version stays.</p>
              {conflicts.map((c) => (
                <div className="conflict" key={c.id}>
                  <p>{c.texto}</p>
                  <div className="seg" role="radiogroup" aria-label="Which version stays">
                    <button role="radio" aria-checked={c.eleccion === 'mio'} className={c.eleccion === 'mio' ? 'on' : ''} onClick={() => setRes({ ...res, [c.id]: 'mio' })}>
                      Keep yours
                    </button>
                    <button role="radio" aria-checked={c.eleccion === 'suyo'} className={c.eleccion === 'suyo' ? 'on' : ''} onClick={() => setRes({ ...res, [c.id]: 'suyo' })}>
                      Take {who(other.autor)}’s
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
          {p.choques.length > 0 && (
            <section className="diff-block clashes">
              <h3>
                <TriangleAlert size={14} aria-hidden="true" /> Harmonic clashes
              </h3>
              <p className="dim">Notes a minor second apart that would sound together after the merge. Not an error, but listen before you keep them.</p>
              <ul>
                {p.choques.map((c) => (
                  <li key={c.piezas.join()}>{c.texto}</li>
                ))}
              </ul>
            </section>
          )}
          {!p.cambios.resumen.vacio && (
            <section className="diff-block">
              <h3>What changes in your project</h3>
              <DiffView diff={p.cambios} />
            </section>
          )}
          <div className="merge-actions">
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            {!canEdit ? (
              <p className="dim">Only {song.autor} can merge into this project. Save your own copy first, then merge into it.</p>
            ) : dirty ? (
              <p className="dim">Save your changes first, so the merge starts from your latest version.</p>
            ) : null}
            {extra}
            <button className="tbtn accent big" disabled={!canEdit || dirty || busy || nothing || prev.loading} onClick={merge}>
              <GitMerge size={14} aria-hidden="true" />{' '}
              {busy ? 'Merging…' : conflicts.length ? `Merge with ${plural(conflicts.length, 'resolved conflict')}` : 'Merge into this project'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// --- Credits ----------------------------------------------------------------------------------------

const ROLES = {
  original: ['Created', 'Made this piece from scratch'],
  fork: ['Remixed', 'Forked someone’s piece and changed it'],
  origen: ['Started', 'Not in the song itself, but a piece in it descends from this one'],
}

function CreditsTab({ song }) {
  const cr = useLoad(() => api.credits(song.id), `${song.id}:${song.version}`)
  const c = cr.data
  const colors = useMemo(() => colorMap(c?.autores.map((a) => a.autor) ?? []), [c])
  if (cr.error) return <Failed error={cr.error} />
  if (!c) return <Loading />
  const writers = c.autores.filter((a) => a.notas > 0)
  return (
    <div className="hist-pane">
      <p className="credits-lead">
        This song plays <b>{c.total_notas}</b> notes written by <b>{plural(writers.length, 'author')}</b>. Each note is credited to whoever wrote
        it first: forking a piece keeps the original author’s notes theirs, and only what you add or move becomes yours.
      </p>
      {writers.length > 0 && (
        <div className="share-bar" role="img" aria-label={writers.map((a) => `${who(a.autor)} ${a.porcentaje}%`).join(', ')}>
          {writers.map((a) => (
            <span key={a.autor} style={{ flexGrow: a.notas, background: colors.get(a.autor) }} title={`${who(a.autor)}: ${a.porcentaje}%`} />
          ))}
        </div>
      )}
      <ul className="contributors">
        {c.autores.map((a) => (
          <li key={a.autor}>
            <Avatar name={a.autor} size={28} />
            <div className="contrib-main">
              <div className="contrib-head">
                <span className="hist-swatch" style={{ background: colors.get(a.autor) }} aria-hidden="true" />
                <a href={`#/u/${encodeURIComponent(a.autor)}`} className={isMine(a.autor) ? 'mine-text' : ''}>
                  <b>{who(a.autor)}</b>
                </a>
                <span className="dim">
                  {a.notas ? `${plural(a.notas, 'note')} · ${a.porcentaje}%` : 'no notes playing'}
                  {a.versiones > 0 && ` · saved ${plural(a.versiones, 'version')}`}
                  {a.merges > 0 && `, ${plural(a.merges, 'merge')}`}
                </span>
              </div>
              {a.notas > 0 && (
                <div className="contrib-bar">
                  <span style={{ width: `${a.porcentaje}%`, background: colors.get(a.autor) }} />
                </div>
              )}
              {a.piezas.length > 0 && (
                <ul className="contrib-roles">
                  {a.piezas.map((p) => (
                    <li key={p.id}>
                      <span className={`role r-${p.rol}`} title={ROLES[p.rol][1]}>
                        {ROLES[p.rol][0]}
                      </span>
                      <span className="code">{p.id}</span> {p.nombre}
                      <span className="dim">
                        {' '}
                        · {typeLabel(p.tipo)}
                        {p.rol === 'fork' && ` · ${p.notas_propias} of ${p.notas} notes are theirs`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
      <h3 className="hist-h">Who wrote each note</h3>
      <p className="hist-legend">
        {c.autores
          .filter((a) => a.notas > 0)
          .map((a) => (
            <span key={a.autor}>
              <span className="hist-swatch" style={{ background: colors.get(a.autor) }} aria-hidden="true" /> {who(a.autor)}
            </span>
          ))}
      </p>
      {c.piezas.map((p) => (
        <article className={`piece-card t-${p.tipo}`} key={p.id}>
          <header>
            <span className="code">{p.id}</span>
            <b className="piece-card-name">{p.nombre}</b>
            <span className="dim">
              {typeLabel(p.tipo)} · by {who(p.autor)}
              {p.parent_id && (
                <>
                  {' '}
                  · fork of <span className="code">{p.parent_id}</span>
                </>
              )}
            </span>
          </header>
          <MiniRoll notes={p.notas.map((n) => ({ ...n, color: colors.get(n.autor) }))} beats={p.compases * 4} />
        </article>
      ))}
    </div>
  )
}
