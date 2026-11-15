// Tree tab of the project history. Every version of the project is a row with all the pieces it used, linked to
// the row where each piece last appeared: grey dotted when it stayed the same, yellow when it was edited, orange
// when a fork took its place. The library pieces they come from sit on top, the unsaved state ("Now") at the bottom.
// Rows are drawn by ../versionTree.js. Nodes can be dragged (positions are remembered in this browser); clicking a
// piece shows what changed there and lets you listen to it, restore it in the project, or keep working from it.
import { useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, Handle, MarkerType, Position, useNodesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { GitCompare, GitMerge, LayoutGrid, PencilLine, Play, RotateCcw, Square, X } from 'lucide-react'
import { api } from '../api.js'
import { diffNotes } from '../diff.js'
import { isMine } from '../profile.js'
import { buildVersionTree, differs, loadAncestors, pieceOrder, stageOf, successors } from '../versionTree.js'
import { typeLabel } from './Browser.jsx'
import { MiniRoll } from './MiniRoll.jsx'
import { compareRoll } from '../rolls.js'

const COL_W = 210
const ROW_H = 118
const LABEL_W = 200
const who = (autor) => (isMine(autor) ? 'you' : autor)
const sameNotes = (a, b) => a.compases === b.compases && JSON.stringify(a.notas) === JSON.stringify(b.notas)
const ESTADO = { same: 'Same', edited: 'Edited', fork: 'Fork', new: 'New', library: 'Origin' }

// Node positions the musician arranged, per project, in this browser only.
const posKey = (songId) => `stemma-tree:${songId}`
function readPositions(songId) {
  try {
    return JSON.parse(localStorage.getItem(posKey(songId))) ?? {}
  } catch {
    return {}
  }
}
function writePositions(songId, positions) {
  try {
    if (positions) localStorage.setItem(posKey(songId), JSON.stringify(positions))
    else localStorage.removeItem(posKey(songId))
  } catch {
    /* storage blocked: the layout lasts for this visit */
  }
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function timeAgo(iso) {
  const s = (new Date(iso) - Date.now()) / 1000
  if (Math.abs(s) < 60) return 'just now'
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}

/** How a row is called in sentences ("Edited in v3"). */
function rowName(row) {
  if (row.kind === 'library') return 'the library'
  if (row.kind === 'origin') return 'the original project'
  if (row.kind === 'working') return 'your unsaved changes'
  return `v${row.numero}`
}
function rowLabel(row, top) {
  if (row.kind === 'library') return { kind: 'library', tag: 'Library', text: top ? 'Where these pieces come from' : 'Earlier origins' }
  return row
}

function StageNode({ data }) {
  return (
    <div className={`vt-stage k-${data.kind}`} title={data.text}>
      <Handle type="target" position={Position.Top} id="t" />
      <span className="vt-stage-tag">
        {data.kind === 'merge' && <GitMerge size={11} aria-hidden="true" />} {data.tag}
      </span>
      <span className="vt-stage-text">{data.text}</span>
      {data.meta && <span className="vt-stage-meta">{data.meta}</span>}
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
    </div>
  )
}

function PieceNode({ data, selected }) {
  const p = data.piece
  return (
    <div className={`tree-node vt-piece t-${p.tipo} e-${data.estado} ${isMine(p.autor) ? 'mine' : ''} ${selected ? 'picked' : ''}`}>
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="target" position={Position.Left} id="l" />
      <div className="tree-head">
        <span className="code">{p.id}</span> {typeLabel(p.tipo)}
        <span className={`vt-estado e-${data.estado}`}>{ESTADO[data.estado]}</span>
      </div>
      <strong>{p.nombre}</strong>
      <span className="tree-meta">
        {who(p.autor)}
        {p.licencia ? ` · ${p.licencia}` : ''}
      </span>
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
    </div>
  )
}
const nodeTypes = { stage: StageNode, piece: PieceNode }

// React Flow nodes and edges: a label per row, the row's pieces joined by a horizontal line, rows joined by the
// label column, and a link from each piece to where it was before.
function toFlow(tree) {
  const nodes = []
  const edges = []
  tree.rows.forEach((row, r) => {
    const label = `row:${row.key}`
    nodes.push({ id: label, type: 'stage', position: { x: 0, y: r * ROW_H + 10 }, data: rowLabel(row, r === 0) })
    if (r > 0) {
      edges.push({ id: `spine:${r}`, source: `row:${tree.rows[r - 1].key}`, target: label, sourceHandle: 'b', targetHandle: 't', type: 'straight', className: 'vt-spine', selectable: false, focusable: false })
    }
    let prev = label
    for (const n of tree.nodes.filter((x) => x.row === r).sort((a, b) => a.col - b.col)) {
      nodes.push({ id: n.id, type: 'piece', position: { x: LABEL_W + n.col * COL_W, y: r * ROW_H }, data: { piece: n.piece, estado: n.estado } })
      edges.push({ id: `rail:${n.id}`, source: prev, target: n.id, sourceHandle: 'r', targetHandle: 'l', type: 'straight', className: `vt-rail k-${row.kind}`, selectable: false, focusable: false })
      prev = n.id
    }
  })
  for (const link of tree.links) {
    edges.push({
      id: `link:${link.to}`,
      source: link.from,
      target: link.to,
      sourceHandle: 'b',
      targetHandle: 't',
      className: `vt-link e-${link.estado}`,
      animated: link.estado !== 'same',
      markerEnd: link.estado === 'same' ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      selectable: false,
      focusable: false,
    })
  }
  return { nodes, edges }
}

/**
 * Props: song, saved (it has a server history), loadPiece, pieces (editor cache), drafts ({ id: { notas, compases } }),
 * playing + onPreview(piece), onRestore(info, { edit }), onShowChanges(numero).
 */
export function VersionTree({ song, saved, loadPiece, pieces, drafts, playing, onPreview, onRestore, onShowChanges }) {
  const [hist, setHist] = useState({ key: null })
  const histKey = saved ? `${song.id}:${song.version ?? 0}` : null
  useEffect(() => {
    if (!histKey) return
    let live = true
    api.versions(song.id, true).then(
      (data) => live && setHist({ key: histKey, data }),
      (e) => live && setHist({ key: histKey, error: e.message || String(e) }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histKey])
  const data = histKey && hist.key === histKey ? hist.data : null

  // The editor's state, unsaved piano roll edits included.
  const working = useMemo(() => {
    const piezas = {}
    for (const id of pieceOrder(song.pistas)) {
      if (pieces[id]) piezas[id] = { ...pieces[id], ...drafts?.[id] }
    }
    return { key: 'now', kind: 'working', order: pieceOrder(song.pistas).filter((id) => piezas[id]), piezas }
  }, [song.pistas, pieces, drafts])

  const stages = useMemo(() => {
    const list = []
    const origen = data?.origen
    if (origen?.snapshot) {
      list.push(stageOf('origin', 'origin', origen.snapshot, { tag: 'Forked from', text: `${who(origen.autor)} / ${origen.nombre}`, meta: `at v${origen.version}` }))
    }
    const versions = [...(data?.versiones ?? [])].reverse() // oldest first
    for (const v of versions) {
      list.push(
        stageOf(`v${v.numero}`, v.merge ? 'merge' : 'version', v.snapshot, {
          numero: v.numero,
          tag: `v${v.numero}`,
          text: v.mensaje,
          meta: `${who(v.autor)} · ${timeAgo(v.fecha)}`,
        }),
      )
    }
    const last = versions.length ? list.at(-1) : null
    if (!last || differs(last, working)) {
      list.push({ ...working, tag: 'Now', text: last ? 'Unsaved changes' : 'Not saved yet', meta: last ? `after v${last.numero}` : '' })
    }
    return list
  }, [data, working])

  // Library origins of every piece (walks parent_id; cached by the editor's loadPiece).
  const [library, setLibrary] = useState(() => new Map())
  const parentsKey = [...new Set(stages.flatMap((s) => s.order.map((id) => s.piezas[id]?.parent_id)).filter(Boolean))].sort().join()
  useEffect(() => {
    let live = true
    loadAncestors(stages, loadPiece).then((lib) => live && setLibrary(lib))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentsKey])

  const tree = useMemo(() => buildVersionTree(stages, library), [stages, library])
  const flow = useMemo(() => toFlow(tree), [tree])
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [selectedId, setSelectedId] = useState(null)

  // New data: keep where nodes already are (dragged ones included), else the remembered or the default place.
  useEffect(() => {
    setNodes((current) => {
      const now = new Map(current.map((n) => [n.id, n.position]))
      const remembered = saved ? readPositions(song.id) : {}
      return flow.nodes.map((n) => ({ ...n, position: now.get(n.id) ?? remembered[n.id] ?? n.position }))
    })
  }, [flow, saved, song.id, setNodes])

  const resetLayout = () => {
    writePositions(song.id, null)
    setNodes(flow.nodes)
  }
  const onDragStop = (_, node, moved) => {
    if (!saved) return
    const positions = readPositions(song.id)
    for (const n of moved?.length ? moved : [node]) positions[n.id] = n.position
    writePositions(song.id, positions)
  }

  const fitKey = nodes.map((n) => n.id).join('|')
  const selected = tree.nodes.find((n) => n.id === selectedId) ?? null
  const selectedRow = tree.rows.find((r) => `row:${r.key}` === selectedId) ?? null
  const versionCount = data?.versiones?.length ?? 0
  const lastRow = tree.rows.at(-1)
  const nowPieces = lastRow ? tree.nodes.filter((n) => n.row === lastRow.index) : []
  const others = new Set(tree.nodes.filter((n) => n.row === lastRow?.index || tree.rows[n.row].kind === 'library').map((n) => n.piece.autor).filter((a) => !isMine(a)))
  const mine = nowPieces.filter((n) => isMine(n.piece.autor)).length

  return (
    <div className="vt">
      <div className="vt-bar">
        <p className="vt-summary">
          This song has <b>{nowPieces.length}</b> {nowPieces.length === 1 ? 'piece' : 'pieces'} drawing on <b>{others.size}</b> {others.size === 1 ? 'author' : 'authors'}.{' '}
          {mine ? (
            <>
              <b className="mine-text">{mine}</b> {mine === 1 ? 'piece is' : 'pieces are'} yours.
            </>
          ) : (
            'Fork a piece or create one to add your own.'
          )}{' '}
          <span className="dim">{versionCount ? `${versionCount} ${versionCount === 1 ? 'version' : 'versions'} · ` : ''}drag pieces to arrange the tree, click one to see what changed.</span>
        </p>
        <span className="vt-legend" aria-label="Legend">
          <span className="lk e-same" /> same <span className="lk e-edited" /> edited <span className="lk e-fork" /> fork
        </span>
        <button className="tbtn" onClick={resetLayout} title="Put every node back in its row">
          <LayoutGrid size={13} aria-hidden="true" /> Reset layout
        </button>
      </div>
      <div className="vt-main">
        <div className="tree-canvas">
          {saved && hist.error && hist.key === histKey && <p className="empty">Could not load the versions: {hist.error}</p>}
          {!tree.nodes.length && <p className="empty">Add pieces to the project to start its tree.</p>}
          <ReactFlow
            key={fitKey} // a new set of nodes mounts the canvas again, so it fits them in view
            nodes={nodes}
            edges={flow.edges}
            onNodesChange={onNodesChange}
            onNodeDragStop={onDragStop}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.2}
            colorMode="dark"
            nodesConnectable={false}
          >
            <Background color="#3d454b" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {selected && (
          <NodePanel
            node={selected}
            tree={tree}
            working={working}
            playing={playing}
            onPreview={onPreview}
            onRestore={onRestore}
            onClose={() => setSelectedId(null)}
          />
        )}
        {selectedRow?.numero && (
          <aside className="vt-panel">
            <button className="icon small vt-close" onClick={() => setSelectedId(null)} aria-label="Close">
              <X size={13} />
            </button>
            <h3>
              <span className="ver-tag">v{selectedRow.numero}</span> {selectedRow.text}
            </h3>
            <p className="dim">{selectedRow.meta}</p>
            <p>
              {selectedRow.order.length} {selectedRow.order.length === 1 ? 'piece' : 'pieces'} in this version.
            </p>
            <button className="tbtn" onClick={() => onShowChanges(selectedRow.numero)}>
              <GitCompare size={13} aria-hidden="true" /> See what this version changed
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}

function NodePanel({ node, tree, working, playing, onPreview, onRestore, onClose }) {
  const piece = node.piece
  const row = tree.rows[node.row]
  const prev = node.from ? tree.nodes.find((n) => n.id === node.from) : null
  const prevRow = prev ? tree.rows[prev.row] : null
  const changed = prev && node.estado !== 'same'
  const d = changed ? diffNotes(prev.piece.notas, piece.notas) : null
  const counts = d && (
    <span className="note-stats">
      <span className="add">+{d.nuevas.length}</span> <span className="del">−{d.borradas.length}</span> <span className="mov">~{d.movidas.length}</span>
    </span>
  )
  const live = working.piezas[piece.id]
  const current = live && working.order.includes(piece.id) && sameNotes(live, piece)
  const previewId = `tree:${node.id}`
  const info = { ...piece, successors: successors(node.id, tree), where: rowName(row) }

  let story
  if (node.estado === 'library') story = <>A library piece: a piece of this project descends from it.</>
  else if (node.estado === 'new') story = <>First appears in {rowName(row)}.</>
  else if (node.estado === 'same') story = <>Same notes as in {rowName(prevRow)}.</>
  else if (node.estado === 'edited')
    story = (
      <>
        Edited in {rowName(row)}: {counts} notes compared with {rowName(prevRow)}.
      </>
    )
  else
    story = (
      <>
        Fork of <span className="code">{prev.piece.id}</span> {prev.piece.nombre} by {who(prev.piece.autor)}: {counts} notes.
      </>
    )

  return (
    <aside className="vt-panel" aria-label={`${piece.nombre} in ${rowName(row)}`}>
      <button className="icon small vt-close" onClick={onClose} aria-label="Close">
        <X size={13} />
      </button>
      <h3>
        <span className="code">{piece.id}</span> {piece.nombre}
      </h3>
      <p className="dim">
        {typeLabel(piece.tipo)} · by <span className={isMine(piece.autor) ? 'mine-text' : ''}>{who(piece.autor)}</span> · {piece.compases}{' '}
        {piece.compases === 1 ? 'bar' : 'bars'} · in {rowName(row)}
      </p>
      <p className="vt-story">{story}</p>
      <MiniRoll notes={compareRoll(changed ? prev.piece.notas : null, piece.notas)} beats={Math.max(piece.compases, prev?.piece.compases ?? 0) * 4} />
      <div className="vt-actions">
        <button className="tbtn" onClick={() => onPreview({ ...piece, id: previewId })} disabled={!piece.notas.length}>
          {playing === previewId ? <Square size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />} {playing === previewId ? 'Stop' : 'Listen to this version'}
        </button>
        <button className="tbtn" onClick={() => onRestore(info, { edit: false })} disabled={current}>
          <RotateCcw size={13} aria-hidden="true" /> Restore in project
        </button>
        <button className="tbtn accent" onClick={() => onRestore(info, { edit: true })}>
          <PencilLine size={13} aria-hidden="true" /> Continue working from here
        </button>
      </div>
      <p className="fine">
        {current
          ? 'The project uses this piece exactly like this right now. Continue working opens it in the piano roll.'
          : 'Restore puts this piece back in the project as it is here (unsaved until you save). Continue working also opens it in the piano roll to keep changing it: as your own fork if it isn’t yours.'}
      </p>
    </aside>
  )
}
