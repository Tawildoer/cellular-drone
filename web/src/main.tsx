import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './app/providers'
import { AppShell } from './app/AppShell'
import { DesktopUpdatePrompt } from './app/DesktopUpdatePrompt'
import { preventPagePinchZoom } from './app/preventPagePinchZoom'
import './index.css'

// A pinch anywhere should zoom the map, never magnify the whole console.
preventPagePinchZoom()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <AppShell />
      <DesktopUpdatePrompt />
    </AppProviders>
  </StrictMode>,
)
