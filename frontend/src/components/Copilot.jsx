import { useEffect, useRef, useState } from 'react'
import { Check, GitBranch, Mic, Play, Plus, Send, Square } from 'lucide-react'
import { api, currentUser, ME } from '../api.js'
import { isMine } from '../profile.js'
import { typeLabel } from './Browser.jsx'
import { DJStemy } from './DJStemy.jsx'
import { HumRecorder } from './HumRecorder.jsx'
import { MiniRoll } from './MiniRoll.jsx'
import './hum.css'

export const STARTER = 'A laid-back boom bap beat for late-night verses'
const HUM_MESSAGE = 'Here’s the melody I have in mind (hummed). Find pieces like it, or pieces that fit it.'
const HISTORY = 8 // earlier messages sent along, so "lo-fi piano" said before a humming still counts
const STRONG = 0.7 // same threshold as the backend (copilot/hum.js): "it sounds like this piece"

// The assistant's chat. On screen it is DJ Stemy (DJStemy.jsx), who answers in speech bubbles; the code and the
// route keep the copilot name (POST /copiloto, CLAUDE.md 4.3).
// Hum to DJ Stemy: the mic button records a melody (HumRecorder), which is sent as notes with the message; the server
// finds the library melodies that sound like it and DJ Stemy suggests them plus pieces that fit around it.
// onPreview(piece, notes, bars) / playing: the project's piece preview, reused to play hummed melodies.

export function Copilot({ song, pieces, onAddMany, onSelect, onTree, remember, fail, ask, onPreview, playing }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [humming, setHumming] = useState(false)
  const humCount = useRef(0)
  const log = useRef(null)

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' })
  }, [messages, humming])

  const send = async (mensaje, hum = null) => {
    if (!mensaje.trim() || busy) return
    const historial = messages.slice(-HISTORY).map((m) => ({
      de: m.from === 'me' ? 'usuario' : 'stemy',
      texto: m.hum ? `${m.texto} [hummed a melody]` : m.texto,
    }))
    const mine = messages.length // index of the message being sent
    setText('')
    setMessages((m) => [...m, { from: 'me', texto: mensaje, hum }])
    setBusy(true)
    try {
      const res = await api.copilot(mensaje, song, { historial, ...(hum && { tarareo: { notas: hum.notas } }) })
      const ids = res.piezas_sugeridas ?? []
      remember(await Promise.all(ids.filter((id) => !pieces[id]).map(api.getPiece)))
      const match = Object.fromEntries((res.tarareo?.coincidencias ?? []).map((c) => [c.id, c.similitud]))
      const key = res.tarareo?.tonalidad // the humming's key, used if it becomes a piece
      setMessages((m) => [
        ...m.map((x, j) => (j === mine && x.hum && key ? { ...x, hum: { ...x.hum, tonalidad: key } } : x)),
        { from: 'bot', texto: res.texto, ids, match },
      ])
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

  // A hummed melody plays through the project's preview, with the piano (as an "acordes" piece).
  const previewHum = (hum) => onPreview?.({ id: hum.id, tipo: 'acordes', notas: hum.notas, compases: hum.compases }, hum.notas, hum.compases)
  const newHum = (hum) => ({ ...hum, id: `hum-${++humCount.current}` })

  // Your humming is your composition: save it as your own melody piece and put it in the song.
  const keepHum = async (i) => {
    const hum = messages[i].hum
    try {
      const piece = await api.createPiece({
        nombre: 'My hummed melody',
        tipo: 'melodia',
        autor: ME,
        licencia: 'CC BY 4.0',
        fuente: 'Hummed to DJ Stemy in Stemma',
        tonalidad: hum.tonalidad ?? null,
        tempo: song.tempo,
        estilo: ['rap'],
        compases: hum.compases,
        notas: hum.notas,
        publica: currentUser() ? song.publica !== false : true,
      })
      remember([piece])
      await onAddMany([piece.id])
      setMessages((m) => m.map((x, j) => (j === i ? { ...x, hum: { ...x.hum, pieceId: piece.id } } : x)))
    } catch (e) {
      fail(e)
    }
  }

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
            <DJStemy size={124} deck mood="talking" />
            <div className="bubble bot">
              <p>
                Yo! I’m <b>DJ Stemy</b>. Tell me the song you have in mind: I dig up pieces that already exist in the library and tell you why they
                fit. You stay the composer.
              </p>
              <p>
                Got a tune in your head? Tell me a genre and an instrument, then press <Mic size={11} aria-label="the microphone" /> and hum it to me.
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
              <div className="bubble me">
                {m.texto}
                {m.hum && (
                  <div className="hum-msg">
                    <MiniRoll notes={m.hum.notas} beats={m.hum.compases * 4} />
                    <div className="hum-msg-actions">
                      <button className={`tbtn ${playing === m.hum.id ? 'on' : ''}`} onClick={() => previewHum(m.hum)}>
                        {playing === m.hum.id ? <Square size={11} /> : <Play size={12} />} {m.hum.notas.length} notes
                      </button>
                      {m.hum.pieceId ? (
                        <span className="tbtn" aria-disabled="true">
                          <Check size={12} /> In your song ({m.hum.pieceId})
                        </span>
                      ) : (
                        <button className="tbtn" onClick={() => keepHum(i)} title="Save the humming as your own melody piece and add it to the song">
                          <Plus size={12} /> Use in my song
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div key={i} className="msg-row bot">
              <DJStemy size={48} deck mood={i === lastBot && !busy ? 'talking' : 'idle'} />
              <div className="bubble bot">
                <p>{m.texto}</p>
                {m.ids?.length > 0 && (
                  <>
                    <ul className="sugg">
                      {m.ids.map((id) => {
                        const p = pieces[id]
                        const match = m.match?.[id]
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
                            {match !== undefined && (
                              <span className={`match ${match < STRONG ? 'weak' : ''}`} title="How much it sounds like your humming">
                                {Math.round(match * 100)}%
                              </span>
                            )}
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
            <DJStemy size={48} deck mood="thinking" />
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
      {humming && (
        <HumRecorder
          bpm={song.tempo}
          previewing={typeof playing === 'string' && playing.startsWith('hum-draft')}
          onPreview={(hum) => previewHum({ ...hum, id: 'hum-draft' })}
          onClose={() => setHumming(false)}
          onSend={(hum) => {
            setHumming(false)
            send(text.trim() || HUM_MESSAGE, newHum(hum))
          }}
        />
      )}
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <button
          type="button"
          className={`icon mic ${humming ? 'on' : ''}`}
          onClick={() => setHumming((h) => !h)}
          disabled={busy}
          aria-pressed={humming}
          aria-label="Hum a melody to DJ Stemy"
          title="Hum a melody to DJ Stemy"
        >
          <Mic size={14} />
        </button>
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
