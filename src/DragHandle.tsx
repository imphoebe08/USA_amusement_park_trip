import { useEffect, useLayoutEffect, useRef } from 'react'

type Props = {
  group: string
  index: number
  onStart: (index: number) => void
  onOver: (index: number | null) => void
  onEnd: () => void
  onMove: (target: number, source: number) => Promise<boolean | undefined>
}

// Native touch listeners let ordinary swipes scroll until the long press activates.
export function DragHandle(props: Props) {
  const anchor = useRef<HTMLSpanElement>(null)
  const callbacks = useRef(props)
  useLayoutEffect(() => { callbacks.current = props })

  useEffect(() => {
    const card = anchor.current!.closest<HTMLElement>('[data-drag-group]')!
    let timer = 0
    let frame = 0
    let mouseGesture = false
    let pending = false
    let active = false
    let settling = false
    let disposed = false
    let touchId: number | null = null
    let startX = 0
    let startY = 0
    let x = 0
    let y = 0
    let left = 0
    let top = 0
    let target: number | null = null
    let preview: HTMLElement | null = null
    let highlighted: HTMLElement | null = null
    let suppressClickUntil = 0
    const duration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260
    const clearHighlight = () => {
      highlighted?.classList.remove('drop-zone-active')
      highlighted = null
    }
    const clean = () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      pending = false
      active = false
      clearHighlight()
      card.classList.remove('drag-source')
      preview?.remove()
      preview = null
      if (document.body.dataset.dragOwner === owner) {
        delete document.body.dataset.dragOwner
        document.body.classList.remove('is-dragging')
      }
    }
    const owner = `${props.group}-${props.index}-${Math.random()}`
    const locate = () => {
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drag-group]')
      const next = hit?.dataset.dragGroup === props.group ? hit : null
      target = next ? Number(next.dataset.dragIndex) : null
      if (next !== highlighted) {
        clearHighlight()
        highlighted = next
        if (next !== card) next?.classList.add('drop-zone-active')
        callbacks.current.onOver(target)
      }
    }
    const follow = () => {
      if (!active || !preview) return
      preview.style.left = `${left + x - startX}px`
      preview.style.top = `${top + y - startY}px`
      const edge = 90
      const speed = y < edge ? -Math.min(12, (edge - y) / 5) : y > innerHeight - edge ? Math.min(12, (y - innerHeight + edge) / 5) : 0
      if (speed) window.scrollBy(0, speed)
      locate()
      frame = requestAnimationFrame(follow)
    }
    const lift = () => {
      if (!pending || document.body.dataset.dragOwner) return
      pending = false
      active = true
      document.body.dataset.dragOwner = owner
      document.body.classList.add('is-dragging')
      const rect = card.getBoundingClientRect()
      left = rect.left
      top = rect.top
      preview = card.cloneNode(true) as HTMLElement
      preview.removeAttribute('id')
      preview.removeAttribute('data-drag-group')
      preview.removeAttribute('data-drag-index')
      preview.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
      preview.setAttribute('aria-hidden', 'true')
      preview.inert = true
      preview.classList.remove('dragging-card', 'drag-over-card')
      preview.classList.add('drag-preview')
      Object.assign(preview.style, { left: `${left}px`, top: `${top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
      document.body.append(preview)
      preview.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }], { duration: duration(), easing: 'ease-out' })
      card.classList.add('drag-source')
      callbacks.current.onStart(props.index)
      navigator.vibrate?.(20)
      follow()
    }
    const begin = (eventTarget: EventTarget | null, nextX: number, nextY: number, mouse = false) => {
      if (pending || active || settling || document.body.dataset.dragOwner) return
      const element = eventTarget instanceof Element ? eventTarget : null
      const control = element?.closest('button, a, input, select, textarea, [contenteditable="true"]')
      if (control && !control.hasAttribute('data-drag-surface')) return
      pending = true
      mouseGesture = mouse
      startX = x = nextX
      startY = y = nextY
      if (!mouse) timer = window.setTimeout(lift, 380)
    }
    const move = (nextX: number, nextY: number) => {
      x = nextX
      y = nextY
      if (pending && Math.hypot(x - startX, y - startY) > 8) {
        if (mouseGesture) lift()
        else {
          clearTimeout(timer)
          pending = false
        }
      }
    }
    const finish = async (cancelled: boolean) => {
      clearTimeout(timer)
      pending = false
      if (!active || !preview) return
      locate()
      active = false
      settling = true
      cancelAnimationFrame(frame)
      clearHighlight()
      suppressClickUntil = Date.now() + 500
      const floating = preview
      const destination = target
      // Keep the preview visible during persistence; a rejected save returns it home.
      let success = false
      try {
        if (!cancelled && destination !== null && destination !== props.index) {
          floating.classList.add('drag-saving')
          try {
            success = await callbacks.current.onMove(destination, props.index) === true
          } catch {
            success = false
          }
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const landing = success
          ? document.querySelector<HTMLElement>(`[data-drag-group="${props.group}"][data-drag-index="${destination}"]`)
          : card.isConnected ? card : null
        floating.classList.remove('drag-saving')
        if (landing) {
          landing.classList.add('drag-landing-hidden')
          const rect = landing.getBoundingClientRect()
          try {
            await floating.animate([
              { left: floating.style.left, top: floating.style.top, transform: 'scale(1.035)', opacity: 1 },
              { left: `${rect.left}px`, top: `${rect.top}px`, transform: 'scale(1)', opacity: 1 },
            ], { duration: duration(), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished
          } finally {
            landing.classList.remove('drag-landing-hidden')
          }
        }
      } finally {
        settling = false
        clean()
        if (!disposed) callbacks.current.onEnd()
      }
    }
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { void finish(true); return }
      const touch = event.changedTouches[0]
      touchId = touch.identifier
      begin(event.target, touch.clientX, touch.clientY)
    }
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { void finish(true); return }
      const touch = Array.from(event.touches).find((item) => item.identifier === touchId)
      if (!touch) return
      if (active && event.cancelable) event.preventDefault()
      move(touch.clientX, touch.clientY)
    }
    const touchEnd = (event: TouchEvent) => {
      if (!Array.from(event.changedTouches).some((item) => item.identifier === touchId)) return
      if (active && event.cancelable) event.preventDefault()
      touchId = null
      void finish(event.type === 'touchcancel')
    }
    const mouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || touchId !== null) return
      begin(event.target, event.clientX, event.clientY, true)
      if (pending && mouseGesture) event.preventDefault()
    }
    const mouseMove = (event: MouseEvent) => { if (mouseGesture) move(event.clientX, event.clientY) }
    const mouseUp = () => { if (mouseGesture) void finish(false) }
    const cancel = () => { void finish(true) }
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    const preventNativeDrag = (event: Event) => event.preventDefault()
    const contextMenu = (event: Event) => { if (pending || active || settling) event.preventDefault() }
    const click = (event: Event) => {
      if (active || settling || Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation() }
    }
    card.addEventListener('touchstart', touchStart, { passive: true })
    card.addEventListener('mousedown', mouseDown)
    card.addEventListener('dragstart', preventNativeDrag)
    card.addEventListener('contextmenu', contextMenu)
    card.addEventListener('click', click, true)
    document.addEventListener('touchmove', touchMove, { passive: false })
    document.addEventListener('touchend', touchEnd, { passive: false })
    document.addEventListener('touchcancel', touchEnd)
    document.addEventListener('mousemove', mouseMove)
    document.addEventListener('mouseup', mouseUp)
    document.addEventListener('keydown', keyDown)
    window.addEventListener('blur', cancel)
    return () => {
      disposed = true
      card.removeEventListener('touchstart', touchStart)
      card.removeEventListener('mousedown', mouseDown)
      card.removeEventListener('dragstart', preventNativeDrag)
      card.removeEventListener('contextmenu', contextMenu)
      card.removeEventListener('click', click, true)
      document.removeEventListener('touchmove', touchMove)
      document.removeEventListener('touchend', touchEnd)
      document.removeEventListener('touchcancel', touchEnd)
      document.removeEventListener('mousemove', mouseMove)
      document.removeEventListener('mouseup', mouseUp)
      document.removeEventListener('keydown', keyDown)
      window.removeEventListener('blur', cancel)
      // A successful reorder may remount this handle while its landing animation runs.
      if (!settling) clean()
    }
  }, [props.group, props.index])

  return <span ref={anchor} hidden aria-hidden="true" />
}
