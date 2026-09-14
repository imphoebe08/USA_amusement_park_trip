import { useEffect, useState } from 'react'
import { installPullToRefresh, PULL_THRESHOLD } from './pullToRefreshGesture'

export function PullToRefresh({ disabled }: { disabled: boolean }) {
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (disabled) return
    let reloadTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = installPullToRefresh({
      onProgress: setDistance,
      onRefresh: () => {
        setRefreshing(true)
        reloadTimer = setTimeout(() => window.location.reload(), 120)
      },
    })
    return () => { cleanup(); clearTimeout(reloadTimer) }
  }, [disabled])

  if (disabled || (!distance && !refreshing)) return null
  const ready = distance >= PULL_THRESHOLD
  return <div className="pull-refresh-indicator" role="status" aria-live="polite">
    <span aria-hidden="true" className={refreshing ? 'pull-refresh-spinner' : ''}>{refreshing ? '↻' : ready ? '↑' : '↓'}</span>
    <span>{refreshing ? '重新整理中…' : ready ? '放開即可重新整理' : '下拉重新整理'}</span>
    {!refreshing && <span className="pull-refresh-progress" aria-hidden="true" style={{ transform: `scaleX(${Math.min(distance / PULL_THRESHOLD, 1)})` }} />}
  </div>
}
