import { useEffect, useState } from 'react'
import { GitPullRequestArrow, X } from 'lucide-react'
import '../social.css'

/**
 * "Propose changes" window, like opening a pull request (cambios.md §14).
 * Props: target ({ nombre, autor }: the project that would receive the changes), fromFork (true: the changes are
 * your saved copy; false: your unsaved edits of their project, saved as a new private copy),
 * onPropose({ titulo, mensaje }) -> Promise, onClose().
 */
export function ProposeDialog({ target, fromFork, onPropose, onClose }) {
  const [titulo, setTitulo] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async (e) => {
    e.preventDefault()
    if (!titulo.trim()) return setError('Give your proposal a title.')
    setBusy(true)
    setError(null)
    try {
      await onPropose({ titulo: titulo.trim(), mensaje: mensaje.trim() })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="window-backdrop" onClick={() => !busy && onClose()}>
      <form className="panel window auth save-as" role="dialog" aria-modal="true" aria-labelledby="propose-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="title roll-title" id="propose-title">
          <span>
            <GitPullRequestArrow size={13} aria-hidden="true" /> Propose changes to {target.nombre}
          </span>
          <button type="button" className="icon small" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={13} />
          </button>
        </h2>
        <div className="auth-body">
          <p className="auth-reason">
            {target.autor} reviews your changes note by note and can merge them into their project.{' '}
            {fromFork
              ? 'The proposal carries your copy as it is saved now; if you save it again, they see the new version.'
              : 'Your edits are kept in a private copy of yours that only you and the project’s people can open. Keep editing and saving it: they always see its latest version.'}
          </p>
          <label>
            Title
            <input autoFocus value={titulo} onChange={(e) => (setTitulo(e.target.value), setError(null))} maxLength={120} placeholder="e.g. A walking bass under the chorus" />
          </label>
          <label>
            <span>
              Message <span className="dim">(optional)</span>
            </span>
            <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={2000} rows={4} placeholder="What you changed and why it works." />
          </label>
          <p className="fine">The pieces you used must be public, so {target.autor} can hear them. {target.autor} also gets a message about it.</p>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="tbtn accent big" type="submit" disabled={busy}>
            <GitPullRequestArrow size={15} aria-hidden="true" /> {busy ? 'Sending…' : 'Send proposal'}
          </button>
        </div>
      </form>
    </div>
  )
}
