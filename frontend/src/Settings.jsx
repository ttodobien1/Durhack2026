import { useEffect, useState } from 'react'
import { ArrowRight, Check, Trash2, Upload, User } from 'lucide-react'
import { api } from './api.js'
import { AuthDialog, Avatar, SiteBar } from './Site.jsx'
import { ACCENTS, authorsFor, loadProfile, saveProfile, useUser } from './profile.js'
import { renderMarkdown } from './markdown.js'
import './profile.css'

const MAX_PINS = 6
const README_HINT = 'Markdown: # headings, **bold**, *italic*, - lists, [links](https://…), `code`'

/** Center-crop an image file to a small square JPEG data URL, so it fits in browser storage. */
function toAvatar(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size })
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('That file is not an image this browser can read.'))
    img.src = URL.createObjectURL(file)
  })
}

export function Settings() {
  const [user, setUser] = useUser()
  const name = user?.name
  const [form, setForm] = useState(() => name && loadProfile(name))
  const [projects, setProjects] = useState([])
  const [status, setStatus] = useState(null) // { ok, text }
  const [preview, setPreview] = useState(false)
  const [auth, setAuth] = useState(null)

  useEffect(() => {
    setForm(name && loadProfile(name))
    if (name) Promise.all(authorsFor(name).map((a) => api.projects(a))).then((lists) => setProjects(lists.flat()), () => setProjects([]))
  }, [name])
  useEffect(() => {
    if (form && location.hash.endsWith('#readme')) document.getElementById('readme')?.scrollIntoView()
  }, [form])

  if (!form)
    return (
      <div className="site">
        <SiteBar user={user} onUser={setUser} />
        <main className="settings-out panel">
          <User size={28} aria-hidden="true" />
          <h1>Log in to customize your profile</h1>
          <p>Your picture, bio, README and pinned projects are kept in this browser under your username.</p>
          <div className="hero-cta">
            <button className="tbtn accent big" onClick={() => setAuth('login')}>
              Log in
            </button>
            <button className="tbtn big" onClick={() => setAuth('signup')}>
              Sign up
            </button>
          </div>
        </main>
        {auth && <AuthDialog mode={auth} onMode={setAuth} onClose={() => setAuth(null)} onDone={(u) => (setUser(u), setAuth(null))} />}
      </div>
    )

  const update = (patch) => {
    setForm({ ...form, ...patch })
    setStatus(null)
  }
  const field = (k) => ({ value: form[k], onChange: (e) => update({ [k]: e.target.value }) })
  const togglePin = (id) => update({ pinned: form.pinned.includes(id) ? form.pinned.filter((x) => x !== id) : [...form.pinned, id] })

  const upload = async (e) => {
    const file = e.target.files[0]
    e.target.value = '' // picking the same file again still fires change
    if (!file) return
    try {
      update({ avatar: await toAvatar(file) })
    } catch (err) {
      setStatus({ ok: false, text: err.message })
    }
  }

  const submit = (e) => {
    e.preventDefault()
    try {
      saveProfile(name, { ...form, displayName: form.displayName.trim(), bio: form.bio.trim(), location: form.location.trim(), website: form.website.trim() })
      setStatus({ ok: true, text: 'Profile updated.' })
    } catch {
      setStatus({ ok: false, text: 'Could not save: this browser’s storage is full or blocked. Try a smaller picture, then save again.' })
    }
  }

  return (
    <div className="site">
      <SiteBar user={user} onUser={setUser} />
      <main className="settings">
        <header className="set-head">
          <Avatar name={name} size={48} profile={form} />
          <div>
            <h1>{form.displayName || name}</h1>
            <span className="dim">Your personal account</span>
          </div>
          <a className="tbtn" href={`#/u/${encodeURIComponent(name)}`}>
            Go to your profile <ArrowRight size={13} />
          </a>
        </header>

        <nav className="set-nav" aria-label="Settings">
          <a className="on" href="#/settings" aria-current="page">
            <User size={15} aria-hidden="true" /> Public profile
          </a>
        </nav>

        <form className="set-form" onSubmit={submit}>
          <h2 className="set-title">Public profile</h2>
          <div className="set-cols">
            <div className="set-fields">
              <label>
                Name
                <input {...field('displayName')} maxLength={40} placeholder={name} />
                <small>Shown above your username on your profile.</small>
              </label>
              <label>
                Bio
                <textarea {...field('bio')} maxLength={160} rows={3} placeholder="Tell other composers what you make" />
                <small>{160 - form.bio.length} characters left</small>
              </label>
              <label>
                Website
                <input {...field('website')} maxLength={100} placeholder="https://" inputMode="url" />
              </label>
              <label>
                Location
                <input {...field('location')} maxLength={40} placeholder="Durham, UK" />
              </label>
            </div>

            <fieldset className="set-picture">
              <legend>Profile picture</legend>
              <Avatar name={name} size={180} profile={form} />
              <div className="set-picture-actions">
                <label className="tbtn">
                  <Upload size={13} aria-hidden="true" /> Upload a photo
                  <input type="file" accept="image/*" onChange={upload} className="visually-hidden" />
                </label>
                {form.avatar && (
                  <button type="button" className="tbtn" onClick={() => update({ avatar: null })}>
                    <Trash2 size={13} aria-hidden="true" /> Remove
                  </button>
                )}
              </div>
            </fieldset>
          </div>

          <fieldset className="set-accent">
            <legend>Accent colour</legend>
            <p className="fine">Used for your contribution graph and your initial when you have no picture.</p>
            <div className="swatches">
              {Object.entries(ACCENTS).map(([key, color]) => (
                <label key={key} className="swatch" style={{ '--sw': color }} title={key}>
                  <input type="radio" name="accent" value={key} checked={form.accent === key} onChange={() => update({ accent: key })} aria-label={key} />
                  <Check size={14} aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>

          <section className="set-readme" id="readme">
            <h3>Profile README</h3>
            <div className="panel readme-editor">
              <div className="seg" role="tablist" aria-label="README editor">
                <button type="button" role="tab" aria-selected={!preview} className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>
                  Write
                </button>
                <button type="button" role="tab" aria-selected={preview} className={preview ? 'on' : ''} onClick={() => setPreview(true)}>
                  Preview
                </button>
              </div>
              {preview ? (
                <div className="md readme-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(form.readme) || '<p class="dim">Nothing to preview.</p>' }} />
              ) : (
                <textarea
                  {...field('readme')}
                  rows={12}
                  maxLength={5000}
                  aria-label="Profile README"
                  placeholder={`## Hi, I'm ${name}\n\nI make boom bap drums and lo-fi chords. Fork anything you like.`}
                />
              )}
            </div>
            <small className="fine">{README_HINT}</small>
          </section>

          <fieldset className="set-pins">
            <legend>Pinned projects</legend>
            <p className="fine">
              Pick up to {MAX_PINS} for the top of your profile ({form.pinned.length} of {MAX_PINS}). Without pins your biggest projects show.
            </p>
            {projects.length === 0 ? (
              <p className="fine">
                You have no saved projects yet. <a href="#/project/new">Start one</a>.
              </p>
            ) : (
              <ul>
                {projects.map((p) => (
                  <li key={p.id}>
                    <label>
                      <input type="checkbox" checked={form.pinned.includes(p.id)} disabled={!form.pinned.includes(p.id) && form.pinned.length >= MAX_PINS} onChange={() => togglePin(p.id)} />
                      {p.nombre} <span className="dim">{p.id}{p.publica === false && ' · private'}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <div className="set-save">
            <button className="tbtn accent big" type="submit">
              Update profile
            </button>
            {status && (
              <p className={status.ok ? 'set-ok' : 'auth-error'} role={status.ok ? 'status' : 'alert'}>
                {status.ok && <Check size={14} aria-hidden="true" />} {status.text}{' '}
                {status.ok && <a href={`#/u/${encodeURIComponent(name)}`}>View profile</a>}
              </p>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}
