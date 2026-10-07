import { useState, type FormEvent } from 'react'
import { ArrowRight, ShieldCheck, Sprout } from 'lucide-react'
import { CROPS, emptyBlockCrop, emptyFarmProfile, type Crop, type FarmProfile } from '../lib/farmIntelligence'
import { CROP_LABELS, validateFarmProfile } from './FarmOnboarding'
import { Notice } from './Workspace'
import { FarmSurveyPicker } from './FarmSurveyPicker'
import { selectionPatch } from '../lib/farmSurveyMap'
import { SQUARE_METRES_PER_ACRE } from '../lib/farmParcelDetails'
import { rtcExtentText } from '../lib/farmRtcClient'

export function FarmQuickSetup({ saving, onSave, onDetails }: { saving: boolean; onSave: (profile: FarmProfile) => Promise<void>; onDetails: (draft: FarmProfile) => void }) {
  const [estate, setEstate] = useState(emptyFarmProfile().estate)
  const [blockName, setBlockName] = useState(''), [area, setArea] = useState(''), [crops, setCrops] = useState<Crop[]>([]), [error, setError] = useState('')
  function patchEstate(patch: Partial<FarmProfile['estate']>) {
    setEstate(p => ({ ...p, ...patch, ...(['state', 'district', 'taluk', 'village'].some(key => key in patch) ? { location_source: null, latitude: null, longitude: null, elevation_m: null, survey_numbers: [] } : {}) }))
  }
  function draft(): FarmProfile {
    const profile = emptyFarmProfile()
    profile.estate = { ...estate, state: estate.state.trim(), district: estate.district.trim(), taluk: estate.taluk.trim() }
    if (blockName.trim() || crops.length || area) profile.blocks = [{ name: blockName.trim(), area: area === '' ? null : Number(area), area_unit: estate.area_unit, latitude: null, longitude: null, irrigation_type: null, water_source: null, notes: null, crops: crops.map(crop => ({ ...emptyBlockCrop(crop), area_unit: estate.area_unit })) }]
    return profile
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const profile = draft()
    const invalid = !blockName.trim() ? 'Name the physical block where these crops grow.' : !crops.length ? 'Select at least one crop that grows in this block.' : area !== '' && (!Number.isFinite(Number(area)) || Number(area) <= 0) ? 'Enter a block area greater than zero, or leave it blank.' : validateFarmProfile(profile)
    if (invalid) { setError(invalid); return }
    setError('')
    try { await onSave(profile) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save your estate. Your inputs are still here.') }
  }
  return <section className="fi-quick-setup" aria-labelledby="fi-setup-title">
    <div className="fi-setup-intro"><span className="fi-icon-tile"><Sprout size={24} /></span><h2 id="fi-setup-title">Make this useful for your estate</h2><p>Tell us where you farm and what grows in your first block. We’ll match notices to your location and crops.</p><span><ShieldCheck size={15} /> Saved privately to your account</span><p className="fi-help">A physical block is one area of land. Select all crops growing together; add other blocks later.</p></div>
    <form onSubmit={submit} aria-label="Quick estate setup" aria-busy={saving}>
      <fieldset disabled={saving} className="fi-quick-fields">
        <label>Estate name <span className="fi-optional">optional</span><input value={estate.estate_name ?? ''} maxLength={160} placeholder="e.g. Green Valley Estate" onChange={e => setEstate(p => ({ ...p, estate_name: e.target.value.trim() ? e.target.value : null }))} /></label>
        <label>Village <span className="fi-optional">optional</span><input value={estate.village ?? ''} maxLength={160} placeholder="Your village" onChange={e => patchEstate({ village: e.target.value.trim() ? e.target.value : null })} /></label>
        <div className="fi-location-fields">{(['state', 'district', 'taluk'] as const).map(key => <label key={key}>{key === 'taluk' ? 'Taluk' : key === 'state' ? 'State' : 'District'}<input required value={estate[key]} maxLength={160} onChange={e => patchEstate({ [key]: e.target.value })} /></label>)}</div>
        <div className="fi-survey-quick"><FarmSurveyPicker onSelect={selection => setEstate(p => ({ ...p, ...selectionPatch(selection) }))} />{estate.location_source && <p>Survey {estate.survey_numbers.join(', ')} · {estate.village}<br /><small>KGIS {estate.location_source.level === 'hissa' ? 'subdivision' : 'whole-survey'} map point: {estate.latitude!.toFixed(6)}, {estate.longitude!.toFixed(6)}. The map does not supply elevation.</small>{estate.location_source.parcel_details && <small className="fi-saved-map-area">Mapped outline: {(estate.location_source.parcel_details.mapped_area_m2 / SQUARE_METRES_PER_ACRE).toLocaleString('en-IN', { maximumFractionDigits: 2 })} acres (approximate). Confirm your owned extent in the RTC.</small>}{estate.location_source.rtc_reference && <small className="fi-saved-map-area">Saved RTC extent: {rtcExtentText({ acres: estate.location_source.rtc_reference.recorded_extent.acres, guntas: estate.location_source.rtc_reference.recorded_extent.guntas, fractionalGuntas: estate.location_source.rtc_reference.recorded_extent.fractional_guntas })} · Land code {estate.location_source.rtc_reference.land_code}. Confirm your share before entering block area.</small>}</p>}</div>
        {estate.location_source && <label>Elevation (metres) <span className="fi-optional">optional</span><input type="number" min={-500} max={9000} step="any" value={estate.elevation_m ?? ''} placeholder="Enter only if known" onChange={e => setEstate(p => ({ ...p, elevation_m: e.target.value === '' ? null : Number(e.target.value) }))} /></label>}
        <label>First block name<input required value={blockName} maxLength={120} placeholder="e.g. Upper block" onChange={e => setBlockName(e.target.value)} /></label>
        <label>Block area <span className="fi-optional">optional</span><div className="fi-area-input"><input aria-label="Block area" type="number" min="0.000001" step="any" inputMode="decimal" value={area} placeholder="Leave blank if unknown" onChange={e => setArea(e.target.value)} /><select aria-label="Block area unit" value={estate.area_unit} onChange={e => setEstate(p => ({ ...p, area_unit: e.target.value as 'acre' | 'hectare' }))}><option value="acre">acres</option><option value="hectare">hectares</option></select></div></label>
        <fieldset className="fi-crop-choices"><legend>What grows in this block?</legend>{CROPS.map(crop => <label key={crop} className={crops.includes(crop) ? 'is-selected' : ''}><input type="checkbox" checked={crops.includes(crop)} onChange={e => setCrops(p => e.target.checked ? [...p, crop] : p.filter(c => c !== crop))} />{CROP_LABELS[crop]}</label>)}</fieldset>
        <Notice error>{error}</Notice>
        <div className="fi-setup-actions"><button type="submit" className="button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save my estate'}<ArrowRight size={16} /></button><button type="button" className="fi-text-button" onClick={() => onDetails(draft())}>Full profile setup</button></div>
      </fieldset>
    </form>
  </section>
}
