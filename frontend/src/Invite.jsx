// "#/invite/<token>": the page an invitation link opens (cambios.md §14). Logged in, one click joins the project as a
// collaborator, even when it is private.
import { useEffect, useState } from 'react'
import { Disc3, Lock, UserPlus, Users } from 'lucide-react'
import { api } from './api.js'
import { useUser } from './profile.js'
import { AuthDialog, Avatar, SiteBar } from './Site.jsx'
import './social.css'

const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })

export function Invite({ token }) {
  const [user, setUser] = useUser()
  const [info, setInfo] = useState(null) // { cancion, expira, rol }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [auth, setAuth] = useState(null) // 'login' | 'signup'

  useEffect(() => {
    let live = true
    api.invite(token).then(
      (d) => live && setInfo(d),
      (e) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [token, user?.name])

  const join = async () => {
    setBusy(true)
    setError(null)
    try {
      const { cancion_id } = await api.acceptInvite(token)
      location.hash = `#/project/${cancion_id}`
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const c = info?.cancion
  return (
    <div className="site">
      <SiteBar user={user} onUser={setUser} />
      <main>
        <section className="panel invite-card">
          <h1 className="title">
            <Users size={13} aria-hidden="true" /> Invitation to collaborate
          </h1>
          <div className="auth-body">
            {!info && !error && <p className="soc-empty">Opening the invitation…</p>}
            {error && !info && <p className="auth-error">{error}</p>}
            {c && (
              <>
                <div className="invite-who">
                  <Avatar name={c.autor} size={44} />
                  <p>
                    <b>{c.autor}</b> invites you to work on
                    <br />
                    <span className="invite-project">
                      <Disc3 size={15} aria-hidden="true" /> {c.nombre}
                      {c.publica === false && (
                        <span className="public private">
                          <Lock size={10} aria-hidden="true" /> Private
                        </span>
                      )}
                    </span>
                  </p>
                </div>
                <p className="fine">
                  As a collaborator you open and edit this project{c.publica === false ? ', even though it is private' : ''}, and each of your saves is credited to you.
                  The link works until {day.format(new Date(info.expira))}.
                </p>
                {error && <p className="auth-error">{error}</p>}
                {info.rol ? (
                  <a className="tbtn accent big" href={`#/project/${c.id}`}>
                    You are already in it: open the project
                  </a>
                ) : user ? (
                  <button className="tbtn accent big" onClick={join} disabled={busy}>
                    <UserPlus size={15} aria-hidden="true" /> {busy ? 'Joining…' : `Join as ${user.name}`}
                  </button>
                ) : (
                  <div className="row-btns">
                    <button className="tbtn accent big" onClick={() => setAuth('login')}>
                      Log in to join
                    </button>
                    <button className="tbtn big" onClick={() => setAuth('signup')}>
                      Create an account
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
      {auth && (
        <AuthDialog
          mode={auth}
          reason="Log in to join this project."
          onMode={setAuth}
          onClose={() => setAuth(null)}
          onDone={(u) => {
            setUser(u)
            setAuth(null)
          }}
        />
      )}
    </div>
  )
}
