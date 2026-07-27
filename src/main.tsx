import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyBuildStampToTitle, buildLabelLong } from './build-info'

// Which commit is this binary? The user runs the DEPLOYED AppImage, so a change
// that was never rebuilt is invisible — stamping the title makes that condition
// self-evident in every screenshot. Logged too, so it lands in any captured
// console output attached to a bug report.
applyBuildStampToTitle()
console.info(`[build] ${buildLabelLong()}`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
