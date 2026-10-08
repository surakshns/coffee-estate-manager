import { describe,expect,it,vi } from 'vitest'
vi.mock('./supabase',()=>({supabase:{}}))
import { loadEstateHolderStatus } from './estateHoldingsClient'
const identity={villageCode:'2301110038',surveyNumber:'72',surnoc:'*',hissaNumber:'4'}
const match={identity,matchedAcres:1.25,landCode:'synthetic-land',lastCheckedAt:'2026-10-07T03:00:00Z'}
const status={holderName:'Synthetic holder',configuredAt:'2026-10-07T02:00:00Z',matches:[match],surveysTotal:518,surveysChecked:4,recordsChecked:8,pending:600,unavailable:0,lastCheckedAt:match.lastCheckedAt}
describe('private holder status client',()=>{
  it('preserves only validated account-private recorded aliases', async () => {
    const data = { ...status, holderAliases: ['Synthetic full recorded name'] }
    expect(await loadEstateHolderStatus(new AbortController().signal, undefined, vi.fn().mockResolvedValue({ data, error: null }))).toEqual(data)
    for (const holderAliases of [['<script>'], [null], Array(11).fill('Synthetic alias'), 'Not an array']) {
      await expect(loadEstateHolderStatus(new AbortController().signal, undefined, vi.fn().mockResolvedValue({ data: { ...status, holderAliases }, error: null }))).rejects.toThrow('could not be verified')
    }
  })
  it('preserves an unconfigured account and accepts only private matching references',async()=>{
    const signal=new AbortController().signal
    expect(await loadEstateHolderStatus(signal,undefined,vi.fn().mockResolvedValue({data:null,error:null}))).toBeNull()
    const invoke=vi.fn().mockResolvedValue({data:{...status,matches:[{...match,owners:['sensitive'],identity:{...identity,userId:'foreign'}}],otherEmail:'foreign'},error:null})
    expect(await loadEstateHolderStatus(signal,undefined,invoke)).toEqual(status)
    expect(invoke).toHaveBeenCalledWith({mode:'status'},signal)
  })
  it('rejects malformed totals, foreign villages and source references',async()=>{
    const signal=new AbortController().signal
    for(const patch of [{holderName:'<script>'},{surveysChecked:999},{pending:-1},{matches:[{...match,matchedAcres:Infinity}]},{matches:[{...match,identity:{...identity,villageCode:'foreign'}}]},{matches:[{...match,lastCheckedAt:'unknown'}]}])
      await expect(loadEstateHolderStatus(signal,undefined,vi.fn().mockResolvedValue({data:{...status,...patch},error:null}))).rejects.toThrow('could not be verified')
  })
  it('aborts account-stale results and prevents raw server errors entering UI',async()=>{
    const controller=new AbortController(),invoke=vi.fn().mockImplementation(async()=>{controller.abort();return {data:status,error:null}})
    await expect(loadEstateHolderStatus(controller.signal,undefined,invoke)).rejects.toMatchObject({name:'AbortError'})
    await expect(loadEstateHolderStatus(new AbortController().signal,undefined,vi.fn().mockResolvedValue({data:null,error:new Error('secret-owner-details')}))).rejects.not.toThrow('secret-owner-details')
  })
})
