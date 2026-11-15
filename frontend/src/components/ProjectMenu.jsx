import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, Ellipsis, GitBranch, Globe, History, Lock, Shield } from 'lucide-react'
import { api } from '../api.js'

/** Link that opens a project page (hash routes, so it works on any host). */
const projectUrl = (id) => `${location.origin}${location.pathname}#/project/${id}`

/**
 * "..." options button for one of your projects (My projects). Opens a small menu:
 *   Privacy  switch public / private and share the project's link (this component).
 *   Tree     opens the project with the Tree tab of its history window (onTree prop; disabled without it).
 *   History  opens the project with its version history (onHistory prop; disabled without it).
 *
 * Props: project (Cancion), onChange(patch) after the visibility is saved, onTree?(), onHistory?().
 */
export function ProjectMenu({ project, onChange, onTree, onHistory }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('menu') // 'menu' | 'privacy'
  const ref = useRef(null)

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    setOpen((o) => !o)
    setView('menu')
  }

  return (
    <div className="pmenu" ref={ref}>
      <button className="tbtn pmenu-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Options for ${project.nombre}`} title="Project options">
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="pmenu-pop panel" role={view === 'menu' ? 'menu' : 'dialog'} aria-label={view === 'menu' ? 'Project options' : 'Privacy'}>
          {view === 'menu' ? (
            <>
              <button role="menuitem" className="pmenu-item" autoFocus onClick={() => setView('privacy')}>
                <Shield size={14} aria-hidden="true" /> Privacy
              </button>
              <button role="menuitem" className="pmenu-item" disabled={!onTree} onClick={() => (setOpen(false), onTree())} title={onTree ? undefined : 'Coming soon'}>
                <GitBranch size={14} aria-hidden="true" /> Tree {!onTree && <span className="soon">soon</span>}
              </button>
              <button role="menuitem" className="pmenu-item" disabled={!onHistory} onClick={() => (setOpen(false), onHistory())} title={onHistory ? undefined : 'Coming soon'}>
                <History size={14} aria-hidden="true" /> History {!onHistory && <span className="soon">soon</span>}
              </button>
            </>
          ) : (
            <Privacy project={project} onChange={onChange} onBack={() => setView('menu')} />
          )}
        </div>
      )}
    </div>
  )
}

function Privacy({ project, onChange, onBack }) {
  const isPublic = project.publica !== false
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const url = projectUrl(project.id)

  const setVisibility = async (publica) => {
    if (publica === isPublic || busy) return
    setBusy(true)
    setError(null)
    try {
      // Only contract fields (the list adds descripcion/etiquetas for display).
      const { id, nombre, autor, tempo, pistas } = project
      const saved = await api.saveProject({ id, nombre, autor, tempo, pistas, publica })
      onChange({ publica: saved.publica ?? publica })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy automatically: select the link and copy it.')
    }
  }

  return (
    <div className="pmenu-privacy">
      <div className="pmenu-head">
        <button className="icon small" onClick={onBack} aria-label="Back to options">
          <ArrowLeft size={13} />
        </button>
        <span>Privacy</span>
      </div>
      <div className="seg" role="radiogroup" aria-label="Visibility">
        <button role="radio" aria-checked={isPublic} className={isPublic ? 'on' : ''} disabled={busy} onClick={() => setVisibility(true)}>
          <Globe size={12} aria-hidden="true" /> Public
        </button>
        <button role="radio" aria-checked={!isPublic} className={!isPublic ? 'on' : ''} disabled={busy} onClick={() => setVisibility(false)}>
          <Lock size={12} aria-hidden="true" /> Private
        </button>
      </div>
      <p className="fine">
        {busy ? 'Saving…' : isPublic ? 'Listed in Explore and on your profile.' : 'Hidden from Explore and from other people’s view of your profile.'}
      </p>
      <label className="pmenu-share">
        <span>Share link</span>
        <span className="pmenu-link">
          <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Project link" />
          <button className="tbtn" onClick={copy} aria-label="Copy link">
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </label>
      {!isPublic && <p className="fine">While it is private, the link only opens for you. Make it public to share it.</p>}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
