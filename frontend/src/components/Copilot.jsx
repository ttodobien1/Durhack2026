import { useEffect, useRef, useState } from 'react'
import { Check, GitBranch, Plus, Send } from 'lucide-react'
import { api, ME } from '../api.js'

export const STARTER = 'A laid-back boom bap beat for late-night verses'

export function Copilot({ song, pieces, onAddMany, onSelect, onTree, remember, fail, ask }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const log = useRef(null)

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (mensaje) => {
    if (!mensaje.trim() || busy) return
    setText('')
    setMessages((m) => [...m, { from: 'me', texto: mensaje }])
    setBusy(true)
    try {
      const res = await api.copilot(mensaje, song)
      const ids = res.piezas_sugeridas ?? []
      remember(await Promise.all(ids.filter((id) => !pieces[id]).map(api.getPiece)))
      setMessages((m) => [...m, { from: 'bot', texto: res.texto, ids }])
    } catch (e) {
      fail(e)
      setMessages((m) => [...m, { from: 'bot', texto: 'The copilot is unavailable right now. You can still browse and add pieces yourself.', ids: [] }])
    } finally {
      setBusy(false)
    }
  }

  // The empty Playlist's "Try" button sends the starter prompt through here.
  useEffect(() => {
    if (ask) send(STARTER)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  const used = new Set(song.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))
  const credits = [...used].map((id) => pieces[id]).filter(Boolean)

  return (
    <aside className="panel dock">
      <h2 className="title">Copilot</h2>
      <div className="chat" ref={log}>
        {messages.length === 0 && (
          <div className="chat-intro">
            <p>Tell me the song you have in mind. I suggest pieces that already exist and explain why; you compose.</p>
            <button className="tbtn" onClick={() => send(STARTER)}>
              “{STARTER}”
            </button>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.from}`}>
            <p>{m.texto}</p>
            {m.ids?.length > 0 && (
              <>
                <ul className="sugg">
                  {m.ids.map((id) => {
                    const p = pieces[id]
                    return (
                      <li key={id}>
                        <button className="sugg-main" onClick={() => onSelect(id)}>
                          <span className="code">{id}</span> {p?.nombre ?? id} <span className="dim">· {p?.autor}</span>
                        </button>
                        {used.has(id) ? (
                          <span className="in-song" title="In song" aria-label="In song">
                            <Check size={13} />
                          </span>
                        ) : (
                          <button className="icon small" onClick={() => onAddMany([id])} aria-label={`Add ${p?.nombre ?? id} to song`}>
                            <Plus size={12} />
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <button className="tbtn" onClick={() => onAddMany(m.ids)} disabled={m.ids.every((id) => used.has(id))}>
                  <Plus size={13} /> Add all to song
                </button>
              </>
            )}
          </div>
        ))}
        {busy && <div className="msg bot pending">Looking through the library…</div>}
      </div>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask for pieces…" aria-label="Message the copilot" />
        <button className="icon" type="submit" disabled={busy || !text.trim()} aria-label="Send">
          <Send size={14} />
        </button>
      </form>

      <h2 className="title">Credits</h2>
      <div className="credits">
        {credits.length === 0 ? (
          <p className="empty">Every piece you add is credited here.</p>
        ) : (
          <>
            <ul>
              {credits.map((p) => (
                <li key={p.id} className={p.autor === ME ? 'mine' : ''}>
                  <span className="credit-name">{p.nombre}</span>
                  <span className="dim">
                    {p.autor === ME ? 'you' : p.autor} · {p.licencia}
                  </span>
                </li>
              ))}
            </ul>
            <button className="tbtn" onClick={onTree}>
              <GitBranch size={13} /> Show origin tree
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
