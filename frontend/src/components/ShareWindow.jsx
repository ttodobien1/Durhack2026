import { useEffect, useState } from 'react'
import { Check, Copy, GitFork, GitPullRequestArrow, HandHelping, Link, RefreshCw, UserMinus, Users, X } from 'lucide-react'
import { api } from '../api.js'
import { isMine } from '../profile.js'
import { Avatar } from '../Site.jsx'
import { timeAgo } from './Comments.jsx'
import '../social.css'

const inviteUrl = (token) => `${location.origin}${location.pathname}#/invite/${token}`
const until = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })

/**
 * "Share" window of a saved project (cambios.md §14):
 *   Collaborators   who works on it, the invitation link (author), remove a collaborator / leave the project
 *   Reuse           (author, public projects) may others save a copy? propose changes?
 *   Ask for ideas   (author, public projects) a help request shown on the home page
 * Props: song, meta ({ permite_fork, permite_propuestas, pide_ayuda }), role ('autor' | 'colaborador'),
 * onMeta(project from the server) after a setting changes, onLeft() after leaving the project, onClose().
 */
export function ShareWindow({ song, meta, role, onMeta, onLeft, onClose }) {
  const author = role === 'autor'
  const [data, setData] = useState(null) // { colaboradores, invitacion }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // what is being saved
  const [copied, setCopied] = useState(false)
  const [ask, setAsk] = useState(meta.pide_ayuda ?? '')
  // The two switches answer at once and go back if the server refuses.
  const [flags, setFlags] = useState({ permite_fork: meta.permite_fork, permite_propuestas: meta.permite_propuestas })

  useEffect(() => {
    let live = true
    api.collaborators(song.id).then(
      (d) => live && setData(d),
      (e) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [song.id])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (what, fn) => {
    setBusy(what)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }
  const setting = (patch) => run(Object.keys(patch)[0], async () => onMeta(await api.setProjectSettings(song.id, patch)))
  const toggle = async (key, value) => {
    const before = flags
    setFlags({ ...flags, [key]: value })
    setError(null)
    try {
      onMeta(await api.setProjectSettings(song.id, { [key]: value }))
    } catch (e) {
      setFlags(before)
      setError(e.message)
    }
  }
  const newLink = () => run('link', async () => setData({ ...data, invitacion: await api.createInvite(song.id) }))
  const linkOff = () => run('link', async () => (await api.deleteInvite(song.id), setData({ ...data, invitacion: null })))
  const remove = (nombre) =>
    run(nombre, async () => {
      await api.removeCollaborator(song.id, nombre)
      if (isMine(nombre)) return onLeft()
      setData({ ...data, colaboradores: data.colaboradores.filter((c) => c.nombre !== nombre) })
    })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(data.invitacion.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy automatically: select the link and copy it.')
    }
  }
  const isPublic = song.publica !== false

  return (
    <div className="window-backdrop" onClick={onClose}>
      <section className="panel window social" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="title roll-title" id="share-title">
          <span>
            <Users size={13} aria-hidden="true" /> Share <span className="dim">· {song.nombre}</span>
          </span>
          <button className="icon small" onClick={onClose} aria-label="Close">
            <X size={13} />
          </button>
        </h2>
        <div className="soc-body">
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <section className="share-sec">
            <h3>Collaborators</h3>
            <p className="fine">Collaborators open and edit this project with you, even while it is private. Every save is credited to whoever made it.</p>
            <ul className="collabs">
              <li>
                <Avatar name={song.autor} size={26} />
                <a href={`#/u/${encodeURIComponent(song.autor)}`}>{song.autor}</a>
                <span className="role-tag">Author</span>
              </li>
              {!data && !error && <li className="dim">Loading…</li>}
              {data?.colaboradores.map((c) => (
                <li key={c.nombre}>
                  <Avatar name={c.nombre} size={26} />
                  <a href={`#/u/${encodeURIComponent(c.nombre)}`}>{c.nombre}</a>
                  <span className="dim">joined {timeAgo(c.desde)}</span>
                  {(author || isMine(c.nombre)) && (
                    <button className="tbtn" onClick={() => remove(c.nombre)} disabled={busy === c.nombre}>
                      <UserMinus size={13} aria-hidden="true" /> {isMine(c.nombre) ? 'Leave project' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {author && data && (
              <div className="invite">
                <h4>
                  <Link size={13} aria-hidden="true" /> Invitation link
                </h4>
                {data.invitacion ? (
                  <>
                    <div className="invite-link">
                      <input readOnly value={inviteUrl(data.invitacion.token)} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
                      <button className="tbtn accent" onClick={copy}>
                        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="fine">
                      Works until {until.format(new Date(data.invitacion.expira))}. Whoever opens it and logs in joins as a collaborator. Send it in a{' '}
                      <a href="#/messages">message</a> or anywhere you like.
                    </p>
                    <div className="row-btns">
                      <button className="tbtn" onClick={newLink} disabled={busy === 'link'}>
                        <RefreshCw size={13} aria-hidden="true" /> New link
                      </button>
                      <button className="tbtn" onClick={linkOff} disabled={busy === 'link'}>
                        Turn the link off
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="tbtn accent" onClick={newLink} disabled={busy === 'link'}>
                    <Link size={13} aria-hidden="true" /> Create an invitation link
                  </button>
                )}
              </div>
            )}
          </section>

          {author && (
            <section className="share-sec">
              <h3>What others can do</h3>
              {!isPublic && <p className="fine">The project is private: only you and your collaborators see it. These apply once it is public.</p>}
              <label className="check">
                <input type="checkbox" checked={flags.permite_fork} onChange={(e) => toggle('permite_fork', e.target.checked)} />
                <span>
                  <b>
                    <GitFork size={13} aria-hidden="true" /> Anyone can save their own copy
                  </b>
                  <small>A fork, credited to you, that they change as they like.</small>
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={flags.permite_propuestas} onChange={(e) => toggle('permite_propuestas', e.target.checked)} />
                <span>
                  <b>
                    <GitPullRequestArrow size={13} aria-hidden="true" /> Anyone can propose changes
                  </b>
                  <small>Like a pull request: you review their changes note by note and merge them, or decline.</small>
                </span>
              </label>
            </section>
          )}

          {author && (
            <section className="share-sec">
              <h3>
                <HandHelping size={14} aria-hidden="true" /> Ask the community for ideas
              </h3>
              {isPublic ? (
                <>
                  <p className="fine">Stuck on this song? Your question shows on the home page, and people answer in the project comments.</p>
                  <textarea value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={500} rows={3} placeholder="e.g. I have the drums and chords but no idea for the hook. How would you continue?" />
                  <div className="row-btns">
                    <button className="tbtn accent" disabled={!ask.trim() || ask.trim() === meta.pide_ayuda || busy === 'pide_ayuda'} onClick={() => setting({ pide_ayuda: ask.trim() })}>
                      {meta.pide_ayuda ? 'Update the request' : 'Post on the home page'}
                    </button>
                    {meta.pide_ayuda && (
                      <button className="tbtn" disabled={busy === 'pide_ayuda'} onClick={() => (setAsk(''), setting({ pide_ayuda: null }))}>
                        Remove the request
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="fine">Make the project public first: the community can only help with what it can hear.</p>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  )
}
