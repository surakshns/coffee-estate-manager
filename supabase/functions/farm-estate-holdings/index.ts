import { createClient } from 'supabase'
import { createEstateHoldingsHandler, type EstateHolderJob, type EstateHoldingsStatus } from '../_shared/farmEstateHoldingsHandler.ts'
import { matchingHolderExtent } from '../_shared/farmEstateHoldings.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
})
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error('Estate matching database operation failed.')
  return result.data
}
Deno.serve(createEstateHoldingsHandler({
  async authenticate(token) {
    const { data: { user }, error } = await admin.auth.getUser(token)
    return error ? null : user?.id ?? null
  },
  async claimUserLookup(userId) {
    return checked(await admin.rpc('claim_farm_rtc_lookup', { p_user_id: userId })) === true
  },
  async getStatus(userId) {
    return checked(await admin.rpc('estate_holder_status', { p_user_id: userId })) as EstateHoldingsStatus | null
  },
  async setProfile(userId, holderName, identity, record) {
    checked(await admin.rpc('configure_estate_holder', { p_user_id: userId, p_holder_name: holderName, p_anchor: identity }))
    const profile = checked(await admin.from('farm_estate_holder_profiles').select('holder_name,holder_aliases').eq('user_id',userId).single())
    const match = matchingHolderExtent(record, [profile.holder_name,...profile.holder_aliases])
    checked(await admin.rpc('record_estate_holder_match', { p_user_id: userId, p_holder_name: profile.holder_name, p_holder_aliases: profile.holder_aliases, p_identity: identity,
      p_result: { matches: match.matches, acres: match.acres, landCode: record.landCode } }))
  },
  async claimJob(signal) {
    return checked(await admin.rpc('claim_estate_holder_job').abortSignal(signal!)) as EstateHolderJob | null
  },
  async finishJob(job, result, signal) {
    return checked(await admin.rpc('finish_estate_holder_job', { p_id: job.id, p_token: job.token, p_result: result }).abortSignal(signal!)) === true
  }
}, Deno.env.get('FARM_INTELLIGENCE_SYNC_SECRET') ?? ''))
