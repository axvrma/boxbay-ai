import { lazy, StrictMode, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookOpen, Box, CirclePlay, FlaskConical, KeyRound, LayoutDashboard } from 'lucide-react'
import { Dialog, TokenInput } from './components/Controls'
import { Empty } from './components/UI'
import Command from './pages/Command'
import './style.css'

const Engineering = lazy(() => import('./pages/Engineering'))
const Benchmarks = lazy(() => import('./pages/Benchmarks'))
const ShiftDemo = lazy(() => import('./pages/ShiftDemo'))
const query = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } } })

function App() {
  const [access, setAccess] = useState(false)
  return <>
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="app-header"><div className="shell header-inner">
      <NavLink className="brand" to="/"><span className="brand-icon"><Box size={23}/></span><span>BOXBAY<span className="brand-ai"> AI</span></span></NavLink>
      <nav aria-label="Main navigation">
        <NavLink to="/" end><LayoutDashboard size={16}/> Command center</NavLink>
        <NavLink to="/demo"><CirclePlay size={16}/> Shift demo</NavLink>
        <NavLink to="/engineering"><BookOpen size={16}/> Engineering</NavLink>
        <NavLink to="/benchmarks"><FlaskConical size={16}/> Benchmarks</NavLink>
      </nav>
      <button onClick={() => setAccess(true)} className="access-button" title="Operator access"><KeyRound size={16}/><span>Operator access</span></button>
    </div></header>
    <main className="shell" id="content"><Suspense fallback={<Empty>Loading workspace…</Empty>}><Routes>
      <Route path="/" element={<Command/>}/>
      <Route path="/demo" element={<ShiftDemo/>}/>
      <Route path="/engineering" element={<Engineering/>}/>
      <Route path="/benchmarks" element={<Benchmarks/>}/>
      <Route path="*" element={<Empty>Page unavailable. <NavLink to="/">Open the command center</NavLink></Empty>}/>
    </Routes></Suspense></main>
    <footer className="app-footer"><div className="shell"><span>BOXBAY AI · Independent research demonstrator</span><span>Simulated facility · Version 2.0</span></div></footer>
    {access && <Dialog title="Operator access" close={() => setAccess(false)}><p className="muted">Live experiments and edits use a demo operator token. Recorded replay is available to all viewers.</p><TokenInput/></Dialog>}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={query}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></StrictMode>)
