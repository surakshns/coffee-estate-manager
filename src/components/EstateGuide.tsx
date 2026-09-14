import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CoffeeCup } from './CoffeeCup'
import { scrollToEditor } from '../lib/scroll'
import { supabase } from '../lib/supabase'
import type { EstateData, MonthlyGuideEntry } from '../lib/types'

type GuideMonth = {
  month: number
  season: string
  headline: string
  actions: string[]
}

const guide: GuideMonth[] = [
  { month: 1, season: 'Harvest & clean-up', headline: 'Finish clean harvesting and protect next season’s crop.', actions: ['Continue harvesting and careful processing where the crop is still coming in.', 'Collect leftover, fallen, and borer-affected berries so they do not carry pests forward.', 'Prepare nursery beds and keep young plants watered when conditions are dry.'] },
  { month: 2, season: 'Harvest close & blossom preparation', headline: 'Close the harvest well and prepare for the next flowering cycle.', actions: ['Complete remaining Robusta harvest and process lots separately for quality.', 'Prune and do crop sanitation after harvest; review fields for pest and disease pressure.', 'Plan blossom irrigation and nutrition around actual rainfall, soil moisture, and advice for your variety.'] },
  { month: 3, season: 'Flowering & field recovery', headline: 'Watch flowering closely and give the estate a clean start.', actions: ['Finish late harvest work and remove leftover berries from blocks.', 'Continue pruning, desuckering, and sanitation where needed.', 'Monitor blossom and backing showers or irrigation; adjust only to current weather and local guidance.'] },
  { month: 4, season: 'Pruning & new planting preparation', headline: 'Build healthy plants and prepare the estate before the rains.', actions: ['Complete post-harvest pruning and inspect plants for borer, scale, or root issues.', 'Prepare pits, nursery stock, compost, and organic matter for new clearings.', 'Review shade, water lines, and field access before monsoon work begins.'] },
  { month: 5, season: 'Pre-monsoon readiness', headline: 'Make drainage, shade, and nutrition ready before heavy rain.', actions: ['Regulate shade carefully and plan dadap lopping according to weather.', 'Prepare drains, trenches, and planting pits so water can move safely through the estate.', 'Plan pre-monsoon nutrition and crop protection after scouting and local technical advice.'] },
  { month: 6, season: 'Monsoon establishment', headline: 'Protect roots, drainage, and young plants as the rains set in.', actions: ['Plant or gap-fill only when field conditions are suitable; stake and mulch young plants.', 'Keep drains and cradle pits clear; do weeding and desuckering without disturbing wet soil.', 'Watch for leaf disease, black rot, and insect activity—record affected blocks early.'] },
  { month: 7, season: 'Monsoon maintenance', headline: 'Use rain breaks for careful field maintenance.', actions: ['Continue handling, centring, desuckering, and weed management as weather allows.', 'Support new plants and nursery stock; remove visibly affected plant material safely.', 'Scout regularly for berry borer, black rot, and shot-hole borer instead of treating by calendar alone.'] },
  { month: 8, season: 'Mid-monsoon crop care', headline: 'Keep the canopy balanced and protect developing berries.', actions: ['Continue weeding, shade work, and planting only during safe weather windows.', 'Plan mid-monsoon nutrition during suitable dry breaks, based on your soil and crop plan.', 'Trace and record pest or disease hotspots so follow-up work is targeted.'] },
  { month: 9, season: 'Post-monsoon recovery', headline: 'Feed the crop, regulate shade, and prepare for harvest quality.', actions: ['Complete post-monsoon nutrition and shade regulation based on field observation.', 'Inspect Arabica and Robusta blocks for leaf disease, borer, and damaged twigs.', 'Plan coffee and shade planting, nursery care, and drying/processing maintenance.'] },
  { month: 10, season: 'Harvest preparation', headline: 'Get people, equipment, and quality systems ready before picking.', actions: ['Finish post-monsoon field work, drainage checks, and light weed control.', 'Prepare the drying yard, pulper site, storage, bags, and harvest labour plan.', 'Monitor crop maturity and pest pressure; make a block-wise picking and processing plan.'] },
  { month: 11, season: 'Arabica harvest begins', headline: 'Start selective harvesting and keep processing quality consistent.', actions: ['Begin Arabica harvest where berries are ripe; keep lots and records clearly separated.', 'Prepare Robusta blocks for dry-season water needs where rainfall is insufficient.', 'Maintain mulching, young plants, clean paths, and berry-borer monitoring.'] },
  { month: 12, season: 'Peak harvest & processing', headline: 'Protect quality during harvest and set up next year’s nursery work.', actions: ['Continue Arabica harvest and begin Robusta harvest where ripe.', 'Prioritise clean picking, fast processing, drying, and lot-level records.', 'Review soil amendments, fire safety, paths, and nursery material for the next season.'] }
]

