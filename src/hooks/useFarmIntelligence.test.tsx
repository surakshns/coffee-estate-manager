// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyFarmProfile } from '../lib/farmIntelligence'
import { useFarmIntelligence } from './useFarmIntelligence'
const api=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),read:vi.fn()}))
vi.mock('../lib/farmIntelligenceClient',async importOriginal=>({...await importOriginal<object>(),loadFarmSnapshot:api.load,saveFarmProfile:api.save,markFarmAlertRead:api.read}))
const snapshot=(name:string)=>({profile:{...emptyFarmProfile(),estate:{...emptyFarmProfile().estate,estate_name:name}},updates:[],prices:[],sources:[],stations:[],observations:[],alerts:[]})
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}
beforeEach(()=>{vi.clearAllMocks();api.load.mockResolvedValue(snapshot('Estate A'));api.save.mockResolvedValue('estate-a');api.read.mockResolvedValue(undefined)})
afterEach(()=>cleanup())
describe('private farm data loading',()=>{
  it('hides the previous profile immediately on account change and rejects late results',async()=>{
    const late=deferred<ReturnType<typeof snapshot>>(),next=deferred<ReturnType<typeof snapshot>>()
    api.load.mockResolvedValueOnce(snapshot('Estate A')).mockReturnValueOnce(late.promise).mockReturnValueOnce(next.promise)
    const hook=renderHook(({owner})=>useFarmIntelligence(owner),{initialProps:{owner:'owner-a'}})
    await waitFor(()=>expect(hook.result.current.loading).toBe(false))
    let refreshing!:Promise<void>;act(()=>{refreshing=hook.result.current.refresh()})
    hook.rerender({owner:'owner-b'})
    expect(hook.result.current.snapshot.profile).toBeNull()
    await act(async()=>{late.resolve(snapshot('Private stale estate A'));await refreshing})
    expect(hook.result.current.snapshot.profile).toBeNull()
    await act(async()=>{next.resolve(snapshot('Estate B'))})
    expect(hook.result.current.snapshot.profile?.estate.estate_name).toBe('Estate B')
  })
  it('shows migration setup failure separately from bookkeeping',async()=>{
    api.load.mockRejectedValue({code:'PGRST202',message:'Function missing'})
    const hook=renderHook(()=>useFarmIntelligence('owner-a'))
    await waitFor(()=>expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.setupReady).toBe(false);expect(hook.result.current.error).toContain('existing records')
  })
  it('aborts an in-progress private read on unmount',async()=>{
    const pending=deferred<ReturnType<typeof snapshot>>();api.load.mockReturnValue(pending.promise)
    const hook=renderHook(()=>useFarmIntelligence('owner-a'))
    const signal=api.load.mock.calls[0][0] as AbortSignal
    hook.unmount();expect(signal.aborted).toBe(true)
  })
  it('does not overwrite the profile after a failed save',async()=>{
    api.save.mockRejectedValue(new Error('invalid'))
    const hook=renderHook(()=>useFarmIntelligence('owner-a'));await waitFor(()=>expect(hook.result.current.loading).toBe(false))
    await act(async()=>{await expect(hook.result.current.save(emptyFarmProfile())).rejects.toThrow('could not be saved')})
    expect(hook.result.current.snapshot.profile?.estate.estate_name).toBe('Estate A');expect(hook.result.current.saving).toBe(false)
    expect(api.save).toHaveBeenCalledWith(expect.any(Object),expect.any(AbortSignal),'owner-a')
  })
})
