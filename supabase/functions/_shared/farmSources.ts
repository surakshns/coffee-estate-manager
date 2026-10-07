import { updateDedupeKey, indiaDate, type OfficialUpdate, type MarketPrice, type DataSourceStatus, type Crop } from './farmIntelligence.ts'

export const SOURCE_URLS: Record<string, string> = {
  'coffee-board-news': 'https://coffeeboard.gov.in/News.aspx',
  'coffee-board-market': 'https://coffeeboard.gov.in/',
  'spices-board-prices': 'https://www.indianspices.com/marketing/price/domestic/current-market-price',
  'imd-hassan-warning': 'https://mausam.imd.gov.in/imd_latest/contents/districtwise-warning_mc.php?id=13&day=Day_2'
}
const ALLOWED_HOSTS = new Set(['coffeeboard.gov.in', 'www.coffeeboard.gov.in', 'indianspices.com', 'www.indianspices.com', 'mausam.imd.gov.in'])
export function allowedPublisherUrl(value: string) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ALLOWED_HOSTS.has(u.hostname) } catch { return false }
}
export function textOnly(html: string) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g,' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,code:string) => { const n = code[0].toLowerCase()==='x' ? parseInt(code.slice(1),16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ' })
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/\s+/g,' ').trim()
}
export function sourceDate(raw: string) {
  let value = raw.trim(), match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (match) value = `${match[3]}-${match[2]}-${match[1]}`
  else {
    match = /^(\d{1,2})[- ]([A-Za-z]+)[- ,]+(\d{4})$/.exec(value)
    if (match) { const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2].slice(0,3).toLowerCase()); if (month < 0) throw new Error('Unrecognized source month.'); value = `${match[3]}-${String(month+1).padStart(2,'0')}-${match[1].padStart(2,'0')}` }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) !== value) throw new Error('Invalid source date.')
  return value
}
export interface SourceBatch { updates: OfficialUpdate[]; prices: (MarketPrice & { update_key: string })[]; forecasts: { update_key: string; forecast_date: string; district: string; warning_colour: string; warning_text: string }[] }
const span = (html: string, id: string) => textOnly(new RegExp(`<span[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/span>`, 'i').exec(html)?.[1] ?? '')
const number = (raw: string): number | null => { if (/^(?:-|—|\s*)$/.test(raw)) return null; const n = Number(raw.replace(/,/g,'')); if (!Number.isFinite(n) || n < 0) throw new Error('Invalid numeric price.'); return n }
async function update(source: Pick<DataSourceStatus,'id'|'source_name'|'source_type'|'source_authority_level'>, now: string, values: Partial<OfficialUpdate> & Pick<OfficialUpdate,'title'|'category'|'crops'|'source_url'|'raw_source_reference'>): Promise<OfficialUpdate> {
  const row: OfficialUpdate = {
    source_id:source.id,source_name:source.source_name,source_type:source.source_type,source_authority_level:source.source_authority_level,
    retrieved_at:now,source_published_at:null,source_updated_at:null,effective_from:null,effective_until:null,financial_year:null,season:null,
    verification_status:'OFFICIAL_CONFIRMED',summary:'Open the official source to confirm its scope and instructions.',state:null,district:null,taluk:null,village:null,application_deadline:null,application_url:null,details:{},dedupe_key:'',...values
  }
  row.dedupe_key = await updateDedupeKey(source.id, row.source_url, row.title, row.source_published_at ?? row.effective_from)
  if (!allowedPublisherUrl(row.source_url) || row.title.length > 500 || row.summary.length > 2000 || row.crops.some(c => !['COFFEE','PEPPER','ARECANUT'].includes(c))) throw new Error('Invalid normalized source record.')
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid retrieval time.')
  if (row.source_published_at && row.source_published_at.slice(0,10) > indiaDate(new Date(now))) throw new Error('Source publication date is in the future.')
  return row
}
export async function parseFarmSource(source: Pick<DataSourceStatus,'id'|'source_name'|'source_type'|'source_authority_level'>, html: string, retrievedAt: string): Promise<SourceBatch> {
  const batch: SourceBatch = {updates:[],prices:[],forecasts:[]}
  const baseUrl = SOURCE_URLS[source.id]
  if (!baseUrl) throw new Error('No verified adapter exists for this source.')
  if (source.id === 'coffee-board-news') {
    const dates = [...html.matchAll(/<span[^>]+id="DataList1_Label1_(\d+)"[^>]*>([\s\S]*?)<\/span>/g)]
    if (!dates.length) throw new Error('Coffee Board news structure changed.')
    for (const date of dates) {
      const title = textOnly(new RegExp(`<a[^>]+id="DataList1_LinkButton1_${date[1]}"[^>]*>([\\s\\S]*?)<\\/a>`).exec(html)?.[1] ?? '')
      if (!title) throw new Error('Coffee Board notice has no matching title.')
      if (/walk.?in|post of|position of|short.?listed|provisionally selected|list of.*candidate|young professional|recruitment/i.test(title)) continue
      if (!/coffee|grower|training|scheme|subsid|hybrid|package of practices/i.test(title)) continue
      const training = /training|diploma/i.test(title), scheme = /scheme|subsid|assistance/i.test(title)
      const coffeeTypes=/arabica/i.test(title)?['Arabica']:/robusta/i.test(title)?['Robusta']:null
      const diploma = /diploma.*coffee quality management/i.test(title), promotion = /foreign.*promot/i.test(title)
      const academicYear = diploma ? /academic year\s+(20\d{2})[-\s]+(20\d{2}|\d{2})\b/i.exec(title) : null
      const promotionalYear = promotion ? /financial year\s+(20\d{2})[-\s]+(20\d{2}|\d{2})\b/i.exec(title) : null
      const course = /kaapi\s*shastra/i.test(title) ? 'Kaapi Shastra coffee training' : /Q\s+processing/i.test(title) ? 'Coffee processing training announcement' : 'Coffee training announcement'
      const label = /hybrid/i.test(title) ? `Coffee Board announces ${coffeeTypes?.[0]??'coffee'} hybrids` : /NTA|non.traditional/i.test(title) ? 'Coffee practices for non-traditional growing regions' : diploma ? `Coffee quality diploma${academicYear?` · ${academicYear[1]}–${academicYear[2]}`:''}` : promotion ? `Overseas coffee promotion${promotionalYear?` · ${promotionalYear[1]}–${promotionalYear[2]}`:''}` : training ? course : scheme ? 'Coffee Board scheme announcement' : 'Coffee Board grower announcement'
      const published = sourceDate(textOnly(date[2]))
      const namedHybrids = /CCRI\s*Suraksha/i.test(title) && /CCRI\s*Shatabdi/i.test(title)
      const summary = /hybrid/i.test(title) ? `${namedHybrids?'CCRI Suraksha and CCRI Shatabdi are two announced Arabica F1 hybrids.':'The Board has announced new coffee planting material.'} Availability and suitability for your site need confirmation.` : diploma ? `The Board has published a call for its postgraduate diploma in Coffee Quality Management${academicYear?` for ${academicYear[1]}–${academicYear[2]}`:''}. The application deadline and current admission status have not been verified.` : promotion ? `The Board has announced participation in overseas coffee promotional events${promotionalYear?` for financial year ${promotionalYear[1]}–${promotionalYear[2]}`:''}. Participation requirements and event-specific dates need confirmation.` : training ? 'The Board has announced coffee training. Course location, fees and current enrollment availability need confirmation.' : scheme ? 'The Board has published a scheme-related notice. The current application window, component rules and eligibility still need verification.' : 'A grower announcement is listed by the Coffee Board. Confirm its current scope and instructions with the Board.'
      const row = await update(source,retrievedAt,{title:label,category:training?'training':scheme?'schemes':'government',crops:['COFFEE'],source_url:baseUrl,raw_source_reference:`DataList1 notice ${date[1]}; publisher date and interactive notice on News.aspx; no stable item permalink`,source_published_at:published,summary,verification_status:/hybrid/i.test(title)?'OFFICIAL_CONFIRMED':'UNVERIFIED',financial_year:promotionalYear?`${promotionalYear[1]}–${promotionalYear[2]}`:null,details:{scope:/NTA|non.traditional/i.test(title)?'non_traditional_area':'national',rules_verified:false,notice_subject:/hybrid/i.test(title)?'arabica_hybrids':diploma?'quality_diploma':promotion?'foreign_promotion':training?'coffee_training':'grower_notice'}})
      // A month-only past event is an older notice, not an invented exact deadline.
      const oldPromotion = promotion ? /April and early May\s+(20\d{2})/i.exec(title) : null
      if (oldPromotion && `${oldPromotion[1]}-05` < indiaDate(new Date(retrievedAt)).slice(0,7)) {
        row.verification_status = 'OFFICIAL_BUT_OLD'
        row.details.notice_period = `April and early May ${oldPromotion[1]}`
        row.summary = `This promotional-event announcement covers April and early May ${oldPromotion[1]}, a past period. Check for a newer event schedule.`
      }
      // Hash the original headline without reproducing it. Distinct notices can
      // share a publication date and paraphrase; indices change on new releases.
      row.dedupe_key = await updateDedupeKey(source.id, baseUrl, title, published)
      if(coffeeTypes)row.details.coffee_types=coffeeTypes
      const period=training?/(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(20\d{2})/i.exec(title):null
      if(period) {
        row.effective_from=sourceDate(`${period[1]}-${period[3]}-${period[4]}`)
        row.effective_until=sourceDate(`${period[2]}-${period[3]}-${period[4]}`)
        if(row.effective_from>row.effective_until)throw new Error('Invalid training period.')
        if(row.effective_until<indiaDate(new Date(retrievedAt)))row.verification_status='EXPIRED'
      }
      batch.updates.push(row)
    }
  } else if (source.id === 'coffee-board-market') {
    const date = sourceDate(span(html,'GridView1_Label2_0'))
    for (const [id,label,variety] of [['GridView1_lblothermilds_0','ICO Other Milds indicator','Other Milds'],['GridView1_lblrobustas_0','ICO Robustas indicator','Robustas']]) {
      const value = number(span(html,id)); if (value === null) throw new Error('Coffee indicator missing.')
      const row = await update(source,retrievedAt,{title:label,category:'prices',crops:['COFFEE'],source_url:baseUrl,raw_source_reference:id,source_published_at:date,summary:'International coffee indicator in US cents/lb; this is not a Sakleshpur grower selling price.',details:{price_date:date,price_kind:'international_indicator',unit:'US cents/lb',value}})
      batch.updates.push(row); batch.prices.push({update_key:row.dedupe_key,source_id:source.id,crop:'COFFEE',variety,grade:null,market:'ICO international indicator',district:null,state:null,min_price:null,max_price:null,modal_price:null,average_price:value,unit:'US cents/lb',price_date:date,price_kind:'international_indicator',source_url:baseUrl,retrieved_at:retrievedAt})
    }
    const futuresDate = sourceDate(span(html,'GridView1_lbldate1_0'))
    const table = /<table\b[^>]*class="price-table"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1]
    if (!table) throw new Error('Coffee market table changed.')
    for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>textOnly(c[1]))
      if (cells.length !== 4 || !/^[A-Za-z]{3}-\d{4}$/.test(cells[0]) || !/^[A-Za-z]{3}-\d{4}$/.test(cells[2])) continue
      for (const [index,variety,market,unit] of [[0,'Arabica','ICE New York','US cents/lb'],[2,'Robusta','LIFFE London','USD/tonne']] as const) {
        const value = number(cells[index+1]); if (value === null) throw new Error('Coffee futures price missing.')
        const row = await update(source,retrievedAt,{title:`${variety} futures ${cells[index]}`,category:'prices',crops:['COFFEE'],source_url:baseUrl,raw_source_reference:`price-table ${variety} ${cells[index]}`,source_published_at:futuresDate,summary:'International futures contract; quote date is from the futures section, not the homepage date.',details:{price_date:futuresDate,price_kind:'futures',contract_month:cells[index],unit,value}})
        batch.updates.push(row); batch.prices.push({update_key:row.dedupe_key,source_id:source.id,crop:'COFFEE',variety,grade:cells[index],market,district:null,state:null,min_price:null,max_price:null,modal_price:null,average_price:value,unit,price_date:futuresDate,price_kind:'futures',source_url:baseUrl,retrieved_at:retrievedAt})
      }
    }
    if(batch.prices.filter(price=>price.price_kind==='futures').length<2)throw new Error('Coffee futures contract rows changed.')
  } else if (source.id === 'spices-board-prices') {
    const section = html.slice(html.indexOf('class="tabstable marketprice"'))
    if (!section || !/Price\(Rs\.\/Kg\)/.test(section)) throw new Error('Spices market layout/unit changed.')
    const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(section)?.[1]
    if (!body) throw new Error('Spices price table missing.')
    for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>textOnly(c[1]))
      if (cells.length !== 9) throw new Error('Spices price row changed.')
      if (!/^pepper$/i.test(cells[1])) continue
      const date=sourceDate(cells[0]), minimum=number(cells[6]),maximum=number(cells[7]),average=number(cells[8])
      if (average===null || (minimum!==null && maximum!==null && minimum>maximum)) throw new Error('Invalid pepper quote.')
      const row=await update(source,retrievedAt,{title:`Pepper ${cells[4]} · ${cells[2]} indicative price`,category:'prices',crops:['PEPPER'],source_url:baseUrl,raw_source_reference:`marketprice ${date} ${cells[2]} ${cells[4]} ${cells[5]}`,source_published_at:date,summary:'Indicative market average in INR/kg. Quality, origin and transaction prices vary; this is not guaranteed estate proceeds.',details:{price_date:date,price_kind:'indicative',unit:'INR/kg',value:average,market:cells[2],grade:cells[4],reporter:cells[5]}})
      batch.updates.push(row);batch.prices.push({update_key:row.dedupe_key,source_id:source.id,crop:'PEPPER',variety:null,grade:cells[4],market:cells[2],district:null,state:cells[3],min_price:minimum,max_price:maximum,modal_price:null,average_price:average,unit:'INR/kg',price_date:date,price_kind:'indicative',source_url:baseUrl,retrieved_at:retrievedAt})
    }
    if (!batch.prices.length) throw new Error('No validated pepper records; previous prices are retained.')
  } else if (source.id === 'imd-hassan-warning') {
    const check=/var\s+check\s*=\s*"(Day_[1-5])"/.exec(html)?.[1]
    if (!check) throw new Error('IMD selected day missing.')
    const header=new RegExp(`value="${check}"[^>]*>\\s*([A-Za-z]+ \\d{1,2}, \\d{4})`).exec(html)?.[1]
    if (!header) throw new Error('IMD forecast date missing.')
    const parts=/^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(header)!
    const date=sourceDate(`${parts[2]}-${parts[1]}-${parts[3]}`)
    const records=JSON.parse(extractJsonArray(html,'"areas":')) as unknown
    if (!Array.isArray(records)) throw new Error('IMD warning array missing.')
    const hassan=records.filter(r=>r && typeof r==='object' && (r as Record<string,unknown>).title==='HASSAN') as Record<string,unknown>[]
    if (hassan.length!==1 || typeof hassan[0].balloonText!=='string' || typeof hassan[0].color!=='string') throw new Error('IMD Hassan record missing or ambiguous.')
    const colours:Record<string,string>={'#FFFF00':'yellow','#FFA500':'orange','#FF0000':'red','#00FF00':'green','#FFFFFF':'white'}
    const colour=colours[hassan[0].color.toUpperCase()];if(!colour)throw new Error('Unknown IMD warning colour.')
    const description=textOnly(hassan[0].balloonText),published=/Updated on:\s*(\d{4}-\d{2}-\d{2})/.exec(description)?.[1]
    if (!published) throw new Error('IMD issue date missing.')
    const warning=description.replace(/^HASSAN\s*:\s*/,'').replace(/Updated on:.*$/,'').trim()
    if (!warning) throw new Error('IMD warning description missing.')
    const crops:Crop[]=['COFFEE','PEPPER','ARECANUT']
    const heavyRain=['yellow','orange','red'].includes(colour)&&/\bheavy\s+rain(?:fall)?\b/i.test(warning)&&!/\bno\s+(?:very\s+|extremely\s+)?heavy\s+rain(?:fall)?\b/i.test(warning)
    const row=await update(source,retrievedAt,{title:heavyRain?'IMD Hassan heavy-rain warning':/thunder|lightning/i.test(warning)?'IMD Hassan thunderstorm and lightning warning':'IMD Hassan district weather update',category:'weather',crops,source_url:baseUrl,raw_source_reference:`IMD district ${String(hassan[0].id)} ${check} ${date}`,source_published_at:sourceDate(published),effective_from:date,effective_until:date,state:'Karnataka',district:'Hassan',summary:warning,details:{forecast_date:date,warning_colour:colour,measurement_type:'official_district_warning',provider_district_id:hassan[0].id}})
    batch.updates.push(row);batch.forecasts.push({update_key:row.dedupe_key,forecast_date:date,district:'Hassan',warning_colour:colour,warning_text:warning})
  }
  return batch
}
export function extractJsonArray(html:string,key:string) {
  const index=html.indexOf(key);if(index<0)throw new Error('Source JSON marker missing.')
  const start=html.indexOf('[',index+key.length);if(start<0)throw new Error('Source JSON array missing.')
  let depth=0,quoted=false,escaped=false
  for(let i=start;i<html.length;i++) { const c=html[i];if(quoted) {if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue} if(c==='"')quoted=true;else if(c==='[')depth++;else if(c===']' && --depth===0)return html.slice(start,i+1) }
  throw new Error('Incomplete source JSON array.')
}

