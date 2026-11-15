import { useEffect, useState } from 'react'
import { HandHelping, MessageSquare, Trash2, X } from 'lucide-react'
import { api } from '../api.js'
import { isMine } from '../profile.js'
import { Avatar } from '../Site.jsx'
import '../social.css'

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function timeAgo(iso) {
  const s = (new Date(iso) - Date.now()) / 1000
  if (Math.abs(s) < 60) return 'just now'
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}

/**
 * Comments window of a project or a piece (cambios.md §14).
 * Props: objetivo ('cancion' | 'pieza'), id, title, owner (author of the project / piece: may delete any comment),
 * ask (the project's open help request, shown on top), onNeedLogin(then) -> boolean (true when logged in),
 * onCount(n) after the list changes, onClose().
 */
export function CommentsWindow({ objetivo, id, title, owner, ask, onNeedLogin, onCount, onClose }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    api.comments(objetivo, id).then(
      (l) => live && setList(l),
      (e) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [objetivo, id])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const update = (next) => {
    setList(next)
    onCount?.(next.length)
  }
  const post = async (e) => {
    e.preventDefault()
    const clean = text.trim()
    if (!clean || busy) return
    if (!onNeedLogin(() => {})) return
    setBusy(true)
    setError(null)
    try {
      const c = await api.addComment(objetivo, id, clean)
      update([...(list ?? []), c])
      setText('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (c) => {
    try {
      await api.deleteComment(c.id)
      update(list.filter((x) => x.id !== c.id))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="window-backdrop" onClick={() => !busy && onClose()}>
      <section className="panel window social" role="dialog" aria-modal="true" aria-labelledby="comments-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="title roll-title" id="comments-title">
          <span>
            <MessageSquare size={13} aria-hidden="true" /> Comments <span className="dim">· {title}</span>
          </span>
          <button className="icon small" onClick={onClose} aria-label="Close comments">
            <X size={13} />
          </button>
        </h2>
        <div className="soc-body">
          {ask && (
            <div className="help-ask">
              <HandHelping size={16} aria-hidden="true" />
              <div>
                <b>{owner} is asking for ideas</b>
                <p>{ask}</p>
              </div>
            </div>
          )}
          {!list && !error && <p className="soc-empty">Loading comments…</p>}
          {list?.length === 0 && (
            <p className="soc-empty">{ask ? 'No ideas yet. Be the first to help.' : `No comments yet. Say what you like about this ${objetivo === 'cancion' ? 'project' : 'piece'}, or how you would use it.`}</p>
          )}
          {list?.length > 0 && (
            <ul className="comments">
              {list.map((c) => (
                <li key={c.id} className="comment">
                  <Avatar name={c.autor} size={28} />
                  <div>
                    <div className="comment-head">
                      <a href={`#/u/${encodeURIComponent(c.autor)}`}>{c.autor}</a>
                      <span className="dim">{timeAgo(c.fecha)}</span>
                      {(isMine(c.autor) || isMine(owner)) && (
                        <button className="icon small" onClick={() => remove(c)} aria-label="Delete comment" title="Delete comment">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    <p className="comment-text">{c.texto}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form className="comment-form" onSubmit={post}>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={3}
            aria-label="Write a comment"
            placeholder={ask ? 'Share an idea: a groove to try, a chord change, a piece that would fit…' : 'Write a comment…'}
            onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && post(e)}
          />
          <button className="tbtn accent" type="submit" disabled={busy || !text.trim()}>
            {busy ? 'Posting…' : ask ? 'Post idea' : 'Comment'}
          </button>
        </form>
      </section>
    </div>
  )
}
