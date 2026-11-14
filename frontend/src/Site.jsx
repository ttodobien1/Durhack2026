import { useEffect, useState } from 'react'
import { LogOut, Settings, X } from 'lucide-react'
import { StemmaMark } from './App.jsx'
import { loadProfile } from './profile.js'
import './landing.css'

/** Site header for the landing, profile and settings pages. `onUser(null)` signs out. */
export function SiteBar({ user, onUser }) {
  const [auth, setAuth] = useState(null) // 'login' | 'signup' | null
  return (
    <header className="toolbar site-bar">
      <a className="brand" href="#/">
        <StemmaMark />
        <span>Stemma</span>
      </a>
      <nav className="site-nav" aria-label="Main">
        <a href="#explore">Explore</a>
        <a href="#/project/new">New project</a>
      </nav>
      <div className="spacer" />
      {user ? (
        <div className="user">
          <a className="user-link" href={`#/u/${encodeURIComponent(user.name)}`} title="Your profile">
            <Avatar name={user.name} size={24} />
            <span>{user.name}</span>
          </a>
          <a className="icon" href="#/settings" aria-label="Profile settings" title="Profile settings">
            <Settings size={14} />
          </a>
          <button className="icon" onClick={() => onUser(null)} aria-label="Log out" title="Log out">
            <LogOut size={14} />
          </button>
        </div>
      ) : (
        <>
          <button className="tbtn" onClick={() => setAuth('login')}>
            Log in
          </button>
          <button className="tbtn accent" onClick={() => setAuth('signup')}>
            Sign up
          </button>
        </>
      )}
      {auth && (
        <AuthDialog
          mode={auth}
          onMode={setAuth}
          onClose={() => setAuth(null)}
          onDone={(u) => {
            onUser(u)
            setAuth(null)
          }}
        />
      )}
    </header>
  )
}

/** Profile picture, or the initial on the profile's accent colour. Without `size`, CSS sizes it. */
export function Avatar({ name, size, profile = loadProfile(name), className = '' }) {
  return profile.avatar ? (
    <img className={`avatar ${className}`} src={profile.avatar} alt="" width={size} height={size} />
  ) : (
    <span className={`avatar ac-${profile.accent} ${className}`} style={size && { width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {name[0]?.toUpperCase()}
    </span>
  )
}

export function AuthDialog({ mode, onMode, onClose, onDone }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const signup = mode === 'signup'

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (e) => {
    e.preventDefault()
    const clean = name.trim()
    if (!/^[\w-]{2,24}$/.test(clean)) return setError('Use 2–24 letters, numbers, dashes or underscores.')
    if (signup && !/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.')
    onDone({ name: clean }) // the name only; the password is never kept
  }

  return (
    <div className="window-backdrop" onClick={onClose}>
      <form className="panel window auth" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="title roll-title" id="auth-title">
          <span>{signup ? 'Create your account' : 'Log in to Stemma'}</span>
          <button type="button" className="icon small" onClick={onClose} aria-label="Close">
            <X size={13} />
          </button>
        </h2>
        <div className="auth-body">
          <label>
            Username
            <input autoFocus value={name} onChange={(e) => (setName(e.target.value), setError(null))} autoComplete="username" />
          </label>
          {signup && (
            <label>
              Email
              <input type="email" value={email} onChange={(e) => (setEmail(e.target.value), setError(null))} autoComplete="email" />
            </label>
          )}
          <label>
            Password
            <input type="password" autoComplete={signup ? 'new-password' : 'current-password'} />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="tbtn accent big" type="submit">
            {signup ? 'Sign up' : 'Log in'}
          </button>
          <p className="fine">
            Hackathon demo: your username stays in this browser and nothing is sent anywhere.{' '}
            <button type="button" className="link" onClick={() => onMode(signup ? 'login' : 'signup')}>
              {signup ? 'Already have an account? Log in' : 'New here? Sign up'}
            </button>
          </p>
        </div>
      </form>
    </div>
  )
}
