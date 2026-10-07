import { createClient } from 'supabase'
import { createRtcLookupHandler } from '../_shared/farmRtcHandler.ts'

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
  }
}))
