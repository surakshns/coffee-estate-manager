import { CoffeeCup } from './CoffeeCup'

export function RecordLoading({ message = 'Gathering your estate records…', compact = false }: { message?: string; compact?: boolean }) {
  return <div className={`record-loading${compact ? ' is-compact' : ''}`} role="status">
    <div className="record-loading-caption"><span className="record-loading-mark" aria-hidden="true"><CoffeeCup /></span><p>{message}</p></div>
    {!compact && <div className="record-skeleton" aria-hidden="true">
      <div className="record-skeleton-heading"><span /><span /></div>
      <div className="record-skeleton-metrics">{[0, 1, 2, 3].map(index => <div key={index}><span /><span /></div>)}</div>
      <div className="record-skeleton-panel"><span /><div>{[38, 65, 48, 84, 60, 76].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div></div>
    </div>}
  </div>
}
