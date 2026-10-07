import { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, MapPin, ShieldCheck } from 'lucide-react'
import { parcelDetails, parcelLookupText, SQUARE_METRES_PER_ACRE } from '../lib/farmParcelDetails'
import type { Position, SurveyParcel, SurveyVillage } from '../lib/farmSurveyMap'
import { loadRtcRecord, rtcExtentText, type RtcRecord } from '../lib/farmRtcClient'

export function FarmParcelDetails({ village, parcel, point, level, sourceUrl, retrievedAt, onRecord }: {
  village: SurveyVillage; parcel: SurveyParcel; point: Position | null
  level: 'whole_survey' | 'hissa'; sourceUrl: string; retrievedAt: string
  onRecord?: (record: RtcRecord | null) => void
}) {
  const [copyStatus, setCopyStatus] = useState('')
  const [record, setRecord] = useState<RtcRecord | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const details = useMemo(() => { try { return parcelDetails(parcel) } catch { return null } }, [parcel])
  useEffect(() => {
    setRecord(null); setError(''); setLoading(false); onRecord?.(null)
    if (level !== 'hissa' || !parcel.hissa || !parcel.surnoc) return
    let active = true
    const controller = new AbortController()
    setLoading(true)
    void loadRtcRecord({ villageCode: village.bhoomi as '2301110012' | '2301110038', surveyNumber: parcel.survey, surnoc: parcel.surnoc, hissaNumber: parcel.hissa }, controller.signal)
      .then(result => { if (active && !controller.signal.aborted) { setRecord(result); onRecord?.(result) } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'The official RTC record could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [village.bhoomi, parcel.survey, parcel.surnoc, parcel.hissa, level, retry, onRecord])
  async function copyLookup() {
    try { await navigator.clipboard.writeText(parcelLookupText({ village, parcel })); setCopyStatus('Search details copied.') }
    catch { setCopyStatus('Could not copy. Use the village, survey, Surnoc and Hissa shown above.') }
  }
  const number = (value: number, digits = 2) => value.toLocaleString('en-IN', { maximumFractionDigits: digits })
  return <section className="fi-parcel-details" aria-label="Selected parcel details">
    <div className="fi-parcel-heading"><MapPin size={18} /><h3>Parcel details</h3><span>{level === 'hissa' ? 'Subdivision' : 'Whole survey'}</span></div>
    <dl className="fi-parcel-grid">
      <div><dt>Village</dt><dd>{village.name}</dd></div>
      <div><dt>Survey number</dt><dd>{parcel.survey}</dd></div>
      <div><dt>Surnoc</dt><dd>{parcel.surnoc ?? 'Not supplied'}</dd></div>
      <div><dt>Hissa</dt><dd>{parcel.hissa ?? 'Whole survey selected'}</dd></div>
      <div><dt>Location</dt><dd>Kasaba · Sakleshpur · Hassan</dd></div>
      <div><dt>State</dt><dd>Karnataka</dd></div>
      {point && <><div><dt>Latitude</dt><dd>{point[1].toFixed(6)}</dd></div><div><dt>Longitude</dt><dd>{point[0].toFixed(6)}</dd></div></>}
    </dl>
    {details && <div className="fi-parcel-area"><span>Approximate mapped outline area</span><strong>{number(details.mapped_area_m2 / SQUARE_METRES_PER_ACRE)} acres</strong><small>{number(details.mapped_area_m2 / 10000)} hectares · {number(details.mapped_area_m2)} m²</small><p>Calculated from the map boundary. Confirm your owned extent in the RTC before entering estate or cultivated area.</p></div>}
    <div className="fi-parcel-record" aria-busy={loading}>
      <div className="fi-parcel-heading"><ShieldCheck size={17} /><h4>Owner and recorded land details</h4></div>
      {level !== 'hissa' ? <p>Tap a numbered Hissa outline or choose your Hissa above to load its recorded holders and extent from Bhoomi. A whole survey may contain several properties.</p> : !parcel.surnoc ? <p>The map does not supply a Surnoc for this Hissa. Check its details in the official RTC.</p> : loading ? <p role="status">Loading the selected Hissa’s official RTC details…</p> : error ? <p role="alert">{error}</p> : null}
      {record && <>
        <dl className="fi-parcel-grid"><div><dt>Recorded extent for this Hissa</dt><dd>{rtcExtentText(record.extent)}</dd></div><div><dt>Land code</dt><dd>{record.landCode}</dd></div><div><dt>ULPIN</dt><dd>{record.ulpin ?? 'Not supplied'}</dd></div><div><dt>RTC retrieved</dt><dd>{new Date(record.retrievedAt).toLocaleString('en-IN')}</dd></div></dl>
        <h4>Recorded holders ({record.owners.length})</h4>
        {record.owners.length ? <div className="fi-rtc-owners">{record.owners.map((owner, index) => <article className="fi-rtc-owner" key={index}>
          <strong>{owner.name ?? 'Name not supplied'}</strong><p>{rtcExtentText(owner.extent)}</p>
          <details><summary>Additional RTC fields</summary><dl className="fi-parcel-grid"><div><dt>Father / related name in RTC</dt><dd>{owner.fatherName ?? 'Not supplied'}</dd></div><div><dt>Holder number</dt><dd>{owner.ownerNumber ?? 'Not supplied'}</dd></div><div><dt>Main holder number</dt><dd>{owner.mainOwnerNumber ?? 'Not supplied'}</dd></div><div><dt>Holder category code</dt><dd>{owner.category ?? 'Not supplied'}</dd></div><div><dt>Government restriction code</dt><dd>{owner.governmentRestriction ?? 'Not supplied'}</dd></div><div><dt>Restriction holder category code</dt><dd>{owner.governmentRestrictionOwnerCategory ?? 'Not supplied'}</dd></div><div><dt>Court stay code</dt><dd>{owner.courtStay ?? 'Not supplied'}</dd></div></dl><p className="fi-help">Codes are shown as published. Refer to the official RTC for their meaning and current entries.</p></details>
        </article>)}</div> : <p>No holder rows were supplied by Bhoomi for this Hissa.</p>}
        <p className="fi-help">This record matches the selected village, survey, Surnoc and Hissa. Confirm which share belongs to you before entering estate area. Khata and crop entries require the full official RTC.</p>
      </>}
      <div className="fi-parcel-actions">{error && <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Retry RTC lookup</button>}<a className="button-secondary" href="https://landrecords.karnataka.gov.in/Service2/" target="_blank" rel="noopener noreferrer">Open official RTC<ExternalLink size={15} /></a><button type="button" className="button-secondary" onClick={() => void copyLookup()}><Copy size={15} />Copy lookup details</button></div>{copyStatus && <p role="status">{copyStatus}</p>}
    </div>
    <details className="fi-parcel-source"><summary>Source and map identifiers</summary><dl className="fi-parcel-grid"><div><dt>Bhoomi village code</dt><dd>{village.bhoomi}</dd></div><div><dt>LGD village code</dt><dd>{village.lgd}</dd></div><div><dt>Map record match</dt><dd>{level === 'hissa' ? 'Publisher reports a matching numbered Hissa' : 'Select a Hissa to check its map match'}</dd></div>{details && <div><dt>Geometry parts</dt><dd>{details.geometry_parts}</dd></div>}<div><dt>Retrieved</dt><dd>{new Date(retrievedAt).toLocaleString('en-IN')}</dd></div><div><dt>Coordinate method</dt><dd>Point inside the mapped boundary</dd></div></dl><a href={sourceUrl} target="_blank" rel="noopener noreferrer">View official KGIS source<ExternalLink size={13} /></a></details>
    <p className="fi-help">Using this location keeps the survey identity, coordinates, map bounds, approximate outline area and available RTC reference in your private estate profile for reuse. Holder names are shown live and are not saved. Ownership and cultivated area still need confirmation.</p>
  </section>
}
