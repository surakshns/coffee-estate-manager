import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, ExternalLink, MapPin, ShieldCheck } from 'lucide-react'
import { parcelDetails, parcelLookupText, SQUARE_METRES_PER_ACRE } from '../lib/farmParcelDetails'
import type { Position, SurveyParcel, SurveyVillage } from '../lib/farmSurveyMap'
import { loadRtcRecord, loadRtcOptions, rtcExtentText, type RtcRecord, type RtcOptions, type RtcOption, type RtcLookupRequest } from '../lib/farmRtcClient'

export function FarmParcelDetails({ village, parcel, point, level, sourceUrl, retrievedAt, onRecord, initialRecord }: {
  village: SurveyVillage; parcel: SurveyParcel; point: Position | null
  level: 'whole_survey' | 'hissa'; sourceUrl: string; retrievedAt: string
  onRecord?: (record: RtcRecord | null) => void
  initialRecord?: RtcLookupRequest
}) {
  const [copyStatus, setCopyStatus] = useState('')
  const [record, setRecord] = useState<RtcRecord | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [options, setOptions] = useState<RtcOptions | null>(null), [optionsLoading, setOptionsLoading] = useState(false), [optionsError, setOptionsError] = useState(''), [optionsRetry, setOptionsRetry] = useState(0)
  const [chosen, setChosen] = useState<(RtcOption & { villageCode: string; surveyNumber: string; parcelKey: string; level: 'whole_survey' | 'hissa' }) | null>(null)
  const onRecordRef = useRef(onRecord)
  onRecordRef.current = onRecord
  const mappedRecord = level === 'hissa' && parcel.hissa && parcel.surnoc
  const mappedWholeRecord = level === 'hissa' && !!parcel.hissa && /^\*{1,2}$/.test(parcel.hissa)
  const selectedRecord = mappedRecord ? { surnoc: parcel.surnoc!, hissaNumber: parcel.hissa! }
    : chosen?.villageCode === village.bhoomi && chosen.surveyNumber === parcel.survey && chosen.parcelKey === parcel.key && chosen.level === level ? chosen : null
  const details = useMemo(() => { try { return parcelDetails(parcel) } catch { return null } }, [parcel])
  useEffect(() => {
    const initial = initialRecord?.villageCode === village.bhoomi && initialRecord.surveyNumber === parcel.survey
      ? { ...initialRecord, parcelKey: parcel.key, level } : null
    setOptions(null); setOptionsError(''); setOptionsLoading(false); setChosen(initial)
    if (level === 'hissa' && parcel.hissa && parcel.surnoc) return
    let active = true
    const controller = new AbortController()
    setOptionsLoading(true)
    void loadRtcOptions({ mode: 'options', villageCode: village.bhoomi as '2301110012' | '2301110038', surveyNumber: parcel.survey }, controller.signal)
      .then(result => {
        if (!active || controller.signal.aborted) return
        setOptions(result)
        const exact = level === 'hissa' && parcel.hissa ? result.entries.filter(entry => entry.hissaNumber === parcel.hissa) : result.entries.filter(entry => /^\*{1,2}$/.test(entry.hissaNumber) || entry.hissaNumber === '0')
        if (!initial && exact.length === 1) setChosen(current => current ?? { ...exact[0], villageCode: village.bhoomi, surveyNumber: parcel.survey, parcelKey: parcel.key, level })
      })
      .catch(cause => { if (active) setOptionsError(cause instanceof Error ? cause.message : 'Official Hissa records could not be loaded.') })
      .finally(() => { if (active) setOptionsLoading(false) })
    return () => { active = false; controller.abort() }
  }, [village.bhoomi, parcel.key, parcel.survey, parcel.surnoc, parcel.hissa, level, optionsRetry, initialRecord?.villageCode, initialRecord?.surveyNumber, initialRecord?.surnoc, initialRecord?.hissaNumber])
  useEffect(() => {
    setRecord(null); setError(''); setLoading(false); onRecordRef.current?.(null)
    if (!selectedRecord) return
    let active = true
    const controller = new AbortController()
    setLoading(true)
    void loadRtcRecord({ villageCode: village.bhoomi as '2301110012' | '2301110038', surveyNumber: parcel.survey, surnoc: selectedRecord.surnoc, hissaNumber: selectedRecord.hissaNumber }, controller.signal)
      .then(result => { if (active && !controller.signal.aborted) { setRecord(result); onRecordRef.current?.(result) } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'The official RTC record could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [village.bhoomi, parcel.survey, selectedRecord?.surnoc, selectedRecord?.hissaNumber, retry])
  async function copyLookup() {
    try { await navigator.clipboard.writeText(parcelLookupText({ village, parcel })); setCopyStatus('Search details copied.') }
    catch { setCopyStatus('Could not copy. Use the village, survey, Surnoc and Hissa shown above.') }
  }
  const number = (value: number, digits = 2) => value.toLocaleString('en-IN', { maximumFractionDigits: digits })
  return <section className="fi-parcel-details" aria-label="Selected parcel details">
    <div className="fi-parcel-heading"><MapPin size={18} /><h3>Parcel details</h3><span>{mappedWholeRecord ? 'Whole-survey record' : level === 'hissa' ? 'Subdivision' : 'Whole survey'}</span></div>
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
      {!mappedRecord && <>
        <p>A whole survey may contain several properties. Choose an official RTC record below, including Hissas whose boundaries are not available on the map.</p>
        {optionsLoading && <p role="status">Loading official Surnoc and Hissa records…</p>}
        {optionsError && <p role="alert">{optionsError}</p>}
        {options && (options.entries.length ? <label>Official RTC record<select aria-label="Official RTC record" value={selectedRecord ? `${selectedRecord.surnoc}:${selectedRecord.hissaNumber}` : ''} onChange={event => {
          const entry = options.entries.find(option => `${option.surnoc}:${option.hissaNumber}` === event.target.value)
          setChosen(entry ? { ...entry, villageCode: village.bhoomi, surveyNumber: parcel.survey, parcelKey: parcel.key, level } : null)
        }}><option value="">Choose Surnoc / Hissa</option>{options.entries.map(entry => <option key={`${entry.surnoc}:${entry.hissaNumber}`} value={`${entry.surnoc}:${entry.hissaNumber}`}>Surnoc {entry.surnoc} · Hissa {entry.hissaNumber}{/^\*{1,2}$/.test(entry.hissaNumber) || entry.hissaNumber === '0' ? ' · Whole-survey record' : ''}</option>)}</select></label> : <p>No RTC record options were supplied for this survey.</p>)}
        {optionsError && <button type="button" className="button-secondary" onClick={() => setOptionsRetry(value => value + 1)}>Retry Hissa records</button>}
      </>}
      {loading ? <p role="status">Loading the selected record’s official RTC details…</p> : error ? <p role="alert">{error}</p> : null}
      {record && <>
        <dl className="fi-parcel-grid"><div><dt>{level === 'hissa' && !mappedWholeRecord ? 'Recorded extent for this Hissa' : 'Recorded extent for this RTC record'}</dt><dd>{rtcExtentText(record.extent)}</dd></div><div><dt>RTC Surnoc / Hissa</dt><dd>{record.identity.surnoc} / {record.identity.hissaNumber}</dd></div><div><dt>Land code</dt><dd>{record.landCode}</dd></div><div><dt>ULPIN</dt><dd>{record.ulpin ?? 'Not supplied'}</dd></div><div><dt>RTC retrieved</dt><dd>{new Date(record.retrievedAt).toLocaleString('en-IN')}</dd></div></dl>
        <h4>Recorded holders ({record.owners.length})</h4>
        {record.owners.length ? <div className="fi-rtc-owners">{record.owners.map((owner, index) => <article className="fi-rtc-owner" key={index}>
          <strong>{owner.name ?? 'Name not supplied'}</strong><p>{rtcExtentText(owner.extent)}</p>
          <details><summary>Additional RTC fields</summary><dl className="fi-parcel-grid"><div><dt>Father / related name in RTC</dt><dd>{owner.fatherName ?? 'Not supplied'}</dd></div><div><dt>Holder number</dt><dd>{owner.ownerNumber ?? 'Not supplied'}</dd></div><div><dt>Main holder number</dt><dd>{owner.mainOwnerNumber ?? 'Not supplied'}</dd></div><div><dt>Holder category code</dt><dd>{owner.category ?? 'Not supplied'}</dd></div><div><dt>Government restriction code</dt><dd>{owner.governmentRestriction ?? 'Not supplied'}</dd></div><div><dt>Restriction holder category code</dt><dd>{owner.governmentRestrictionOwnerCategory ?? 'Not supplied'}</dd></div><div><dt>Court stay code</dt><dd>{owner.courtStay ?? 'Not supplied'}</dd></div></dl><p className="fi-help">Codes are shown as published. Refer to the official RTC for their meaning and current entries.</p></details>
        </article>)}</div> : <p>No holder rows were supplied by Bhoomi for this record.</p>}
        <p className="fi-help">This RTC matches the village, survey and record identifiers shown above. {level !== 'hissa' && 'The displayed map boundary covers the whole survey, rather than this individual record. '}Confirm which share belongs to you before entering estate area. Khata and crop entries require the full official RTC.</p>
      </>}
      <div className="fi-parcel-actions">{error && <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Retry RTC lookup</button>}<a className="button-secondary" href="https://landrecords.karnataka.gov.in/Service2/" target="_blank" rel="noopener noreferrer">Open official RTC<ExternalLink size={15} /></a><button type="button" className="button-secondary" onClick={() => void copyLookup()}><Copy size={15} />Copy lookup details</button></div>{copyStatus && <p role="status">{copyStatus}</p>}
    </div>
    <details className="fi-parcel-source"><summary>Source and map identifiers</summary><dl className="fi-parcel-grid"><div><dt>Bhoomi village code</dt><dd>{village.bhoomi}</dd></div><div><dt>LGD village code</dt><dd>{village.lgd}</dd></div><div><dt>Map record match</dt><dd>{level === 'hissa' ? 'Publisher reports a matching RTC outline' : 'Select a Hissa to check its map match'}</dd></div>{details && <div><dt>Geometry parts</dt><dd>{details.geometry_parts}</dd></div>}<div><dt>Retrieved</dt><dd>{new Date(retrievedAt).toLocaleString('en-IN')}</dd></div><div><dt>Coordinate method</dt><dd>Point inside the mapped boundary</dd></div></dl><a href={sourceUrl} target="_blank" rel="noopener noreferrer">View official KGIS source<ExternalLink size={13} /></a></details>
    <p className="fi-help">RTC holder rows load live. Our Estate saves only the holder names you explicitly approve and their matching land references privately. Ownership and cultivated area still need confirmation.</p>
  </section>
}
