import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { installPullToRefresh, PULL_THRESHOLD } from './pullToRefreshGesture'

type Phase = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'complete' | 'error' | 'settling'
const HOLD_HEIGHT = 48

export function PullToRefresh({ disabled, onRefresh }: { disabled: boolean; onRefresh: () => Promise<void> }) {
  const [view, setView] = useState<{ phase: Phase; distance: number }>({ phase: 'idle', distance: 0 })
  const refresh = useRef(onRefresh)
  useLayoutEffect(() => { refresh.current = onRefresh })

  useEffect(() => {
    if (disabled) return
    let cancelled = false
    let ready = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const pause = (ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(() => { timers.delete(timer); resolve() }, ms)
      timers.add(timer)
    })
    const settle = async () => {
      if (cancelled) return
      setView({ phase: 'settling', distance: 0 })
      await pause(240)
      if (!cancelled) setView({ phase: 'idle', distance: 0 })
    }
    const cleanup = installPullToRefresh({
      onProgress: (distance) => {
        if (cancelled) return
        if (!distance) {
          ready = false
          setView((current) => current.phase === 'idle' ? current : { phase: 'settling', distance: 0 })
          return
        }
        const nextReady = distance >= PULL_THRESHOLD
        if (nextReady && !ready) {
          try { navigator.vibrate?.(10) } catch { /* Haptics are optional. */ }
        }
        ready = nextReady
        setView({ phase: nextReady ? 'ready' : 'pulling', distance })
      },
      onRefresh: async () => {
        ready = false
        setView({ phase: 'refreshing', distance: HOLD_HEIGHT })
        const minimumSpinnerTime = pause(350)
        let success = true
        try { await refresh.current() } catch { success = false }
        await minimumSpinnerTime
        if (cancelled) return
        setView({ phase: success ? 'complete' : 'error', distance: HOLD_HEIGHT })
        await pause(success ? 650 : 1000)
        await settle()
      },
    })
    return () => {
      cancelled = true
      cleanup()
      timers.forEach(clearTimeout)
    }
  }, [disabled])

  const { phase, distance } = disabled ? { phase: 'idle', distance: 0 } : view
  const pulling = phase === 'pulling' || phase === 'ready'
  const message = phase === 'refreshing' ? '更新中…' : phase === 'complete' ? '已更新' : phase === 'error' ? '更新失敗，請再試一次' : phase === 'ready' ? '放開即可重新整理' : '下拉重新整理'
  return <div className={`pull-refresh-space ${pulling ? 'is-pulling' : ''}`} style={{ height: distance }}>
    {phase !== 'idle' && <div className="pull-refresh-indicator" role="status" aria-live="polite" style={{ opacity: Math.min(distance / 40, 1) }}>
      <span aria-hidden="true" className={phase === 'refreshing' ? 'pull-refresh-spinner' : 'pull-refresh-arrow'} style={pulling ? { transform: `rotate(${phase === 'ready' ? 180 : 0}deg)` } : undefined}>
        {phase === 'refreshing' ? '' : phase === 'complete' ? '✓' : phase === 'error' ? '!' : '↓'}
      </span>
      <span>{message}</span>
    </div>}
  </div>
}
