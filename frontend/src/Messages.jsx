// Messages between artists, like email (cambios.md §14): one conversation per person, a mail card per message,
// replies with a subject. Routes: "#/messages", "#/messages/<name>" (a conversation), "#/messages?to=<name>[&project=<id>]"
// (write a new message, optionally about a project), "#/messages?ajustes" (who can write to you, blocked people).
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Ban, Disc3, Mail, PenLine, Send, Settings, X } from 'lucide-react'
import { api } from './api.js'
import { useUser } from './profile.js'
import { Avatar, SiteBar } from './Site.jsx'
import { timeAgo } from './components/Comments.jsx'
import { refreshUnread } from './unread.js'
import './social.css'

const enc = encodeURIComponent
const longDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export function Messages({ con, compose, to, project, settings }) {
  const [user, setUser] = useUser()
  const [convs, setConvs] = useState(null)
  const [error, setError] = useState(null)
  const loadConvs = useCallback(() => {
    api.conversations().then(setConvs, (e) => setError(e.message))
  }, [])
  useEffect(() => {
    if (user) loadConvs()
  }, [user, loadConvs])

  const open = Boolean(con || compose || settings)
  const unreadTotal = (convs ?? []).reduce((n, c) => n + c.sin_leer, 0)

  return (
    <div className="site">
      <SiteBar user={user} onUser={setUser} />
      <main className="mail">
        {!user ? (
          <div className="panel mail-out">
            <Mail size={22} aria-hidden="true" />
            <p>Log in to read your messages and write to other artists.</p>
          </div>
        ) : (
          <div className={`mail-grid ${open ? 'has-main' : ''}`}>
            <aside className="panel mail-list" aria-label="Conversations">
              <h2 className="title">
                <span>
                  Messages {unreadTotal > 0 && <span className="dim">· {unreadTotal} unread</span>}
                </span>
                <span className="title-tools">
                  <a className="icon small wide" href="#/messages?to=" title="Write a new message">
                    <PenLine size={12} /> New
                  </a>
                  <a className="icon small" href="#/messages?ajustes" aria-label="Message settings" title="Who can write to you, blocked people">
                    <Settings size={12} />
                  </a>
                </span>
              </h2>
              {error && (
                <p className="auth-error mail-pad" role="alert">
                  {error}
                </p>
              )}
              {!convs && !error && <p className="soc-empty mail-pad">Loading…</p>}
              {convs?.length === 0 && (
                <p className="soc-empty mail-pad">
                  No messages yet. Open an artist’s profile and press <b>Message</b> to propose a collaboration, or <a href="#/messages?to=">write one here</a>.
                </p>
              )}
              <ul className="mail-convs">
                {convs?.map((c) => (
                  <li key={c.con}>
                    <a href={`#/messages/${enc(c.con)}`} className={`mail-conv ${c.con === con ? 'on' : ''} ${c.sin_leer ? 'unread' : ''}`}>
                      <Avatar name={c.con} size={30} />
                      <span className="mail-conv-main">
                        <span className="mail-conv-top">
                          <b>{c.con}</b>
                          {c.bloqueado && <Ban size={11} aria-label="blocked" />}
                          <time>{timeAgo(c.ultimo.fecha)}</time>
                        </span>
                        <span className="mail-subject">{c.ultimo.asunto || '(no subject)'}</span>
                        <span className="dim mail-preview">
                          {c.ultimo.mio && 'You: '}
                          {c.ultimo.texto}
                        </span>
                      </span>
                      {c.sin_leer > 0 && <span className="nav-badge">{c.sin_leer}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
            <section className="panel mail-main">
              {settings ? (
                <MailSettings />
              ) : compose ? (
                <Compose key={`${to}:${project}`} initialTo={to ?? ''} project={project} onSent={loadConvs} />
              ) : con ? (
                <Thread key={con} con={con} onChange={loadConvs} />
              ) : (
                <div className="mail-empty">
                  <Mail size={28} aria-hidden="true" />
                  <p>Pick a conversation, or write a new message to start a collaboration.</p>
                  <a className="tbtn accent" href="#/messages?to=">
                    <PenLine size={13} aria-hidden="true" /> New message
                  </a>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

const BackToList = () => (
  <a className="link-back mail-back" href="#/messages">
    <ArrowLeft size={13} aria-hidden="true" /> All messages
  </a>
)

function Thread({ con, onChange }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [asunto, setAsunto] = useState('')
  const [texto, setTexto] = useState('')

  const load = useCallback(
    () =>
      api.thread(con).then(
        (d) => {
          setData(d)
          const last = [...d.mensajes].reverse().find((m) => m.asunto)?.asunto ?? ''
          setAsunto(last ? (last.startsWith('Re: ') ? last : `Re: ${last}`) : '')
          refreshUnread()
          onChange()
        },
        (e) => setError(e.message),
      ),
    [con, onChange],
  )
  useEffect(() => {
    load()
  }, [load])

  const send = async (e) => {
    e.preventDefault()
    if (!texto.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.sendMessage({ para: con, asunto: asunto.trim(), texto: texto.trim() })
      setTexto('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const toggleBlock = async () => {
    setError(null)
    try {
      await api.block(con, !data.bloqueado)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="mail-thread">
      <div className="mail-head">
        <BackToList />
        <Avatar name={con} size={30} />
        <a className="mail-who" href={`#/u/${enc(con)}`}>
          {con}
        </a>
        <span className="spacer" />
        {data && (
          <button className={`tbtn ${data.bloqueado ? '' : 'danger-text'}`} onClick={toggleBlock} title={data.bloqueado ? 'Let them write to you again' : 'They will not be able to write to you, nor propose changes to your projects'}>
            <Ban size={13} aria-hidden="true" /> {data.bloqueado ? 'Unblock' : 'Block'}
          </button>
        )}
      </div>
      <div className="mail-cards">
        {!data && !error && <p className="soc-empty">Loading…</p>}
        {data?.mensajes.length === 0 && <p className="soc-empty">No messages with {con} yet. Write the first one below.</p>}
        {data?.mensajes.map((m) => (
          <article key={m.id} className={`mail-card ${m.mio ? 'mine' : ''}`}>
            <header>
              <b>{m.mio ? 'You' : m.de}</b>
              <span className="dim">
                to {m.mio ? m.para : 'you'} · <time title={longDate.format(new Date(m.fecha))}>{timeAgo(m.fecha)}</time>
              </span>
            </header>
            {m.asunto && <h3>{m.asunto}</h3>}
            <p className="mail-text">{m.texto}</p>
            {m.cancion && (
              <a className="mail-project" href={`#/project/${m.cancion.id}`}>
                <Disc3 size={13} aria-hidden="true" /> {m.cancion.nombre}
              </a>
            )}
          </article>
        ))}
      </div>
      {error && (
        <p className="auth-error mail-pad" role="alert">
          {error}
        </p>
      )}
      {data &&
        (data.puedes_escribir ? (
          <form className="mail-form" onSubmit={send}>
            <input value={asunto} onChange={(e) => setAsunto(e.target.value)} maxLength={150} placeholder="Subject" aria-label="Subject" />
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={5000}
              rows={4}
              placeholder={`Write to ${con}…`}
              aria-label="Message"
              onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && send(e)}
            />
            <button className="tbtn accent" type="submit" disabled={busy || !texto.trim()}>
              <Send size={13} aria-hidden="true" /> {busy ? 'Sending…' : 'Send'}
            </button>
          </form>
        ) : (
          <p className="mail-blocked">{data.motivo}</p>
        ))}
    </div>
  )
}

function Compose({ initialTo, project, onSent }) {
  const [para, setPara] = useState(initialTo)
  const [asunto, setAsunto] = useState('')
  const [texto, setTexto] = useState('')
  const [about, setAbout] = useState(null) // { id, nombre } of the attached project
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!project) return
    let live = true
    api.project(project).then(
      (p) => live && (setAbout({ id: p.id, nombre: p.nombre }), setAsunto((s) => s || `About ${p.nombre}`)),
      () => {},
    )
    return () => {
      live = false
    }
  }, [project])

  const send = async (e) => {
    e.preventDefault()
    const name = para.trim()
    if (!name) return setError('Who is it for? Write their username.')
    if (!texto.trim()) return setError('Write your message.')
    setBusy(true)
    setError(null)
    try {
      await api.sendMessage({ para: name, asunto: asunto.trim(), texto: texto.trim(), cancion_id: about?.id ?? null })
      onSent()
      location.hash = `#/messages/${enc(name)}`
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="mail-compose" onSubmit={send}>
      <div className="mail-head">
        <BackToList />
        <b>New message</b>
      </div>
      <div className="auth-body">
        <label>
          To
          <input value={para} onChange={(e) => (setPara(e.target.value), setError(null))} placeholder="username" autoFocus={!initialTo} maxLength={40} />
        </label>
        <label>
          Subject
          <input value={asunto} onChange={(e) => setAsunto(e.target.value)} maxLength={150} placeholder="e.g. Want to make a beat together?" />
        </label>
        {about && (
          <p className="mail-about">
            <Disc3 size={13} aria-hidden="true" /> About <a href={`#/project/${about.id}`}>{about.nombre}</a>
            <button type="button" className="icon small" onClick={() => setAbout(null)} aria-label="Do not attach the project">
              <X size={12} />
            </button>
          </p>
        )}
        <label>
          Message
          <textarea value={texto} onChange={(e) => (setTexto(e.target.value), setError(null))} maxLength={5000} rows={8} autoFocus={Boolean(initialTo)} placeholder="Say what you make and what you would like to do together." />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="tbtn accent big" type="submit" disabled={busy}>
          <Send size={14} aria-hidden="true" /> {busy ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </form>
  )
}

const WHO = [
  ['todos', 'Anyone with an account'],
  ['contactos', 'Only people I work with or wrote to'],
  ['nadie', 'Nobody'],
]

function MailSettings() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    api.messageSettings().then(setData, (e) => setError(e.message))
  }, [])
  const run = async (fn) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    }
  }
  // Answers at once; goes back if the server refuses.
  const setWho = (v) => {
    const before = data
    setData({ ...data, mensajes_de: v })
    run(async () => {
      try {
        setData(await api.setMessageSettings(v))
      } catch (e) {
        setData(before)
        throw e
      }
    })
  }
  const unblock = (nombre) => run(async () => (await api.block(nombre, false), setData({ ...data, bloqueados: data.bloqueados.filter((b) => b !== nombre) })))

  return (
    <div className="mail-settings">
      <div className="mail-head">
        <BackToList />
        <b>Message settings</b>
      </div>
      <div className="mail-pad">
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p className="soc-empty">Loading…</p>}
        {data && (
          <>
            <fieldset className="save-vis">
              <legend>Who can write to you?</legend>
              {WHO.map(([v, label]) => (
                <label key={v} className="check">
                  <input type="radio" name="who" checked={data.mensajes_de === v} onChange={() => setWho(v)} />
                  <span>{label}</span>
                </label>
              ))}
              <p className="fine">People you work with are your collaborators and the people whose projects you collaborate on.</p>
            </fieldset>
            <h3 className="mail-h">Blocked</h3>
            {data.bloqueados.length === 0 ? (
              <p className="fine">Nobody. Block someone from your conversation with them: they will not be able to write to you, nor propose changes to your projects.</p>
            ) : (
              <ul className="collabs">
                {data.bloqueados.map((b) => (
                  <li key={b}>
                    <Avatar name={b} size={26} />
                    <a href={`#/u/${enc(b)}`}>{b}</a>
                    <button className="tbtn" onClick={() => unblock(b)}>
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
