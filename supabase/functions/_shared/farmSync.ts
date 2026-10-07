import { SOURCE_URLS, fetchOfficialSource, parseFarmSource, allowedPublisherUrl, type SourceBatch } from './farmSources.ts'
import type { DataSourceStatus } from './farmIntelligence.ts'

// Each source owns its exact parser; this lifecycle keeps retrieval and
// persistence server-side and supports reviewed adapters without UI scraping.
export interface SourceAdapter {
  fetch(): ReturnType<typeof fetchOfficialSource>
  parse(html: string, retrievedAt: string): Promise<SourceBatch>
  normalize(batch: SourceBatch): SourceBatch
  validate(batch: SourceBatch): void
  persist(batch: SourceBatch): Promise<{ inserted: number; updated: number }>
}
export function makeFarmAdapter(source: DataSourceStatus, persist: SourceAdapter['persist'], fetcher: typeof fetch = fetch): SourceAdapter {
  const url = SOURCE_URLS[source.id]
  if (!url || !source.enabled || source.status !== 'ready') throw new Error('No enabled verified adapter.')
  return {
    fetch: () => fetchOfficialSource(url,fetcher),
    parse: (html,date) => parseFarmSource(source,html,date),
    normalize: batch => batch,
    validate(batch) {
      const keys = new Set(batch.updates.map(row => row.dedupe_key))
      if (!batch.updates.length || keys.size !== batch.updates.length) throw new Error('No records or duplicate source records; previous data retained.')
      if (batch.updates.some(row => row.source_id !== source.id || !allowedPublisherUrl(row.source_url) || !/^[a-f0-9]{64}$/.test(row.dedupe_key))) throw new Error('Invalid source provenance.')
      if ([...batch.prices,...batch.forecasts].some(row => !keys.has(row.update_key))) throw new Error('Unlinked source fact.')
    },
    persist
  }
}

export async function constantTimeSecret(provided: string, expected: string) {
  if (expected.length < 32 || provided.length > 512) return false
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))
  const [a,b] = await Promise.all([hash(provided),hash(expected)])
  let difference=0; for(let i=0;i<a.length;i++) difference |= a[i]^b[i]
  return difference===0
}
export interface FarmSyncStore {
  sources(): Promise<DataSourceStatus[]>
  claim(sourceId: string): Promise<boolean>
  start(sourceId: string): Promise<string>
  previousHash(sourceId: string): Promise<string | null>
  persist(sourceId: string,batch: SourceBatch): Promise<{ inserted: number; updated: number }>
  finish(sourceId: string,runId: string,success: boolean,metadata: Record<string,unknown>): Promise<void>
  refreshReferenceMaps?(): Promise<{ refreshed: number; skipped: number; failed: number }>
}
export function createFarmSyncHandler(store: FarmSyncStore, secret: string, fetcher: typeof fetch=fetch) {
  const json=(body: unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
  return async (request: Request) => {
    if (request.method!=='POST') return json({error:'POST required.'},405)
    if (!(await constantTimeSecret(request.headers.get('x-farm-sync-secret') ?? '',secret))) return json({error:'Unauthorized.'},401)
    // Public map refresh is independent of notices and never blocks a user map
    // read. Start after authentication and overlap the fixed publisher polls.
    const maps = store.refreshReferenceMaps?.().catch(() => ({refreshed:0,skipped:0,failed:1}))
    // No arbitrary URL, owner ID, request parser or user profile is accepted.
    const results: { source: string; status: string; records?: number }[]=[]
    try {
      for (const source of await store.sources()) {
        if (!SOURCE_URLS[source.id] || !source.enabled || source.status!=='ready' || !(await store.claim(source.id))) continue
        let runId: string | null=null, httpStatus: number | null=null, contentHash: string | null=null, records=0
        try {
          runId=await store.start(source.id)
          const previous=await store.previousHash(source.id)
          const adapter=makeFarmAdapter(source,batch=>store.persist(source.id,batch),fetcher)
          const response=await adapter.fetch(); httpStatus=response.http_status; contentHash=response.content_hash
          // Even unchanged HTML is revalidated and refreshes retrieval freshness.
          const batch=adapter.normalize(await adapter.parse(response.html,new Date().toISOString()))
          adapter.validate(batch); records=batch.updates.length
          const counts=await adapter.persist(batch)
          await store.finish(source.id,runId,true,{http_status:httpStatus,content_hash:contentHash,source_changed:previous!==contentHash,records_found:records,records_inserted:counts.inserted,records_updated:counts.updated,parse_errors:0})
          results.push({source:source.id,status:'updated',records})
        } catch(error) {
          const message=error instanceof Error ? error.message.slice(0,300) : 'Source fetch failed.'
          const statusMatch=/Publisher HTTP (\d{3})/.exec(message)
          await store.finish(source.id,runId ?? '',false,{http_status:httpStatus ?? (statusMatch?Number(statusMatch[1]):null),content_hash:contentHash,records_found:records,parse_errors:httpStatus===200?1:0,error_message:message})
          results.push({source:source.id,status:'failed; previous records retained'})
        }
      }
      const surveyMaps = await maps
      return json({results,...(surveyMaps ? {survey_maps:surveyMaps} : {})},results.some(result=>result.status.startsWith('failed')) || surveyMaps?.failed ?207:200)
    } catch { await maps; return json({error:'Sync could not complete. Check server source logs.'},500) }
  }
}
