import { useEffect, useState } from 'react'
import { LogOut, Mail, Settings, X } from 'lucide-react'
import { api } from './api.js'
import { cacheProfile, loadProfile } from './profile.js'
import { exploreClick } from './explore.js'
import { useUnread } from './unread.js'
import './landing.css'

/** Site header for the landing, profile and settings pages. `onUser(null)` signs out. */
export function SiteBar({ user, onUser }) {
  const [auth, setAuth] = useState(null) // 'login' | 'signup' | null
  const unread = useUnread(user)
  const [thenProjects, setThenProjects] = useState(false) // My projects asked for a login first
  const myProjects = (name) => (location.hash = `#/u/${encodeURIComponent(name)}?tab=projects`)
  return (
    <header className="toolbar site-bar">
      <a className="brand" href="#/">
        <StemmaMark />
        <span>Stemma</span>
      </a>
      <nav className="site-nav" aria-label="Main">
        <a href="#explore" onClick={exploreClick}>
          Explore
        </a>
        <a href="#/project/new">New project</a>
        <a href="#/upload">Upload</a>
        <a href="#/map">Sound map</a>
        {user ? (
          <>
            <a href={`#/u/${encodeURIComponent(user.name)}?tab=projects`}>My projects</a>
            <a href="#/messages" aria-label={`Messages${unread ? `, ${unread} unread` : ''}`}>
              Messages{unread > 0 && <span className="nav-badge">{unread}</span>}
            </a>
          </>
        ) : (
          <button
            className="site-link"
            onClick={() => {
              setThenProjects(true)
              setAuth('login')
            }}
          >
            My projects
          </button>
        )}
      </nav>
      <div className="spacer" />
      {user ? (
        <div className="user">
          {/* the nav hides on narrow screens: the envelope keeps Messages reachable */}
          <a className="icon mail-link narrow-only" href="#/messages" aria-label={`Messages${unread ? `, ${unread} unread` : ''}`} title="Messages">
            <Mail size={14} />
            {unread > 0 && <span className="nav-badge">{unread}</span>}
          </a>
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
          reason={thenProjects ? 'Log in to see your projects.' : undefined}
          onMode={setAuth}
          onClose={() => {
            setAuth(null)
            setThenProjects(false)
          }}
          onDone={(u) => {
            onUser(u)
            setAuth(null)
            if (thenProjects) myProjects(u.name)
            setThenProjects(false)
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

export function AuthDialog({ mode, onMode, onClose, onDone, reason }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup'

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    const clean = name.trim()
    if (signup && !/^[\w-]{2,24}$/.test(clean)) return setError('Use 2–24 letters, numbers, dashes or underscores.')
    if (!signup && !clean) return setError('Enter your username or email.')
    if (signup && !/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.')
    if (signup ? password.length < 6 : !password) return setError(signup ? 'Use at least 6 characters for the password.' : 'Enter your password.')
    setBusy(true)
    try {
      const { user, perfil } = signup
        ? await api.register({ nombre: clean, email: email.trim(), password })
        : await api.login({ usuario: clean, password })
      try {
        if (Object.keys(perfil).length) cacheProfile(user.name, perfil)
      } catch {
        /* storage full: the profile loads from the server instead */
      }
      onDone(user)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  const edit = (set) => (e) => (set(e.target.value), setError(null))

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
          {reason && <p className="auth-reason">{reason}</p>}
          <label>
            {signup ? 'Username' : 'Username or email'}
            <input autoFocus value={name} onChange={edit(setName)} autoComplete="username" />
          </label>
          {signup && (
            <label>
              Email
              <input type="email" value={email} onChange={edit(setEmail)} autoComplete="email" />
            </label>
          )}
          <label>
            Password
            <input type="password" value={password} onChange={edit(setPassword)} autoComplete={signup ? 'new-password' : 'current-password'} />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="tbtn accent big" type="submit" disabled={busy}>
            {busy ? 'One moment…' : signup ? 'Sign up' : 'Log in'}
          </button>
          <p className="fine">
            Your account lives on Stemma’s server; the password is stored only as a secure hash.{' '}
            <button type="button" className="link" onClick={() => onMode(signup ? 'login' : 'signup')}>
              {signup ? 'Already have an account? Log in' : 'New here? Sign up'}
            </button>
          </p>
        </div>
      </form>
    </div>
  )
}

export function StemmaMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3v8a4 4 0 0 0 4 4h2M5 11a4 4 0 0 1 4-4h4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="5" cy="3" r="2" fill="currentColor" />
      <circle cx="15" cy="7" r="2.5" fill="var(--orange)" />
      <circle cx="13" cy="15" r="2.5" fill="var(--note)" />
    </svg>
  )
}
