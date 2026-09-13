import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthScreen } from './components/AuthScreen'
import { Backup } from './components/Backup'
import { Dashboard } from './components/Dashboard'
import { Expenses } from './components/Expenses'
import { Labour } from './components/Labour'
import { Prices } from './components/Prices'
import { Production } from './components/Production'
import { useEstateData } from './hooks/useEstateData'
import { supabase } from './lib/supabase'

type Page = 'Dashboard' | 'Labour' | 'Expenses' | 'Prices' | 'Production' | 'Backup'
const navigation: { page: Page; short: string; symbol: string }[] = [
  { page: 'Dashboard', short: 'Home', symbol: '⌂' },
  { page: 'Labour', short: 'Labour', symbol: '♟' },
  { page: 'Expenses', short: 'Expenses', symbol: '₹' },
  { page: 'Prices', short: 'Prices', symbol: '◒' },
  { page: 'Production', short: 'Sales', symbol: '▦' },
  { page: 'Backup', short: 'Backup', symbol: '⇩' }
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [page, setPage] = useState<Page>('Dashboard')
  const [year, setYear] = useState(new Date().getFullYear())
  const [notice, setNotice] = useState('')
  const { data, loading, error, refresh } = useEstateData()

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession); setChecking(false)
      if (nextSession) void refresh()
    })
    return () => listener.subscription.unsubscribe()
  }, [refresh])

  async function loadDemo() {
    const { error } = await supabase.rpc('seed_my_demo_coffee_estate')
    setNotice(error ? error.message : 'Sample records have been added.')
    if (!error) await refresh()
  }
  function navigate(nextPage: Page) { if (nextPage !== page) setPage(nextPage) }
  if (checking) return <main className="grid min-h-screen place-items-center"><p className="text-lg font-bold text-stone-600">Opening Coffee Estate Manager…</p></main>
  if (!session) return <AuthScreen />

  const years = Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 5 + index)
  const current = () => {
    const props = { data, year, refresh }
    switch (page) {
      case 'Labour': return <Labour {...props} />
      case 'Expenses': return <Expenses {...props} />
      case 'Prices': return <Prices />
      case 'Production': return <Production {...props} />
      case 'Backup': return <Backup data={data} refresh={refresh} />
      default: return <Dashboard data={data} year={year} />
    }
  }

  return <div className="app-shell"><header className="app-header sticky top-0 z-20 border-b border-leaf-800 bg-leaf-700 text-white"><div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8"><button className="text-left transition-transform active:scale-95" onClick={() => navigate('Dashboard')}><span className="block text-xs font-bold tracking-[.18em] text-leaf-50">COFFEE ESTATE</span><span className="text-xl font-extrabold">Manager</span></button><div className="flex items-center gap-2"><button className="top-download-button sm:hidden" onClick={() => navigate('Backup')} aria-label="Open backup">⇩</button><label className="sr-only" htmlFor="financial-year">Financial year</label><select id="financial-year" className="rounded-lg bg-white/15 px-2 py-2 font-bold text-white outline-none ring-1 ring-white/35 transition hover:bg-white/20 focus:ring-2 focus:ring-white/70" value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option className="text-stone-900" key={item} value={item}>{item}</option>)}</select><button className="hidden rounded-lg px-3 py-2 font-bold transition hover:bg-white/10 active:scale-95 sm:block" onClick={() => void supabase.auth.signOut()}>Sign out</button></div></div>
    <nav className="mx-auto hidden max-w-7xl gap-1 px-4 pb-2 sm:flex sm:px-6 lg:px-8">{navigation.map((item) => <button key={item.page} onClick={() => navigate(item.page)} className={`rounded-lg px-4 py-2 text-sm font-bold transition-all duration-200 ${page === item.page ? 'bg-white text-leaf-700 shadow-sm' : 'text-leaf-50 hover:bg-white/10'}`}>{item.page}</button>)}</nav></header>
    {error && <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8"><p className="rounded-xl bg-red-50 p-3 font-bold text-red-800">Could not load data: {error}. Check your Supabase settings and SQL migration.</p></div>}
    {notice && <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8"><p className="flex items-center justify-between gap-3 rounded-xl bg-leaf-50 p-3 font-bold text-leaf-700">{notice}<button onClick={() => setNotice('')} aria-label="Close">×</button></p></div>}
    {!loading && data.workers.length === 0 && page === 'Dashboard' && <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8"><div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-coffee-100 bg-coffee-100 p-4 sm:flex-row sm:items-center"><p><strong>Starting fresh?</strong> Load safe sample records to see how the dashboard works. You can delete them later.</p><button className="button-secondary shrink-0" onClick={() => void loadDemo()}>Load sample records</button></div></div>}
    {loading ? <main className="grid min-h-75 place-items-center"><p className="font-bold text-stone-600">Loading your records…</p></main> : <div className="page-transition" key={page}>{current()}</div>}
    <nav className="mobile-nav sm:hidden">{navigation.filter((item) => item.page !== 'Backup').map((item) => <button key={item.page} className={`mobile-nav-item ${page === item.page ? 'is-active' : ''}`} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}><span className="mobile-nav-icon">{item.symbol}</span><span className="mobile-nav-label">{item.short}</span></button>)}</nav>
  </div>
}
