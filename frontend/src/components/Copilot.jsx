import { useEffect, useRef, useState } from 'react'
import { Check, GitBranch, Plus, Send } from 'lucide-react'
import { api } from '../api.js'
import { isMine } from '../profile.js'
import { typeLabel } from './Browser.jsx'
import { DJStemy } from './DJStemy.jsx'

export const STARTER = 'A laid-back boom bap beat for late-night verses'

// The assistant's chat. On screen it is DJ Stemy (DJStemy.jsx), who answers in speech bubbles; the code and the
// route keep the copilot name (POST /copiloto, CLAUDE.md 4.3).

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
      setMessages((m) => [
        ...m,
        { from: 'bot', texto: 'DJ Stemy is off the decks right now. You can still browse and add pieces yourself.', ids: [] },
      ])
    } finally {
      setBusy(false)
    }
  }

  // The empty Playlist's "Try" button sends the starter prompt through here.
  useEffect(() => {
    if (ask) send(STARTER)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  const lastBot = messages.findLastIndex((m) => m.from === 'bot')
  const used = new Set(song.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))
  const credits = [...used].map((id) => pieces[id]).filter(Boolean)

  return (
    <aside className="panel dock">
      <h2 className="title stemy-title">
        <DJStemy size={18} /> DJ Stemy <span className="dim">· digs up pieces, you compose</span>
      </h2>
      <div className="chat" ref={log}>
        {messages.length === 0 && !busy && (
          <div className="stemy-intro">
            <DJStemy size={84} />
            <div className="bubble bot">
              <p>
                Yo! I’m <b>DJ Stemy</b>. Tell me the song you have in mind: I dig up pieces that already exist in the library and tell you why they
                fit. You stay the composer.
              </p>
            </div>
            <button className="tbtn starter" onClick={() => send(STARTER)}>
              “{STARTER}”
            </button>
          </div>
        )}
        {messages.map((m, i) =>
          m.from === 'me' ? (
            <div key={i} className="msg-row me">
              <div className="bubble me">{m.texto}</div>
            </div>
          ) : (
            <div key={i} className="msg-row bot">
              <DJStemy size={34} mood={i === lastBot && !busy ? 'talking' : 'idle'} />
              <div className="bubble bot">
                <p>{m.texto}</p>
                {m.ids?.length > 0 && (
                  <>
                    <ul className="sugg">
                      {m.ids.map((id) => {
                        const p = pieces[id]
                        return (
                          <li key={id}>
                            <button className="sugg-main" onClick={() => onSelect(id)} title={p ? `${p.nombre} · ${p.autor} · ${p.licencia}` : id}>
                              <span className="code">{id}</span>
                              <span className="sugg-name">{p?.nombre ?? id}</span>
                              <span className="sugg-by">
                                {p?.autor}
                                {p && ` · ${typeLabel(p.tipo)}`}
                              </span>
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
            </div>
          ),
        )}
        {busy && (
          <div className="msg-row bot">
            <DJStemy size={34} mood="thinking" />
            <div className="bubble bot pending" role="status">
              <span className="typing" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Digging through the crates…
            </div>
          </div>
        )}
      </div>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask DJ Stemy for pieces…" aria-label="Message DJ Stemy" />
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
                <li key={p.id} className={isMine(p.autor) ? 'mine' : ''}>
                  <span className="credit-name">{p.nombre}</span>
                  <span className="dim">
                    {isMine(p.autor) ? 'you' : p.autor} · {p.licencia}
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
