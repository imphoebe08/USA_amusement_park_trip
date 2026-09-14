import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Safari can ignore viewport zoom limits; cancel its native pinch gestures too.
const preventGestureZoom = (event: Event) => {
  if (event.cancelable) event.preventDefault()
}
const preventPinchZoom = (event: TouchEvent) => {
  if (event.touches.length > 1 && event.cancelable) event.preventDefault()
}
const preventTrackpadZoom = (event: WheelEvent) => {
  if (event.ctrlKey && event.cancelable) event.preventDefault()
}
document.addEventListener('gesturestart', preventGestureZoom, { passive: false })
document.addEventListener('gesturechange', preventGestureZoom, { passive: false })
document.addEventListener('touchmove', preventPinchZoom, { passive: false })
document.addEventListener('wheel', preventTrackpadZoom, { passive: false })

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    document.removeEventListener('gesturestart', preventGestureZoom)
    document.removeEventListener('gesturechange', preventGestureZoom)
    document.removeEventListener('touchmove', preventPinchZoom)
    document.removeEventListener('wheel', preventTrackpadZoom)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
