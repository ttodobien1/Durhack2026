import { useEffect, useState } from 'react'
import { Check, FolderOpen, Globe, Lock, X } from 'lucide-react'

/**
 * "Save as" window shown when the user saves a project (after logging in if needed).
 * Step 1 asks for the name and the visibility; step 2 confirms and offers to keep working or open My projects.
 *
 * Props: song (current project), copy (true when saving someone else's project as your own copy),
 * saved (the project returned by the server once saved; switches to step 2),
 * onSave({ nombre, publica }) -> Promise, onClose(), onMyProjects().
 */
export function SaveDialog({ song, copy, saved, onSave, onClose, onMyProjects }) {
  const [nombre, setNombre] = useState(copy ? `${song.nombre} (copy)` : song.nombre)
  const [publica, setPublica] = useState(song.publica !== false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async (e) => {
    e.preventDefault()
    const clean = nombre.trim()
    if (!clean) return setError('Give your project a name.')
    setBusy(true)
    setError(null)
    try {
      await onSave({ nombre: clean, publica })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    const isPublic = saved.publica !== false
    return (
      <div className="window-backdrop" onClick={onClose}>
        <div className="panel window auth save-as" role="dialog" aria-modal="true" aria-labelledby="save-title" onClick={(e) => e.stopPropagation()}>
          <h2 className="title roll-title" id="save-title">
            <span>Project saved</span>
            <button type="button" className="icon small" onClick={onClose} aria-label="Close">
              <X size={13} />
            </button>
          </h2>
          <div className="auth-body">
            <p className="save-done">
              <Check size={16} aria-hidden="true" />
              <span>
                <b>{saved.nombre}</b> is saved as{' '}
                {isPublic ? (
                  <>
                    <b>public</b>: it shows in Explore and on your profile.
                  </>
                ) : (
                  <>
                    <b>private</b>: only you see it in your projects.
                  </>
                )}
              </span>
            </p>
            <div className="save-next">
              <button className="tbtn big" type="button" autoFocus onClick={onClose}>
                Keep working
              </button>
              <button className="tbtn accent big" type="button" onClick={onMyProjects}>
                <FolderOpen size={15} /> Go to My projects
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="window-backdrop" onClick={() => !busy && onClose()}>
      <form className="panel window auth save-as" role="dialog" aria-modal="true" aria-labelledby="save-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="title roll-title" id="save-title">
          <span>{copy ? 'Save a copy as' : 'Save as'}</span>
          <button type="button" className="icon small" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={13} />
          </button>
        </h2>
        <div className="auth-body">
          {copy && <p className="auth-reason">This project belongs to {song.autor}. Saving creates your own copy; theirs stays as it is.</p>}
          <label>
            Project name
            <input autoFocus value={nombre} onChange={(e) => (setNombre(e.target.value), setError(null))} maxLength={80} />
          </label>
          <fieldset className="save-vis">
            <legend>Who can see it?</legend>
            <div className="seg" role="radiogroup" aria-label="Visibility">
              <button type="button" role="radio" aria-checked={publica} className={publica ? 'on' : ''} onClick={() => setPublica(true)}>
                <Globe size={12} aria-hidden="true" /> Public
              </button>
              <button type="button" role="radio" aria-checked={!publica} className={!publica ? 'on' : ''} onClick={() => setPublica(false)}>
                <Lock size={12} aria-hidden="true" /> Private
              </button>
            </div>
            <p className="fine">
              {publica
                ? 'Listed in Explore and on your profile, so others can play it and fork its pieces.'
                : 'Hidden from Explore and from other people’s view of your profile. Only you see it in My projects.'}
            </p>
          </fieldset>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="tbtn accent big" type="submit" disabled={busy}>
            {busy ? 'Saving…' : publica ? 'Save as public' : 'Save as private'}
          </button>
        </div>
      </form>
    </div>
  )
}
