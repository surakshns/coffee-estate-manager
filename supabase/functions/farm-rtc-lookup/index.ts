import { createClient } from 'supabase'
import { createRtcLookupHandler } from '../_shared/farmRtcHandler.ts'
import { matchingHolderExtent } from '../_shared/farmEstateHoldings.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
})
Deno.serve(createRtcLookupHandler({
  authenticate: async token => {
    const { data: { user }, error } = await admin.auth.getUser(token)
    return error ? null : user?.id ?? null
  },
  claim: async userId => {
    const { data, error } = await admin.rpc('claim_farm_rtc_lookup', { p_user_id: userId })
    if (error) throw new Error('Lookup limit could not be checked.')
    return data === true
  },
  onRecord: async (userId, record) => {
    const { data: profile, error } = await admin.from('farm_estate_holder_profiles').select('holder_name,holder_aliases').eq('user_id',userId).maybeSingle()
    if (error || !profile) return
    const result = matchingHolderExtent(record,[profile.holder_name,...profile.holder_aliases])
    const saved = await admin.rpc('record_estate_holder_match', { p_user_id:userId,p_holder_name:profile.holder_name,p_holder_aliases:profile.holder_aliases,p_identity:record.identity,p_result:{matches:result.matches,acres:result.acres,landCode:record.landCode} })
    if (saved.error) throw new Error('Private marker refresh unavailable.')
  }
}))
