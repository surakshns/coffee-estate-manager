import { useMemo, useRef, useState, type FormEvent } from 'react'
import { money, productionMetrics } from '../lib/calculations'
import { estateToday } from '../lib/estateDates'
import { errorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import type { EstateData, ProductionRecord, Sale } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState, Notice, PageHeading, RecordActions, SearchField, Sheet, ViewTabs, displayDate } from './Workspace'

const productionBlank = (year: number) => ({ production_year: String(year), bags_produced: '', bag_weight_kg: '50', notes: '' })
const saleBlank = (year: number) => ({ production_year: String(year), sale_date: estateToday(), bags_sold: '', selling_price_per_bag: '', buyer: '' })
type View = 'harvest' | 'sales' | 'results'

export function Production({ data, year, refresh }: { data: EstateData; year: number; refresh: () => Promise<void> }) {
  const [production, setProduction] = useState(() => productionBlank(year))
  const [sale, setSale] = useState(() => saleBlank(year))
  const [editingProduction, setEditingProduction] = useState<ProductionRecord | null>(null)
  const [editingSale, setEditingSale] = useState<Sale | null>(null)
  const [removeProduction, setRemoveProduction] = useState<ProductionRecord | null>(null)
  const [removeSale, setRemoveSale] = useState<Sale | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const writing = useRef(false)
  const [recordError, setRecordError] = useState('')
  const [editor, setEditor] = useState<'harvest' | 'sales' | null>(null)
  const [view, setView] = useState<View>('harvest')
  const [search, setSearch] = useState('')
  const [allYears, setAllYears] = useState(false)
  const metrics = useMemo(() => productionMetrics(data.production, data.sales, data.expenses, data.weeklyPayments, year), [data.production, data.sales, data.expenses, data.weeklyPayments, year])
  const harvests = data.production.filter(item => (allYears || item.production_year === year) && `${item.production_year} ${item.notes ?? ''}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.production_year - a.production_year)
  const sales = data.sales.filter(item => (allYears || item.production_year === year) && `${item.buyer} ${item.sale_date} ${item.production_year}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.sale_date.localeCompare(a.sale_date))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (writing.current) return
    writing.current = true; setSaving(true); setError('')
    try {
      if (editor === 'harvest') {
        const payload = { production_year: Number(production.production_year), bags_produced: Number(production.bags_produced), bag_weight_kg: Number(production.bag_weight_kg), notes: production.notes || null }
        const { error } = await (editingProduction ? supabase.from('production_records').update(payload).eq('id', editingProduction.id) : supabase.from('production_records').insert(payload))
        if (error) throw error
        setProduction(productionBlank(year)); setEditingProduction(null)
        setMessage('Harvest saved.'); setView('harvest')
      } else {
        const payload = { production_year: Number(sale.production_year), sale_date: sale.sale_date, bags_sold: Number(sale.bags_sold), selling_price_per_bag: Number(sale.selling_price_per_bag), buyer: sale.buyer }
        const { error } = await (editingSale ? supabase.from('sales').update(payload).eq('id', editingSale.id) : supabase.from('sales').insert(payload))
        if (error) throw error
        setSale(saleBlank(year)); setEditingSale(null)
        setMessage('Sale saved.'); setView('sales')
      }
      setEditor(null); await refresh()
    } catch (error) { setError(errorMessage(error, 'Could not save this record. Please try again.')) }
    finally { writing.current = false; setSaving(false) }
  }
  async function deleteRecord(table: 'production_records' | 'sales', id: string) {
    if (writing.current) return
    writing.current = true; setRecordError(''); setMessage('')
    try {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
      setMessage('Record deleted.'); await refresh()
    } catch (cause) { setRecordError(errorMessage(cause, 'Could not delete this record.')) }
    finally { writing.current = false }
  }
  function startProductionEdit(item: ProductionRecord) { setEditingProduction(item); setProduction({ production_year: String(item.production_year), bags_produced: String(item.bags_produced), bag_weight_kg: String(item.bag_weight_kg), notes: item.notes ?? '' }); setError(''); setEditor('harvest') }
  function startSaleEdit(item: Sale) { setEditingSale(item); setSale({ production_year: String(item.production_year), sale_date: item.sale_date, bags_sold: String(item.bags_sold), selling_price_per_bag: String(item.selling_price_per_bag), buyer: item.buyer }); setError(''); setEditor('sales') }
  function addRecord() {
    setError('')
    if (view === 'sales') { setEditingSale(null); setSale(saleBlank(year)); setEditor('sales') }
    else { setEditingProduction(null); setProduction(productionBlank(year)); setEditor('harvest') }
  }
  return <div className="page workspace-page">
    <PageHeading title="Harvest & sales" detail={`Production year ${year}`} action={view === 'sales' ? 'Add sale' : 'Add harvest'} onAction={addRecord} />
    <Notice>{message}</Notice><Notice error>{recordError}</Notice>
    <div className="harvest-metrics">{[['Bags produced', metrics.bagsProduced.toLocaleString()], ['Bags sold', metrics.bagsSold.toLocaleString()], [metrics.remainingBags < 0 ? 'Stock shortfall' : 'Bags remaining', Math.abs(metrics.remainingBags).toLocaleString()], ['Crop sales', money(metrics.revenue)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    {metrics.remainingBags < 0 && <Notice error>Sales exceed recorded harvest by {Math.abs(metrics.remainingBags).toLocaleString()} bags. Check the production year and record any missing harvest.</Notice>}
    <ViewTabs<View> label="Harvest views" value={view} onChange={value => { setView(value); setSearch('') }} items={[{ value: 'harvest', label: 'Harvest' }, { value: 'sales', label: 'Sales' }, { value: 'results', label: 'Results' }]} />
    {view !== 'results' && <><section className="workspace-filters" aria-label="Harvest filters"><div className="filter-row"><SearchField label={view === 'sales' ? 'Search sales' : 'Search harvest'} placeholder={view === 'sales' ? 'Search buyer or date' : 'Search notes or year'} value={search} onChange={setSearch} /><select className="field filter-select" aria-label="Record years" value={allYears ? 'all' : 'selected'} onChange={e => setAllYears(e.target.value === 'all')}><option value="selected">{year} production year</option><option value="all">All production years</option></select></div></section><div className="results-toolbar"><p>{view === 'harvest' ? harvests.length : sales.length} records · {allYears ? 'All production years' : year}</p></div></>}
    {view === 'harvest' && <section aria-label="Harvest records">{harvests.length ? harvests.map(item => <article key={item.id} className="harvest-record"><div><h3>{Number(item.bags_produced).toLocaleString()} bags produced</h3><p>{item.production_year} harvest · {item.bag_weight_kg} kg per bag · {(Number(item.bags_produced) * Number(item.bag_weight_kg)).toLocaleString()} kg total</p>{item.notes && <p>{item.notes}</p>}</div><RecordActions name={`${item.production_year} harvest`} onEdit={() => startProductionEdit(item)} onDelete={() => setRemoveProduction(item)} /></article>) : <EmptyState title="No harvest records in this view" action="Add harvest" onAction={addRecord} />}</section>}
    {view === 'sales' && <section aria-label="Sales records">{sales.length ? sales.map(item => <article key={item.id} className="harvest-record"><div><h3>{item.buyer || 'Unnamed buyer'}</h3><p>{displayDate(item.sale_date)} · {item.production_year} harvest</p><p>{item.bags_sold} bags × {money(Number(item.selling_price_per_bag))} per bag</p></div><strong className="record-amount">{money(Number(item.bags_sold) * Number(item.selling_price_per_bag))}</strong><RecordActions name={`sale to ${item.buyer}`} onEdit={() => startSaleEdit(item)} onDelete={() => setRemoveSale(item)} /></article>) : <EmptyState title="No sales in this view" action="Add sale" onAction={addRecord} />}</section>}
    {view === 'results' && <div className="breakdown-layout">
      <section className="workspace-section"><h2>{year} crop</h2><p className="section-detail">Harvest and sales assigned to this production year, across all sale dates.</p><dl className="detail-list">{[['Bags produced', metrics.bagsProduced.toLocaleString()], ['Total harvest weight', `${metrics.weightKg.toLocaleString()} kg`], ['Bags sold', metrics.bagsSold.toLocaleString()], ['Recorded bags remaining', metrics.remainingBags.toLocaleString()], ['Crop sales revenue', money(metrics.revenue)], ['Average sale price per bag', money(metrics.averageSellingPrice)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
      <section className="workspace-section"><h2>{year} recorded activity</h2><p className="section-detail">Sales and expenses dated in this calendar year, including sales of other crops.</p><dl className="detail-list">{[['Sales revenue', money(metrics.calendarRevenue)], ['Gross labour wages', money(metrics.labour)], ['Estate expenses', money(metrics.otherExpenses)], ['Total recorded spending', money(metrics.totalExpenses)], ['Recorded balance', money(metrics.recordedBalance)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="section-detail">The balance compares recorded sales and spending. It does not account for inventory valuation, unpaid invoices, depreciation or crop cost allocation.</p></section>
    </div>}
    <Sheet open={!!editor} title={editor === 'harvest' ? editingProduction ? 'Edit harvest' : 'Add harvest' : editingSale ? 'Edit sale' : 'Add sale'} busy={saving} onClose={() => setEditor(null)}>
      <form className="workspace-form" onSubmit={save}><Notice error>{error}</Notice>
        {editor === 'harvest' ? <><div className="form-pair"><label className="label">Bags produced<input className="field" type="number" inputMode="decimal" min="0.01" step="0.01" value={production.bags_produced} onChange={e => setProduction({ ...production, bags_produced: e.target.value })} required /></label><label className="label">Bag weight (kg)<input className="field" type="number" inputMode="decimal" min="0.01" step="0.01" value={production.bag_weight_kg} onChange={e => setProduction({ ...production, bag_weight_kg: e.target.value })} required /></label></div><label className="label">Production year<input className="field" type="number" min="2000" max="2200" inputMode="numeric" value={production.production_year} onChange={e => setProduction({ ...production, production_year: e.target.value })} required /></label><label className="label">Notes <span className="optional">(optional)</span><textarea className="field" rows={3} value={production.notes} onChange={e => setProduction({ ...production, notes: e.target.value })} /></label></> : <><label className="label">Buyer<input className="field" value={sale.buyer} onChange={e => setSale({ ...sale, buyer: e.target.value })} required /></label><div className="form-pair"><label className="label">Bags sold<input className="field" type="number" min="0.01" step="0.01" inputMode="decimal" value={sale.bags_sold} onChange={e => setSale({ ...sale, bags_sold: e.target.value })} required /></label><label className="label">Price per bag (₹)<input className="field" type="number" min="0.01" step="0.01" inputMode="decimal" value={sale.selling_price_per_bag} onChange={e => setSale({ ...sale, selling_price_per_bag: e.target.value })} required /></label></div><div className="expense-result-summary"><div><span>Sale total</span><strong>{money(Number(sale.bags_sold) * Number(sale.selling_price_per_bag))}</strong></div></div><div className="form-pair"><label className="label">Sale date<input className="field" type="date" value={sale.sale_date} onChange={e => setSale({ ...sale, sale_date: e.target.value })} required /></label><label className="label">Production year<input className="field" type="number" min="2000" max="2200" inputMode="numeric" value={sale.production_year} onChange={e => setSale({ ...sale, production_year: e.target.value })} required /></label></div></>}
        <div className="sheet-footer"><button className="button-secondary" type="button" disabled={saving} onClick={() => setEditor(null)}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? 'Saving...' : editor === 'harvest' ? 'Save harvest' : 'Save sale'}</button></div>
      </form>
    </Sheet>
    <ConfirmDialog open={!!removeProduction} title="Delete harvest record?" onCancel={() => setRemoveProduction(null)} onConfirm={() => { if (removeProduction) void deleteRecord('production_records', removeProduction.id); setRemoveProduction(null) }}>This will permanently remove this harvest record.</ConfirmDialog>
    <ConfirmDialog open={!!removeSale} title="Delete sale record?" onCancel={() => setRemoveSale(null)} onConfirm={() => { if (removeSale) void deleteRecord('sales', removeSale.id); setRemoveSale(null) }}>This will permanently remove this sale and reduce reported revenue.</ConfirmDialog>
  </div>
}
