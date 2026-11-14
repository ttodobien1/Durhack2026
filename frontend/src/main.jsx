import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Landing } from './Landing.jsx'

// Hash routes: "#/" landing, "#/project/<id>" project page ("new" = empty project).
function Root() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const id = hash.match(/^#\/project\/([\w-]+)/)?.[1]
  return id ? <App key={id} projectId={id} /> : <Landing />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
