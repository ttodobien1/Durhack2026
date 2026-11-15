import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { api, currentUser } from './api.js'
import App from './App.jsx'
import { confirmLeave } from './leave.js'
import { Invite } from './Invite.jsx'
import { Landing } from './Landing.jsx'
import { Messages } from './Messages.jsx'
import { Profile } from './Profile.jsx'
import { cacheProfile } from './profile.js'
import { Settings } from './Settings.jsx'
import { Upload } from './Upload.jsx'

// Check the stored login once per visit: an expired session signs out; a valid one refreshes the profile copy.
api.me().then((perfil) => {
  const user = currentUser()
  try {
    if (user && perfil) cacheProfile(user.name, perfil)
  } catch {
    /* storage full: profile pages load it from the server */
  }
})

// Hash routes: "#/" landing, "#/project/<id>" project page ("new" = empty project), "#/u/<name>" profile, "#/settings", "#/upload",
// "#/messages[/<name>]" messages, "#/invite/<token>" invitation to collaborate on a project.
const decode = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s // malformed %-escape: use the raw name
  }
}

function Root() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onHash = (e) => {
      // Leaving a project with unsaved changes (a link, Back / Forward): ask, and on "stay" put its address back.
      const project = (url) => new URL(url).hash.match(/^#\/project\/([\w-]+)/)?.[1]
      if (project(e.oldURL) && project(e.oldURL) !== project(e.newURL) && !confirmLeave()) return history.pushState(null, '', e.oldURL)
      setHash(location.hash)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const id = hash.match(/^#\/project\/([\w-]+)/)?.[1]
  const user = hash.match(/^#\/u\/([^#?]+)/)?.[1]
  const mail = hash.match(/^#\/messages(?:\/([^?#]+))?/)
  const invite = hash.match(/^#\/invite\/([\w-]+)/)?.[1]
  if (id) return <App key={id} projectId={id} />
  if (user) return <Profile key={user} name={decode(user)} />
  if (mail) {
    const q = new URLSearchParams(hash.split('?')[1] ?? '')
    return <Messages con={mail[1] ? decode(mail[1]) : null} compose={q.has('to')} to={q.get('to')} project={q.get('project')} settings={q.has('ajustes')} />
  }
  if (invite) return <Invite key={invite} token={invite} />
  if (hash.startsWith('#/settings')) return <Settings />
  if (hash.startsWith('#/upload')) return <Upload />
  return <Landing />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