// Request only verified publishers. Redirect destinations are revalidated before fetch.
export async function fetchOfficialSource(url:string, fetcher:typeof fetch=fetch) {
  let current=url
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
  try {
    for(let redirects=0;redirects<=3;redirects++) {
      if(!allowedPublisherUrl(current))throw new Error('Publisher URL is not allowed.')
      const response=await fetcher(current,{redirect:'manual',signal:controller.signal,headers:{Accept:'text/html','User-Agent':'CoffeeEstateManager/1.0 (official source metadata; respectful scheduled fetch)'}})
      if(response.status>=300 && response.status<400) { const location=response.headers.get('location');if(!location)throw new Error('Publisher redirect has no location.');await response.body?.cancel();current=new URL(location,current).href;continue }
      if(!response.ok) {await response.body?.cancel();throw new Error(`Publisher HTTP ${response.status}.`)}
      const type=response.headers.get('content-type') ?? '';if(!/text\/html|application\/xhtml/i.test(type)) {await response.body?.cancel();throw new Error('Unexpected publisher response format.')}
      if(Number(response.headers.get('content-length'))>2000000) {await response.body?.cancel();throw new Error('Publisher response too large.')}
      const reader=response.body?.getReader();if(!reader)throw new Error('Publisher response has no body.')
      const chunks:Uint8Array[]=[];let length=0
      for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000000){await reader.cancel();throw new Error('Publisher response too large.')}chunks.push(value)}
      const buffer=new Uint8Array(length);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length}
      return {html:new TextDecoder().decode(buffer),http_status:response.status,content_hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('')}
    }
    throw new Error('Too many publisher redirects.')
  } finally {clearTimeout(timer)}
}
