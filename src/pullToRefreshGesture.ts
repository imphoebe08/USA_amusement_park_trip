export const PULL_THRESHOLD = 72

export function installPullToRefresh({ onProgress, onRefresh }: {
  onProgress: (distance: number) => void
  onRefresh: () => void | Promise<void>
}) {
  let gesture: { id: number; x: number; y: number; distance: number; pulling: boolean } | null = null
  let refreshing = false
  const reset = () => { gesture = null; onProgress(0) }
  const blocked = () => Boolean(document.body.dataset.dragOwner)
  const start = (event: TouchEvent) => {
    if (refreshing) return
    reset()
    if (!matchMedia('(pointer: coarse) and (max-width: 1024px)').matches || event.touches.length !== 1 || window.scrollY > 0 || blocked()) return
    let element = event.target instanceof Element ? event.target : null
    if (element?.closest('button, a, input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
    // A date strip or modal scroll area owns its own gesture.
    while (element && element !== document.body && element !== document.documentElement) {
      const style = getComputedStyle(element)
      if (/(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) return
      element = element.parentElement
    }
    const touch = event.touches[0]
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, distance: 0, pulling: false }
  }
  const move = (event: TouchEvent) => {
    if (!gesture || refreshing) return
    if (blocked() || event.touches.length !== 1 || window.scrollY > 0) { reset(); return }
    const touch = event.touches[0]
    if (touch.identifier !== gesture.id) { reset(); return }
    const dx = touch.clientX - gesture.x
    const dy = touch.clientY - gesture.y
    if (!gesture.pulling) {
      if (Math.hypot(dx, dy) < 10) return
      if (dy <= 0 || Math.abs(dx) > dy) { reset(); return }
      gesture.pulling = true
    }
    if (event.cancelable) event.preventDefault()
    // Resistance makes a deliberate ~130px pull necessary to refresh.
    gesture.distance = Math.min(96, Math.max(0, dy * 0.55))
    onProgress(gesture.distance)
  }
  const end = (event: TouchEvent) => {
    if (!gesture) return
    const shouldRefresh = event.type !== 'touchcancel' && gesture.distance >= PULL_THRESHOLD && !blocked()
    if (gesture.pulling && event.cancelable) event.preventDefault()
    if (shouldRefresh && !refreshing) {
      gesture = null
      refreshing = true
      void Promise.resolve().then(onRefresh).finally(() => { refreshing = false }).catch(() => { onProgress(0) })
    } else reset()
  }
  document.addEventListener('touchstart', start, { passive: true })
  document.addEventListener('touchmove', move, { passive: false })
  document.addEventListener('touchend', end, { passive: false })
  document.addEventListener('touchcancel', end)
  return () => {
    document.removeEventListener('touchstart', start)
    document.removeEventListener('touchmove', move)
    document.removeEventListener('touchend', end)
    document.removeEventListener('touchcancel', end)
  }
}
