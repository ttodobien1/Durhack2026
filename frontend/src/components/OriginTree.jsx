// Origin tree window. Role C owns this view: replace the layout and node styling freely,
// the props (song, loadPiece, onClose) and the { nodos, aristas } shape from CLAUDE.md §4.3 stay.
import { useEffect, useState } from 'react'
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X } from 'lucide-react'
import { isMine } from '../profile.js'
import { typeLabel } from './Browser.jsx'

// shortcut: built client-side by walking parent_id, because the contract has no route to send the
// current song to the backend; switch to GET /canciones/:id/arbol once songs are stored there.
async function buildTree(song, loadPiece) {
  const nodos = new Map()
  const aristas = []
  const visit = async (id) => {
    if (nodos.has(id)) return
    const p = await loadPiece(id)
    nodos.set(id, { id, nombre: p.nombre, autor: p.autor, tipo: p.tipo, licencia: p.licencia, parent_id: p.parent_id })
    if (p.parent_id) {
      aristas.push({ desde: p.parent_id, hacia: id })
      await visit(p.parent_id)
    }
  }
  const used = new Set(song.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))
  for (const id of used) await visit(id)
  return { nodos: [...nodos.values()], aristas, used }
}

function layout({ nodos, aristas, used }) {
  // Tidy tree: each root takes columns left to right, children sit under their parent.
  const nodes = []
  let col = 0
  const place = (n, depth) => {
    const kids = nodos.filter((x) => x.parent_id === n.id)
    const start = col
    kids.forEach((k) => place(k, depth + 1))
    if (!kids.length) col++
    nodes.push({ id: n.id, type: 'piece', position: { x: ((start + col - 1) / 2) * 230, y: depth * 140 }, data: { ...n, inSong: used.has(n.id) } })
  }
  nodos.filter((n) => !n.parent_id).forEach((r) => place(r, 0))
  return {
    nodes,
    edges: aristas.map((a) => ({ id: `${a.desde}-${a.hacia}`, source: a.desde, target: a.hacia, animated: isMine(nodos.find((n) => n.id === a.hacia)?.autor) })),
  }
}

function PieceNode({ data }) {
  return (
    <div className={`tree-node t-${data.tipo} ${isMine(data.autor) ? 'mine' : ''} ${data.inSong ? '' : 'ancestor'}`}>
      <Handle type="target" position={Position.Top} />
      <div className="tree-head">
        <span className="code">{data.id}</span> {typeLabel(data.tipo)}
      </div>
      <strong>{data.nombre}</strong>
      <span className="tree-meta">
        {isMine(data.autor) ? 'you' : data.autor} · {data.licencia}
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
const nodeTypes = { piece: PieceNode }

export function OriginTree({ song, loadPiece, onClose }) {
  const [tree, setTree] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    buildTree(song, loadPiece).then(setTree, (e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const authors = tree ? new Set(tree.nodos.filter((n) => !isMine(n.autor)).map((n) => n.autor)) : new Set()
  const mine = tree?.nodos.filter((n) => isMine(n.autor)).length ?? 0

  return (
    <div className="window-backdrop" onClick={onClose}>
      <section className="panel window" role="dialog" aria-modal="true" aria-label="Origin tree" onClick={(e) => e.stopPropagation()}>
        <h2 className="title roll-title">
          <span>
            Origin tree <span className="dim">· {song.nombre}</span>
          </span>
          <button className="icon small" onClick={onClose} aria-label="Close origin tree">
            <X size={13} />
          </button>
        </h2>
        {tree && (
          <p className="tree-summary">
            This song has <b>{tree.used.size}</b> {tree.used.size === 1 ? 'piece' : 'pieces'} drawing on <b>{authors.size}</b>{' '}
            {authors.size === 1 ? 'author' : 'authors'}.{' '}
            {mine ? (
              <>
                <b className="mine-text">{mine}</b> {mine === 1 ? 'piece is' : 'pieces are'} yours.
              </>
            ) : (
              'Fork a piece to add your own.'
            )}
          </p>
        )}
        <div className="tree-canvas">
          {error && <p className="empty">Could not build the tree: {error}</p>}
          {tree && (
            <ReactFlow {...layout(tree)} nodeTypes={nodeTypes} fitView colorMode="dark" nodesConnectable={false}>
              <Background color="#3d454b" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </section>
    </div>
  )
}
