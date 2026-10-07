import { readFileSync } from 'node:fs'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { allowedPublisherUrl, fetchOfficialSource, parseFarmSource, sourceDate, textOnly } from './farmSources.ts'
import { makeFarmAdapter, createFarmSyncHandler, type FarmSyncStore } from './farmSync.ts'
import type { DataSourceStatus } from './farmIntelligence.ts'

const source=(id:string):DataSourceStatus=>({id,source_name:id,source_url:'https://coffeeboard.gov.in/',source_type:'official',source_authority_level:1,enabled:true,status:'ready',status_message:'Test fixture',min_interval_minutes:720,last_checked_at:null,last_success_at:null})
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/${name}.html`,import.meta.url),'utf8')
const at='2026-10-07T00:00:00Z'
afterEach(()=>vi.useRealTimers())
describe('verified official source parsers',()=>{
  it('keeps the actual ICO and futures quote dates and distinct units',async()=>{
    const batch=await parseFarmSource(source('coffee-board-market'),fixture('coffee-market'),at)
    expect(batch.prices).toHaveLength(8)
    expect(batch.prices.slice(0,2).map(p=>[p.average_price,p.price_date,p.unit])).toEqual([[327.22,'2026-10-02','US cents/lb'],[167.81,'2026-10-02','US cents/lb']])
    expect(batch.prices.filter(p=>p.price_kind==='futures').every(p=>p.price_date==='2026-06-05')).toBe(true)
    expect(batch.prices.find(p=>p.grade==='Mar-2027')?.average_price).toBe(284.3)
    expect(batch.prices.find(p=>p.grade==='May-2027')?.average_price).toBe(280.9)
    expect(batch.updates.some(p=>p.summary.includes('Sakleshpur grower selling price'))).toBe(true)
  })
  it('preserves indicative pepper grades, null minimums and actual original date',async()=>{
    const batch=await parseFarmSource(source('spices-board-prices'),fixture('pepper-market'),at)
    expect(batch.prices.map(p=>[p.grade,p.average_price,p.min_price,p.max_price,p.unit,p.price_date])).toEqual([['Garbled',723,null,null,'INR/kg','2026-10-05'],['Ungarbled',703,null,null,'INR/kg','2026-10-05']])
    expect(batch.prices.every(p=>p.market==='Cochin'&&p.state==='KERALA')).toBe(true)
    expect(batch.updates.every(p=>p.state===null)).toBe(true) // market location isn't scheme eligibility geography
  })
  it('uses exact IMD district/date/text without calling yellow a heavy-rain alert',async()=>{
    const batch=await parseFarmSource(source('imd-hassan-warning'),fixture('imd-hassan'),at)
    expect(batch.forecasts[0]).toMatchObject({forecast_date:'2026-10-07',district:'Hassan',warning_colour:'yellow'})
    expect(batch.updates[0]).toMatchObject({source_published_at:'2026-10-06',effective_until:'2026-10-07',district:'Hassan'})
    expect(batch.updates[0].title).toContain('lightning')
    expect(batch.updates[0].title).not.toContain('heavy-rain')
    expect(batch.updates[0].summary).not.toContain('<img')
  })
  it('does not turn heavy wind into a heavy-rain warning',async()=>{
    const batch=await parseFarmSource(source('imd-hassan-warning'),fixture('imd-hassan').replace('Thunderstorm & Lightning, Squall etc','Heavy wind'),at)
    expect(batch.updates[0].title).not.toContain('heavy-rain')
  })
  it('deduplicates a notice when the publisher changes its row index',async()=>{
    const first=await parseFarmSource(source('coffee-board-news'),fixture('coffee-news'),at)
    const next=await parseFarmSource(source('coffee-board-news'),fixture('coffee-news').replace(/(DataList1_(?:Label1|LinkButton1))_\d+/g,'$1_500'),at)
    expect(first.updates[0].dedupe_key).toBe(next.updates[0].dedupe_key)
    expect(first.updates[0].verification_status).toBe('OFFICIAL_CONFIRMED')
  })
  it('does not collapse different notices with the same paraphrase/date',async()=>{
    const html='<span id="DataList1_Label1_0">01/09/2026</span><a id="DataList1_LinkButton1_0">Coffee training A</a><span id="DataList1_Label1_1">01/09/2026</span><a id="DataList1_LinkButton1_1">Coffee training B</a>'
    const batch=await parseFarmSource(source('coffee-board-news'),html,at)
    expect(new Set(batch.updates.map(p=>p.dedupe_key)).size).toBe(2)
  })
  it('fails on changed layout, ambiguous districts, invalid dates, units or missing values',async()=>{
    await expect(parseFarmSource(source('coffee-board-market'),'<p>maintenance</p>',at)).rejects.toThrow()
    await expect(parseFarmSource(source('spices-board-prices'),fixture('pepper-market').replace('Price(Rs./Kg)','Price(Rs./quintal)'),at)).rejects.toThrow('unit')
    await expect(parseFarmSource(source('imd-hassan-warning'),fixture('imd-hassan').replace('HASSAN','KODAGU'),at)).rejects.toThrow('Hassan')
    expect(()=>sourceDate('31/02/2026')).toThrow()
    expect(textOnly('<script>fetch("evil")</script><p>Safe &amp; plain</p>')).toBe('Safe & plain')
  })
  it('accepts an Indian publication day after UTC midnight rollover',async()=>{
    const batch=await parseFarmSource(source('coffee-board-news'),'<span id="DataList1_Label1_0">07/10/2026</span><a id="DataList1_LinkButton1_0">Coffee training</a>','2026-10-06T19:00:00Z')
    expect(batch.updates[0].source_published_at).toBe('2026-10-07')
  })
  it('keeps an explicitly completed training period out of current enrollment alerts',async()=>{
    const batch=await parseFarmSource(source('coffee-board-news'),'<span id="DataList1_Label1_0">02/02/2026</span><a id="DataList1_LinkButton1_0">Coffee training 02nd - 06th March 2026</a>',at)
    expect(batch.updates[0]).toMatchObject({effective_from:'2026-03-02',effective_until:'2026-03-06',verification_status:'EXPIRED'})
  })
  it('summarizes the actual diploma subject and academic year without inventing an admission deadline',async()=>{
    const html='<span id="DataList1_Label1_0">01/09/2026</span><a id="DataList1_LinkButton1_0">Applications invited for Post Graduate Diploma in Coffee Quality Management for the academic year 2026-27</a>'
    const row=(await parseFarmSource(source('coffee-board-news'),html,at)).updates[0]
    expect(row.title).toBe('Coffee quality diploma · 2026–27')
    expect(row.summary).toContain('postgraduate diploma in Coffee Quality Management')
    expect(row.application_deadline).toBeNull();expect(row.verification_status).toBe('UNVERIFIED')
    expect(row.details.notice_subject).toBe('quality_diploma')
  })
  it('recognizes a past month-only promotion period without inventing a precise event date',async()=>{
    const html='<span id="DataList1_Label1_0">01/04/2026</span><a id="DataList1_LinkButton1_0">Coffee Boards Participation in Foreign Promotion Events in April and early May 2026</a>'
    const row=(await parseFarmSource(source('coffee-board-news'),html,at)).updates[0]
    expect(row.verification_status).toBe('OFFICIAL_BUT_OLD')
    expect(row.summary).toContain('a past period')
    expect(row.effective_until).toBeNull();expect(row.application_deadline).toBeNull()
  })
})
describe('bounded server retrieval and cron authentication',()=>{
  it.each(['http://coffeeboard.gov.in/','https://coffeeboard.gov.in.evil.test/','https://localhost/','https://127.0.0.1/','https://user@coffeeboard.gov.in/','https://coffeeboard.gov.in:444/'])('rejects untrusted URL %s',url=>expect(allowedPublisherUrl(url)).toBe(false))
  it('validates redirects before following them',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('',{status:302,headers:{location:'https://internal.invalid/'}}))
    await expect(fetchOfficialSource('https://coffeeboard.gov.in/',fetcher)).rejects.toThrow('not allowed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects wrong MIME types and oversized bodies',async()=>{
    await expect(fetchOfficialSource('https://coffeeboard.gov.in/',vi.fn().mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}})))).rejects.toThrow('format')
    await expect(fetchOfficialSource('https://coffeeboard.gov.in/',vi.fn().mockResolvedValue(new Response('x',{headers:{'content-type':'text/html','content-length':'2000001'}})))).rejects.toThrow('large')
  })
  const secret='s'.repeat(40)
  const store=():FarmSyncStore=>({sources:vi.fn().mockResolvedValue([source('spices-board-prices')]),claim:vi.fn().mockResolvedValue(true),start:vi.fn().mockResolvedValue('run'),previousHash:vi.fn().mockResolvedValue(null),persist:vi.fn().mockResolvedValue({inserted:2,updated:0}),finish:vi.fn().mockResolvedValue(undefined)})
  it('denies unauthenticated requests before database access',async()=>{
    const db={...store(),refreshReferenceMaps:vi.fn()},handler=createFarmSyncHandler(db,secret)
    expect((await handler(new Request('https://edge.test',{method:'POST'}))).status).toBe(401)
    expect(db.sources).not.toHaveBeenCalled()
    expect(db.refreshReferenceMaps).not.toHaveBeenCalled()
    expect((await createFarmSyncHandler(db,'')(new Request('https://edge.test',{method:'POST',headers:{'x-farm-sync-secret':''}}))).status).toBe(401)
  })
  it('retains notice updates when a background map refresh fails',async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(at))
    const db={...store(),refreshReferenceMaps:vi.fn().mockRejectedValue(new Error('Publisher timeout'))}
    const fetcher=vi.fn().mockResolvedValue(new Response(fixture('pepper-market'),{headers:{'content-type':'text/html'}}))
    const reply=await createFarmSyncHandler(db,secret,fetcher)(new Request('https://edge.test',{method:'POST',headers:{'x-farm-sync-secret':secret}}))
    expect(reply.status).toBe(207);expect(db.persist).toHaveBeenCalledOnce()
    expect(await reply.json()).toMatchObject({survey_maps:{failed:1},results:[{source:'spices-board-prices',status:'updated'}]})
  })
  it('lets the independent map refresh finish when notice storage fails',async()=>{
    let finish!: (value:{refreshed:number;skipped:number;failed:number})=>void
    const maps=new Promise<{refreshed:number;skipped:number;failed:number}>(resolve=>{finish=resolve})
    const db={...store(),sources:vi.fn().mockRejectedValue(new Error('Database unavailable')),refreshReferenceMaps:vi.fn().mockReturnValue(maps)}
    let completed=false
    const pending=createFarmSyncHandler(db,secret)(new Request('https://edge.test',{method:'POST',headers:{'x-farm-sync-secret':secret}})).then(reply=>{completed=true;return reply})
    await vi.waitFor(()=>expect(db.refreshReferenceMaps).toHaveBeenCalledOnce())
    expect(completed).toBe(false)
    finish({refreshed:1,skipped:3,failed:0})
    expect((await pending).status).toBe(500)
  })
  it('fetches only configured publishers even if the caller sends a URL or owner',async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(at))
    const db=store(),fetcher=vi.fn().mockResolvedValue(new Response(fixture('pepper-market'),{headers:{'content-type':'text/html'}}))
    const reply=await createFarmSyncHandler(db,secret,fetcher)(new Request('https://edge.test',{method:'POST',headers:{'x-farm-sync-secret':secret},body:JSON.stringify({url:'https://evil.invalid/',user_id:'another-owner'})}))
    expect(reply.status).toBe(200);expect(fetcher.mock.calls[0][0]).toContain('indianspices.com')
    expect(db.persist).toHaveBeenCalledTimes(1)
    expect(db.finish).toHaveBeenCalledWith('spices-board-prices','run',true,expect.objectContaining({records_found:2,records_inserted:2,parse_errors:0,source_changed:true}))
  })
  it('logs parse failure without persisting or deleting previous data',async()=>{
    const db=store(),fetcher=vi.fn().mockResolvedValue(new Response('<p>maintenance</p>',{headers:{'content-type':'text/html'}}))
    const reply=await createFarmSyncHandler(db,secret,fetcher)(new Request('https://edge.test',{method:'POST',headers:{'x-farm-sync-secret':secret}}))
    expect(reply.status).toBe(207);expect(db.persist).not.toHaveBeenCalled()
    expect(db.finish).toHaveBeenCalledWith('spices-board-prices','run',false,expect.objectContaining({parse_errors:1}))
  })
  it('rejects an unverified or disabled source adapter',()=>{
    expect(()=>makeFarmAdapter({...source('ksndmc-observed'),enabled:false},vi.fn())).toThrow()
  })
})
