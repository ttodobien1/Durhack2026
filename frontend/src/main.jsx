import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Landing } from './Landing.jsx'
import { Profile } from './Profile.jsx'
import { Settings } from './Settings.jsx'

// Hash routes: "#/" landing, "#/project/<id>" project page ("new" = empty project), "#/u/<name>" profile, "#/settings".
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
  return <Landing />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
