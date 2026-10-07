// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FarmParcelDetails } from './FarmParcelDetails'
import { SURVEY_VILLAGES, type SurveyParcel } from '../lib/farmSurveyMap'
import type { RtcRecord } from '../lib/farmRtcClient'
const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../lib/farmRtcClient', async importOriginal => ({ ...await importOriginal<typeof import('../lib/farmRtcClient')>(), loadRtcRecord: load }))
const parcel:SurveyParcel={key:'12:*:1',survey:'12',surnoc:'*',hissa:'1',polygons:[[[[75,13],[75.01,13],[75.01,13.01],[75,13.01],[75,13]]]]}
const props={village:SURVEY_VILLAGES[0],parcel,point:[75.005,13.005] as [number,number],level:'hissa' as const,sourceUrl:'https://kgis.ksrsac.in/source',retrievedAt:'2026-10-07T13:00:00Z'}
afterEach(() => { cleanup(); vi.clearAllMocks() })
const record: RtcRecord = { identity: { villageCode:'2301110012',surveyNumber:'12',surnoc:'*',hissaNumber:'1' }, villageName:'Hebbasale',landCode:'123',ulpin:null,extent:{acres:'2',guntas:'3',fractionalGuntas:'4'},owners:[{ownerNumber:'1',mainOwnerNumber:null,name:'Synthetic test holder',fatherName:'Synthetic related name',category:'1',extent:{acres:'2',guntas:'3',fractionalGuntas:'4'},governmentRestriction:'0',governmentRestrictionOwnerCategory:null,courtStay:'0'}],sourceUrl:'https://rdservices.karnataka.gov.in/BhoomiMaps/',retrievedAt:'2026-10-07T13:00:00Z' }
describe('parcel detail panel',()=>{
  it('shows available geography and labels calculated area separately from recorded extent',async()=>{
    load.mockResolvedValue(record)
    render(<FarmParcelDetails {...props}/>)
    expect(screen.getByRole('region',{name:'Selected parcel details'})).toBeTruthy()
    expect(screen.getByText('13.005000')).toBeTruthy();expect(screen.getByText('75.005000')).toBeTruthy()
    expect(screen.getByText('Approximate mapped outline area')).toBeTruthy()
    expect(await screen.findByText('Synthetic test holder')).toBeTruthy()
    expect(screen.getByText('Recorded extent for this Hissa')).toBeTruthy()
    expect(screen.getByRole('link',{name:'Open official RTC'}).getAttribute('href')).toBe('https://landrecords.karnataka.gov.in/Service2/')
    expect(screen.queryByText(/Owner:.*verified/i)).toBeNull()
  })
  it('copies the exact survey, Surnoc, Hissa and official village identifiers',async()=>{
    load.mockRejectedValue(new Error('Official record temporarily unavailable.'))
    const user=userEvent.setup();const write=vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue()
    render(<FarmParcelDetails {...props}/>);await user.click(screen.getByRole('button',{name:'Copy lookup details'}))
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Survey: 12\nSurnoc: *\nHissa: 1'))
    expect(await screen.findByText('Search details copied.')).toBeTruthy()
  })
  it('asks for the specific Hissa before making an owner lookup',()=>{
    render(<FarmParcelDetails {...props} parcel={{...parcel,hissa:null}} level="whole_survey" />)
    expect(screen.getByText(/A whole survey may contain several properties/)).toBeTruthy()
    expect(load).not.toHaveBeenCalled()
  })
  it('offers a retry and official lookup when the upstream record is unavailable',async()=>{
    load.mockRejectedValueOnce(new Error('Official record temporarily unavailable.')).mockResolvedValueOnce(record)
    render(<FarmParcelDetails {...props}/>);expect(await screen.findByRole('alert')).toHaveProperty('textContent','Official record temporarily unavailable.')
    await userEvent.setup().click(screen.getByRole('button',{name:'Retry RTC lookup'}))
    expect(await screen.findByText('Synthetic test holder')).toBeTruthy();expect(load).toHaveBeenCalledTimes(2)
  })
  it('ignores a previous parcel response after changing Hissa',async()=>{
    let finish!:(value:RtcRecord)=>void
    load.mockImplementationOnce(()=>new Promise<RtcRecord>(resolve=>{finish=resolve})).mockResolvedValueOnce({...record,identity:{...record.identity,hissaNumber:'2'},owners:[]})
    const onRecord=vi.fn(),view=render(<FarmParcelDetails {...props} onRecord={onRecord}/>)
    view.rerender(<FarmParcelDetails {...props} parcel={{...parcel,key:'12:*:2',hissa:'2'}} onRecord={onRecord}/>)
    await waitFor(()=>expect(load).toHaveBeenCalledTimes(2))
    await act(async()=>{finish(record)})
    expect(screen.queryByText('Synthetic test holder')).toBeNull()
    expect(onRecord.mock.calls.filter(([value])=>value?.owners?.length)).toHaveLength(0)
  })
})
