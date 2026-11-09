import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installBrowserZoomGuard } from './browserZoom'

const removeBrowserZoomGuard = installBrowserZoomGuard(window)
if (import.meta.hot) import.meta.hot.dispose(removeBrowserZoomGuard)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
