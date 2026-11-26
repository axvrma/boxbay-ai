import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Box, MapPin } from 'lucide-react'
import Demo from './pages/Demo'
import { loadAssets } from './intelligence/inference'
import './style.css'

const Engineering = lazy(() => import('./pages/Engineering'))
type Assets = Awaited<ReturnType<typeof loadAssets>>

function App() {
  const [assets, setAssets] = useState<Assets>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void loadAssets().then((next) => { if (active) setAssets(next) }).catch((problem: unknown) => {
      if (active) setError(problem instanceof Error ? problem.message : String(problem))
    })
    return () => { active = false }
  }, [attempt])
  return <>
    <a href="#workspace" className="skip-link">Skip to workspace</a>
    <header className="app-header">
      <NavLink className="brand" to="/"><span className="brand-mark"><Box size={22}/></span>
        <span><strong>BOXBAY <em>AI</em></strong><small>Predictive Storage Intelligence</small></span></NavLink>
      <div className="location"><MapPin size={16}/> Jebel Ali, Dubai</div>
      <nav aria-label="Main navigation"><NavLink end to="/">Live demo</NavLink><NavLink to="/engineering">Engineering</NavLink></nav>
    </header>
    <main id="workspace">
      {error ? <div className="status-screen" role="alert"><h1>Model assets unavailable</h1><p>{error}</p>
        <button className="button" onClick={() => { setError(''); setAttempt(attempt+1) }}>Try again</button></div>
        : assets ? <Suspense fallback={<div className="status-screen" role="status">Opening engineering workspace…</div>}>
          <Routes>
            <Route path="/" element={<Demo {...assets}/>}/>
            <Route path="/engineering" element={<Engineering {...assets}/>}/>
            <Route path="*" element={<Navigate to="/" replace/>}/>
          </Routes>
        </Suspense> : <div className="status-screen" role="status">Loading facility and trained models…</div>}
    </main>
    <footer className="site-footer"><span>Independent proof of concept · Synthetic operational data · Simulated facility</span>
      <a href="https://axvrma.com">axvrma.com</a></footer>
  </>
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>)
