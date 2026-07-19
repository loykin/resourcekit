import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const NativeResizeObserver = window.ResizeObserver
window.ResizeObserver = class extends NativeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super((entries, observer) => {
      // GridKit and ChartKit can resize during observation; deferring their
      // callbacks prevents Chromium's benign loop warning from opening Vite's error overlay.
      requestAnimationFrame(() => callback(entries, observer))
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
