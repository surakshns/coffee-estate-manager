import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyFarmSnapshot, farmSetupMissing, loadFarmSnapshot, saveFarmProfile, markFarmAlertRead } from '../lib/farmIntelligenceClient'
import type { FarmProfile, FarmSnapshot } from '../lib/farmIntelligence'

export function useFarmIntelligence(userId: string) {
  const [state,setState]=useState<{owner:string;snapshot:FarmSnapshot;loading:boolean;saving:boolean;setupReady:boolean;error:string}>({owner:userId,snapshot:emptyFarmSnapshot(),loading:true,saving:false,setupReady:true,error:''})
  const owner=useRef(userId);owner.current=userId
  const generation=useRef(0),controller=useRef<AbortController | null>(null),saveController=useRef<AbortController | null>(null),reads=useRef(new Set<AbortController>())
  const refresh=useCallback(async () => {
    const request=++generation.current,requestedOwner=userId
    controller.current?.abort();const abort=new AbortController();controller.current=abort
    const timer=setTimeout(()=>abort.abort(),25000)
    setState(previous=>({...previous,owner:requestedOwner,snapshot:previous.owner===requestedOwner?previous.snapshot:emptyFarmSnapshot(),loading:true,error:''}))
    try {
      const snapshot=await loadFarmSnapshot(abort.signal,requestedOwner)
      if(owner.current===requestedOwner && generation.current===request && !abort.signal.aborted) setState(previous=>({...previous,snapshot,loading:false,error:'',setupReady:true}))
    } catch(error) {
      if(owner.current===requestedOwner && generation.current===request) setState(previous=>({...previous,loading:false,setupReady:!farmSetupMissing(error),error:farmSetupMissing(error)?'Farm Intelligence needs its database migration. Your existing records are available as usual.':abort.signal.aborted?'The request timed out. Try refreshing.':'Farm Intelligence could not be loaded. Check your connection and refresh.'}))
    } finally {clearTimeout(timer)}
  },[userId])
  useEffect(()=>{void refresh();return()=>{generation.current++;controller.current?.abort();saveController.current?.abort();for(const read of reads.current)read.abort();reads.current.clear()}},[refresh])
  const save=useCallback(async (profile: FarmProfile) => {
    if(saveController.current) throw new Error('A profile save is already in progress.')
    const requestedOwner=userId,abort=new AbortController();saveController.current=abort
    const timer=setTimeout(()=>abort.abort(),25000)
    setState(previous=>({...previous,saving:true}))
    try {
      const estateId=await saveFarmProfile(profile,abort.signal,requestedOwner)
      if(owner.current!==requestedOwner || abort.signal.aborted) throw new Error('Your session changed or the save response timed out. Refresh before retrying.')
      setState(previous=>({...previous,snapshot:{...previous.snapshot,profile:{...profile,estate:{...profile.estate,id:estateId}}}}))
      await refresh()
    } catch(error) {
      if(abort.signal.aborted) throw new Error('The save response timed out. Refresh to check whether the profile was saved before retrying.')
      const message=error instanceof Error?error.message:(error as {message?:string})?.message
      throw new Error(message?.includes('physical block')?message:'The profile could not be saved. Check your areas, plant counts and location values, then try again.')
    } finally { clearTimeout(timer);saveController.current=null;if(owner.current===requestedOwner) setState(previous=>({...previous,saving:false})) }
  },[userId,refresh])
  const markRead=useCallback(async (estateId:string,updateId:string)=>{
    const requestedOwner=userId,abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000)
    reads.current.add(abort)
    try { await markFarmAlertRead(estateId,updateId,userId,abort.signal);if(owner.current===requestedOwner&&!abort.signal.aborted)setState(previous=>({...previous,snapshot:{...previous.snapshot,alerts:[...previous.snapshot.alerts.filter(a=>a.update_id!==updateId),{update_id:updateId,read_at:new Date().toISOString()}]}})) }
    finally {clearTimeout(timer);reads.current.delete(abort)}
  },[userId])
  if(state.owner!==userId) return {snapshot:emptyFarmSnapshot(),loading:true,saving:false,setupReady:true,error:'',refresh,save,markRead}
  return {...state,refresh,save,markRead}
}
