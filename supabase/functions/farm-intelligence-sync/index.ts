import { createClient } from 'supabase'
import { createFarmSyncHandler, type FarmSyncStore } from '../_shared/farmSync.ts'
import { refreshSurveyMaps } from '../_shared/farmSurveyMap.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
function checked<T>(result: {data:T;error:unknown}): T { if(result.error) throw new Error('Database operation failed.'); return result.data }
const store: FarmSyncStore = {
  async refreshReferenceMaps() {
    return refreshSurveyMaps({
      async get(villageCode, layer) { return checked(await admin.from('farm_survey_maps').select('retrieved_at').eq('village_code',villageCode).eq('layer',layer).maybeSingle()) },
      async save(row) { checked(await admin.from('farm_survey_maps').upsert(row,{onConflict:'village_code,layer'})) }
    })
  },
  async sources() { return checked(await admin.from('data_sources').select('*').eq('enabled',true).eq('status','ready')) ?? [] },
  async claim(sourceId) { return !!checked(await admin.rpc('claim_farm_source',{p_source_id:sourceId})) },
  async start(sourceId) { const row=checked(await admin.from('source_fetch_runs').insert({source_id:sourceId}).select('id').single());if(!row)throw new Error('Fetch log unavailable.');return row.id },
  async previousHash(sourceId) { const rows=checked(await admin.from('source_fetch_runs').select('content_hash').eq('source_id',sourceId).eq('parse_errors',0).gt('records_found',0).order('started_at',{ascending:false}).limit(1));return rows?.[0]?.content_hash ?? null },
  async persist(sourceId,batch) { return checked(await admin.rpc('persist_farm_source_batch',{p_source_id:sourceId,p_batch:batch})) },
  async finish(sourceId,runId,success,metadata) {
    try { if(runId) checked(await admin.from('source_fetch_runs').update({...metadata,finished_at:new Date().toISOString()}).eq('id',runId)) }
    finally { checked(await admin.rpc('finish_farm_source',{p_source_id:sourceId,p_success:success})) }
  }
}
Deno.serve(createFarmSyncHandler(store,Deno.env.get('FARM_INTELLIGENCE_SYNC_SECRET') ?? ''))
