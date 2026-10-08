import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OurEstate } from './OurEstate'
import { loadEstateHolderStatus, type EstateHolderStatus } from '../lib/estateHoldingsClient'
import type { RtcRecord } from '../lib/farmRtcClient'
import { aggregateMatches } from '../../supabase/functions/_shared/farmEstateHoldings'

type WorkspaceProps = { userId: string; email?: string | null; onExit?: () => void; onOpenMenu?: () => void }
export function OurEstateWorkspace(props: WorkspaceProps) {
  return <AccountEstateWorkspace key={props.userId} {...props} />
}

function AccountEstateWorkspace({ userId, email, onExit, onOpenMenu }: WorkspaceProps) {
  const [status, setStatus] = useState<EstateHolderStatus | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null), choiceController = useRef<AbortController | null>(null), alive = useRef(false)
  const refresh = useCallback(async () => {
    if (choiceController.current) return
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setLoading(true); setError('')
    try { const next = await loadEstateHolderStatus(request.signal); if (alive.current && !request.signal.aborted) setStatus(next) }
    catch (error) { if (alive.current && !request.signal.aborted) setError(error instanceof Error ? error.message : 'Your holder markers could not be loaded.') }
    finally { if (alive.current && !request.signal.aborted) setLoading(false) }
  }, [userId])
  useEffect(() => {
    alive.current = true; setStatus(null); void refresh()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60000)
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { alive.current = false; controller.current?.abort(); choiceController.current?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  const coverageComplete = Boolean(status && !status.pending && !status.unavailable && status.surveysTotal > 0 && status.surveysChecked === status.surveysTotal)
  const totals = useMemo(() => aggregateMatches(status?.matches ?? [], coverageComplete), [status, coverageComplete])
  let coverage = status ? `${status.recordsChecked} RTC records checked across ${status.surveysChecked} of ${status.surveysTotal} mapped surveys. ` : ''
  if (status) coverage += status.pending ? 'The background check continues while you are away. Acreage and markers currently include the matches found so far.' : status.unavailable ? `${status.unavailable} lookups could not be verified. Acreage is limited to the records checked successfully.` : coverageComplete ? 'All available RTC options for the mapped surveys have been checked.' : 'The mapped survey inventory is not yet complete.'
  if (totals.unknownCount > totals.overlapCount) coverage += ` ${totals.unknownCount - totals.overlapCount} matching records have an extent that cannot yet be converted reliably and are excluded from the measured acreage.`
  if (totals.overlapCount) coverage += ' Whole-survey records that may overlap subdivisions are excluded from the acreage.'
  const choose = useCallback(async (record: RtcRecord, holderName: string) => {
    controller.current?.abort()
    choiceController.current?.abort()
    const request = new AbortController(); choiceController.current = request
    setLoading(true); setError('')
    try { const next = await loadEstateHolderStatus(request.signal, { mode: 'choose', identity: record.identity, holderName }); if (alive.current && !request.signal.aborted) setStatus(next) }
    catch (cause) {
      if (alive.current && !request.signal.aborted) setError(cause instanceof Error ? cause.message : 'The recorded holder could not be selected.')
      throw cause
    }
    finally {
      if (choiceController.current === request) choiceController.current = null
      if (alive.current && !request.signal.aborted) setLoading(false)
    }
  }, [userId])
  const loadedRecord = useCallback(() => { if (status?.holderName) void refresh() }, [status?.holderName, refresh])
  return <>
    {error && !status && <div className="app-banner" role="alert"><p>{error}</p><button type="button" className="button-secondary" disabled={loading} onClick={() => void refresh()}>Retry private markers</button></div>}
    <OurEstate userId={userId} email={email} onExit={onExit} onOpenMenu={onOpenMenu} targetName={status?.holderName} holderAliases={status?.holderAliases}
      ownershipMatches={status?.matches.map(match => match.identity)} ownershipLoading={loading}
      ownershipError={error} ownershipStatus={coverage} ownershipTotalAcres={totals.knownAcres}
      ownershipRecordCount={totals.uniqueRecords} onRefreshOwnership={() => void refresh()}
      onRtcRecord={loadedRecord} onChooseHolder={choose} />
  </>
}
