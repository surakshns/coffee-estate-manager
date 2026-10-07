import { supabase } from './supabase'
import { emptyFarmProfile, type FarmSnapshot, type FarmProfile } from './farmIntelligence'

export const emptyFarmSnapshot = (): FarmSnapshot => ({profile:null,updates:[],prices:[],sources:[],stations:[],observations:[],alerts:[]})
export function mergeFarmProfile(profile: FarmProfile): FarmProfile {
  const defaults=emptyFarmProfile()
  return {...defaults,...profile,estate:{...defaults.estate,...profile.estate},blocks:profile.blocks ?? [],
    infrastructure:{...defaults.infrastructure,...profile.infrastructure},farmer:{...defaults.farmer,...profile.farmer},
    insurance:defaults.insurance.map(item=>({...item,...profile.insurance?.find(p=>p.crop===item.crop)})),
    preferences:defaults.preferences.map(item=>({...item,...profile.preferences?.find(p=>p.kind===item.kind)}))}
}
export function farmSetupMissing(error: unknown) {
  const record=error as {code?:string;message?:string}
  return ['42P01','42883','PGRST202','PGRST205'].includes(record?.code ?? '')
}
export async function loadFarmSnapshot(signal: AbortSignal,expectedOwner:string): Promise<FarmSnapshot> {
  // Independent from bookkeeping. Cap the display at the latest 500 records;
  // old source history is retained in the database, never described as complete.
  const requests=await Promise.all([
    supabase.rpc('get_farm_profile',{p_expected_user_id:expectedOwner}).abortSignal(signal),
    supabase.from('official_updates').select('*').order('retrieved_at',{ascending:false}).order('source_published_at',{ascending:false,nullsFirst:false}).limit(500).abortSignal(signal),
    supabase.from('market_prices').select('*').order('price_date',{ascending:false}).limit(200).abortSignal(signal),
    supabase.from('data_sources').select('id,source_name,source_url,source_type,source_authority_level,enabled,status,status_message,min_interval_minutes,last_success_at,last_checked_at').order('source_authority_level').abortSignal(signal),
    supabase.rpc('get_nearest_farm_station',{p_expected_user_id:expectedOwner}).abortSignal(signal),
    supabase.from('estate_alerts').select('update_id,read_at').eq('user_id',expectedOwner).order('created_at',{ascending:false}).limit(500).abortSignal(signal)
  ])
  for(const result of requests) if(result.error) throw result.error
  const stations=requests[4].data ?? []
  const observationResult=stations.length?await supabase.from('rainfall_observations').select('*').eq('station_id',stations[0].id).order('observed_at',{ascending:false}).limit(30).abortSignal(signal):{data:[],error:null}
  if(observationResult.error) throw observationResult.error
  return {profile:requests[0].data?mergeFarmProfile(requests[0].data as FarmProfile):null,updates:requests[1].data ?? [],prices:requests[2].data ?? [],sources:requests[3].data ?? [],stations,observations:observationResult.data ?? [],alerts:requests[5].data ?? []}
}
export async function markFarmAlertRead(estateId:string,updateId:string,userId:string,signal:AbortSignal) {
  const {error}=await supabase.from('estate_alerts').upsert({estate_id:estateId,user_id:userId,update_id:updateId,read_at:new Date().toISOString()},{onConflict:'estate_id,update_id'}).abortSignal(signal)
  if(error) throw error
}
export async function saveFarmProfile(profile: FarmProfile,signal: AbortSignal,expectedOwner:string) {
  const {data,error}=await supabase.rpc('save_farm_profile',{p_profile:profile,p_expected_user_id:expectedOwner}).abortSignal(signal)
  if(error) throw error
  return data as string
}
