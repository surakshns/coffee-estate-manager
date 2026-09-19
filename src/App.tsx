import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AppIcon } from './components/AppIcon'
import { CoffeeCup } from './components/CoffeeCup'
import { AuthScreen } from './components/AuthScreen'
import { Backup } from './components/Backup'
import { Dashboard } from './components/Dashboard'
import { EstateGuide } from './components/EstateGuide'
import { Expenses } from './components/Expenses'
import { Labour } from './components/Labour'
import { Prices } from './components/Prices'
import { Production } from './components/Production'
import { Rainfall } from './components/Rainfall'
import { useEstateData } from './hooks/useEstateData'
import { supabase } from './lib/supabase'

type Page = 'Dashboard' | 'Labour' | 'Expenses' | 'Rainfall' | 'Prices' | 'Production' | 'Backup'
type DeferredInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const navigation: { page: Page; short: string; icon: 'home' | 'labour' | 'expenses' | 'rainfall' | 'prices' | 'harvest' | 'backup' }[] = [
  { page: 'Dashboard', short: 'Home', icon: 'home' },
  { page: 'Labour', short: 'Labour', icon: 'labour' },
  { page: 'Expenses', short: 'Expenses', icon: 'expenses' },
  { page: 'Rainfall', short: 'Rain', icon: 'rainfall' },
  { page: 'Prices', short: 'Prices', icon: 'prices' },
  { page: 'Production', short: 'Harvest', icon: 'harvest' }
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [page, setPage] = useState<Page>('Dashboard')
  const [year, setYear] = useState(new Date().getFullYear())
  const [notice, setNotice] = useState('')
  const [loadingDemo, setLoadingDemo] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null)
  const { data, loading, error, refresh } = useEstateData()

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession); setChecking(false)
      if (nextSession) void refresh()
    })
    return () => listener.subscription.unsubscribe()
  }, [refresh])

  useEffect(() => {
    const onBeforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as DeferredInstallPrompt) }
    const onInstalled = () => { setInstallPrompt(null); setNotice('Coffee Estate Manager is installed and will open like an app.') }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => { window.removeEventListener('beforeinstallprompt', onBeforeInstall); window.removeEventListener('appinstalled', onInstalled) }
  }, [])

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  async function loadDemo() {
    if (loadingDemo) return
    setLoadingDemo(true)
    const { error } = await supabase.rpc('seed_my_demo_coffee_estate')
    setNotice(error ? error.message : 'Sample records have been added.')
    if (!error) await refresh()
    setLoadingDemo(false)
  }
  function navigate(nextPage: Page) {
    if (menuRef.current) menuRef.current.open = false
    if (nextPage !== page) setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'instant' })
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }))
  }
  if (checking) return <main className="grid min-h-screen place-items-center"><p className="text-lg font-bold text-stone-600">Opening Coffee Estate Manager…</p></main>
  if (!session) return <AuthScreen />

  const recordYears = [...data.production.map((item) => item.production_year), ...data.sales.map((item) => Number(item.sale_date.slice(0, 4))), ...data.expenses.map((item) => Number(item.expense_date.slice(0, 4))), ...data.weeklyPayments.map((item) => Number(item.week_start.slice(0, 4)))]
  const years = [...new Set([year, ...Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 5 + index), ...recordYears])].filter(Number.isFinite).sort((a, b) => b - a)
  const current = () => {
    const props = { data, year, refresh }
    switch (page) {
      case 'Labour': return <Labour {...props} />
      case 'Expenses': return <Expenses {...props} />
      case 'Rainfall': return <Rainfall defaultYear={year} />
      case 'Prices': return <Prices />
      case 'Production': return <Production {...props} />
      case 'Backup': return <Backup data={data} refresh={refresh} />
      default: return <Dashboard data={data} year={year} onNavigate={navigate} />
    }
  }

  const hasRecords = data.workers.length || data.expenses.length || data.production.length || data.sales.length

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="app-header sticky top-0 z-20">
      <div className="app-header-inner mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <button className="brand-lockup text-left" onClick={() => navigate('Dashboard')} aria-label="Coffee Estate Manager — go to dashboard">
          <span className="brand-cup" aria-hidden="true"><CoffeeCup className="brand-cup-icon" /></span>
          <span><span className="brand-eyebrow">COFFEE ESTATE</span><span className="brand-title">Manager<span className="brand-dot">.</span></span></span>
        </button>
        <div className="header-actions flex items-center gap-2">
          <label className="year-control" htmlFor="record-year"><span className="hidden sm:inline">Record year</span><select id="record-year" aria-label="Record year" className="year-picker" value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <details className="header-menu" ref={menuRef} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
            <summary className="header-more" aria-label="More options"><AppIcon name="more" /></summary>
            <div className="header-menu-panel">
              <p className="menu-caption">Your estate</p>
              <button onClick={() => navigate('Backup')}><AppIcon name="backup" /> Backup &amp; import</button>
              {installPrompt && <button onClick={() => void installApp()}>＋ Install app</button>}
              <button onClick={() => { if (menuRef.current) menuRef.current.open = false; void supabase.auth.signOut() }}>Sign out</button>
            </div>
          </details>
        </div>
      </div>
      <nav aria-label="Main navigation" className="desktop-nav mx-auto hidden max-w-7xl gap-1 px-4 pb-2 sm:flex sm:px-6 lg:px-8">
        {navigation.map((item) => <button key={item.page} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined} className={page === item.page ? 'desktop-nav-item is-active' : 'desktop-nav-item'}><AppIcon name={item.icon} />{item.page === 'Production' ? 'Harvest & sales' : item.page}</button>)}
      </nav>
    </header>
    <main id="main-content" ref={mainRef} tabIndex={-1} className="main-content">
      {error && <div className="app-banner" role="alert"><strong>Your records could not be loaded.</strong><p>{error}</p><button className="button-secondary mt-3" onClick={() => void refresh()}>Try again</button></div>}
      {notice && <div className="app-banner notice-banner" role="status"><p>{notice}</p><button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div>}
      {!loading && !error && !hasRecords && page === 'Dashboard' && <div className="app-banner welcome-banner"><div><strong>Welcome to your estate desk.</strong><p>Add your first worker, expense or harvest to get started.</p></div><details><summary>Explore with sample records</summary><p className="mt-2 text-sm">This adds sample records to your account.</p><button className="button-secondary mt-2" disabled={loadingDemo} onClick={() => void loadDemo()}>{loadingDemo ? 'Adding records…' : 'Add sample records'}</button></details></div>}
      {loading ? <div className="loading-state" role="status"><span className="loading-leaf" aria-hidden="true">🌱</span><p>Gathering your estate records…</p></div> : <div className="page-transition" key={page}>{current()}</div>}
    </main>
    {!loading && <EstateGuide data={data} refresh={refresh} />}
    <nav aria-label="Main navigation" className="mobile-nav sm:hidden">{navigation.map((item) => <button key={item.page} className={`mobile-nav-item ${page === item.page ? 'is-active' : ''}`} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}><span className="mobile-nav-icon"><AppIcon name={item.icon} /></span><span className="mobile-nav-label">{item.short}</span></button>)}</nav>
  </div>
}