const monthName = (month: number, short = false) => new Intl.DateTimeFormat('en-IN', { month: short ? 'short' : 'long' }).format(new Date(2024, month - 1, 1))

export function EstateGuide({ data, refresh }: { data: EstateData; refresh: () => Promise<void> }) {
  const currentMonth = new Date().getMonth() + 1
  const [open, setOpen] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [editing, setEditing] = useState<MonthlyGuideEntry | null>(null)
  const [saving, setSaving] = useState(false)
  const [workingEntry, setWorkingEntry] = useState('')
  const [message, setMessage] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const monthStripRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLFormElement>(null)
  const currentGuide = guide[selectedMonth - 1]
  const entries = useMemo(() => data.monthlyGuideEntries.filter((entry) => entry.month_number === selectedMonth).sort((left, right) => left.created_at.localeCompare(right.created_at)), [data.monthlyGuideEntries, selectedMonth])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }))
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
        .filter((element) => element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        dialog.focus()
        return
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
      previousFocus?.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const strip = monthStripRef.current
    const selected = strip?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!strip || !selected) return
    // Scroll only the month strip, keeping the dialog content in place.
    const stripBounds = strip.getBoundingClientRect()
    const selectedBounds = selected.getBoundingClientRect()
    strip.scrollLeft += selectedBounds.left - stripBounds.left - (strip.clientWidth - selectedBounds.width) / 2
  }, [open, selectedMonth])

  function selectMonth(month: number) {
    setSelectedMonth(month)
    setEditing(null)
    setTitle('')
    setNotes('')
    setMessage('')
  }

  function startEditing(entry: MonthlyGuideEntry) {
    setEditing(entry)
    setTitle(entry.title)
    setNotes(entry.notes)
    setMessage('')
    scrollToEditor(editorRef.current)
  }

  function clearEditor() {
    setEditing(null)
    setTitle('')
    setNotes('')
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault()
    const entryTitle = title.trim()
    if (!entryTitle) return
    setSaving(true)
    const request = editing
      ? supabase.from('monthly_tasks').update({ title: entryTitle, notes: notes.trim() }).eq('id', editing.id)
      : supabase.from('monthly_tasks').insert({ month_number: selectedMonth, title: entryTitle, notes: notes.trim() })
    const { error } = await request
    setSaving(false)
    if (error) { setMessage(error.message); return }
    const wasEditing = Boolean(editing)
    clearEditor()
    setMessage(wasEditing ? 'Reference note updated.' : 'Saved under ' + monthName(selectedMonth) + '.')
    await refresh()
  }

  async function removeEntry(entry: MonthlyGuideEntry) {
    setWorkingEntry(entry.id)
    const { error } = await supabase.from('monthly_tasks').delete().eq('id', entry.id)
    setWorkingEntry('')
    if (error) { setMessage(error.message); return }
    if (editing?.id === entry.id) clearEditor()
    setMessage('Reference note removed.')
    await refresh()
  }

  return <>
    <button type="button" className="estate-guide-fab" onClick={() => setOpen(true)} aria-label="Open coffee estate guide" title="Coffee estate guide" aria-haspopup="dialog" aria-expanded={open} aria-controls="estate-guide-dialog">
      <span className="estate-guide-fab-icon" aria-hidden="true"><CoffeeCup /></span>
    </button>
    {open && createPortal(
      <div className="estate-guide-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
        <aside ref={dialogRef} id="estate-guide-dialog" className="estate-guide-sheet" role="dialog" aria-modal="true" aria-labelledby="estate-guide-title" tabIndex={-1}>
          <header className="estate-guide-header">
            <div><p className="tile-label text-leaf-700">Evergreen reference</p><h2 id="estate-guide-title" className="mt-1 text-xl font-extrabold text-stone-900">Coffee estate guide</h2><p className="mt-1 text-sm text-stone-600">A seasonal reference for a South-West monsoon coffee estate, plus your own notes.</p></div>
            <button type="button" className="estate-guide-close min-h-11 min-w-11" onClick={() => setOpen(false)} aria-label="Close estate guide">×</button>
          </header>
          <div className="estate-guide-scroll">
            <div ref={monthStripRef} className="estate-guide-months" role="group" aria-label="Choose a month">{guide.map((item) => <button type="button" key={item.month} className={'estate-guide-month min-h-11 min-w-11' + (selectedMonth === item.month ? ' is-active' : '')} onClick={() => selectMonth(item.month)} aria-label={monthName(item.month) + (item.month === currentMonth ? ', current month' : '')} aria-pressed={selectedMonth === item.month}>{monthName(item.month, true)}{item.month === currentMonth && <span aria-hidden="true" className="ml-1">•</span>}</button>)}</div>
            {selectedMonth !== currentMonth && <div className="px-4 pt-3"><button type="button" className="estate-guide-edit min-h-11 rounded-lg px-3" onClick={() => selectMonth(currentMonth)}>↩ Back to {monthName(currentMonth)} · This month</button></div>}
            <div className="estate-guide-content">
              <section className="estate-guide-reference"><p className="estate-guide-season">{currentGuide.season}</p><h3 className="mt-1 text-2xl font-extrabold text-stone-900">{monthName(selectedMonth)} focus</h3><p className="mt-2 leading-6 text-stone-700">{currentGuide.headline}</p><ul className="estate-guide-actions">{currentGuide.actions.map((action) => <li key={action}>{action}</li>)}</ul><p className="estate-guide-disclaimer">Timing changes with rain, elevation, variety, and block conditions. Use scouting, weather, and your local Coffee Board or agronomy advice for field decisions.</p><a className="estate-guide-source" href="https://coffeeboard.gov.in/Publications/9%20-%20IC%20Dec%2020_Final%20for%20web.pdf" target="_blank" rel="noreferrer">Open the Coffee Board calendar ↗</a></section>
              <section className="estate-guide-personal"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="tile-label text-leaf-700">Your reference</p><h3 className="mt-1 text-lg font-extrabold text-stone-900">{monthName(selectedMonth)} notes</h3></div><span className="estate-guide-count">{entries.length} saved</span></div>
                {entries.length > 0 && <ul className="space-y-2">{entries.map((entry) => <li className="estate-guide-entry" key={entry.id}><div className="min-w-0 flex-1"><p className="break-words font-extrabold text-stone-900">{entry.title}</p>{entry.notes && <p className="mt-1 break-words text-sm leading-5 text-stone-600">{entry.notes}</p>}</div><div className="estate-guide-entry-actions"><button type="button" className="estate-guide-edit min-h-11 min-w-11" aria-label={'Edit ' + entry.title} disabled={workingEntry === entry.id} onClick={() => startEditing(entry)}>Edit</button><button type="button" className="estate-guide-remove min-h-11 min-w-11" aria-label={'Remove ' + entry.title} disabled={workingEntry === entry.id} onClick={() => void removeEntry(entry)}>×</button></div></li>)}</ul>}
                {!entries.length && <p className="rounded-xl border border-dashed border-leaf-600/25 bg-leaf-50/50 p-3 text-sm leading-5 text-stone-600">Add your estate-specific practices, contacts, reminders, or lessons here. These notes repeat every year.</p>}
                <form ref={editorRef} className="estate-guide-editor scroll-mt-24" onSubmit={saveEntry}><p className="mb-3 text-sm font-extrabold text-stone-800">{editing ? 'Edit your reference note' : 'Add a ' + monthName(selectedMonth) + ' reference note'}</p><label className="label">Title<input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} placeholder="e.g. Our irrigation checklist" required /></label><label className="label">Details <span className="font-medium text-stone-500">(optional)</span><textarea className="field min-h-24 resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="What you want to remember each year…" /></label><div className="mt-3 flex flex-col gap-2 sm:flex-row"><button className="button-primary flex-1" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save note changes' : 'Save reference note'}</button>{editing && <button type="button" className="button-secondary" onClick={clearEditor}>Cancel</button>}</div>{message && <p className="mt-3 text-sm font-bold text-leaf-700" role="status">{message}</p>}</form>
              </section>
            </div>
          </div>
        </aside>
      </div>,
      document.body
    )}
  </>
}
