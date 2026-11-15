import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { api, currentUser } from './api.js'
import App from './App.jsx'
import { Landing } from './Landing.jsx'
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

// Hash routes: "#/" landing, "#/project/<id>" project page ("new" = empty project), "#/u/<name>" profile, "#/settings", "#/upload".
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
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const id = hash.match(/^#\/project\/([\w-]+)/)?.[1]
  const user = hash.match(/^#\/u\/([^#?]+)/)?.[1]
  if (id) return <App key={id} projectId={id} />
  if (user) return <Profile key={user} name={decode(user)} />
  if (hash.startsWith('#/settings')) return <Settings />
  if (hash.startsWith('#/upload')) return <Upload />
  return <Landing />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
