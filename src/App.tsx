import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AppIcon } from './components/AppIcon'
import { AuthScreen } from './components/AuthScreen'
import { PasswordForm } from './components/PasswordForm'
import { PasswordRecovery } from './components/PasswordRecovery'
import { Download, LockKeyhole, LogOut, Menu } from 'lucide-react'
import { Backup } from './components/Backup'
import { Dashboard } from './components/Dashboard'
import { Documents } from './components/Documents'
import { EstateGuide } from './components/EstateGuide'
import { Expenses } from './components/Expenses'
import { ExpenseEditor } from './components/ExpenseEditor'
import { Labour } from './components/Labour'
import { Prices } from './components/Prices'
import { Production } from './components/Production'
import { Rainfall } from './components/Rainfall'
import { useEstateData } from './hooks/useEstateData'
import { supabase } from './lib/supabase'
import { isPasswordRecovery, passwordRecoveryError, setPasswordRecoveryUrl } from './lib/auth'
import { Sheet } from './components/Workspace'
import { SelectionNav } from './components/SelectionNav'
import { RecordLoading } from './components/RecordLoading'
import { estateToday } from './lib/estateDates'

type Page = 'Dashboard' | 'Labour' | 'Expenses' | 'Rainfall' | 'Prices' | 'Production' | 'Documents' | 'Backup'
type NavigationEntry = { advanceDate?: string; expenseView?: 'records' | 'breakdown' | 'categories' }
type DeferredInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const navigation: { page: Page; short: string; icon: 'home' | 'labour' | 'expenses' | 'rainfall' | 'prices' | 'harvest' | 'documents' | 'backup' }[] = [
  { page: 'Dashboard', short: 'Home', icon: 'home' },
  { page: 'Labour', short: 'Labour', icon: 'labour' },
  { page: 'Expenses', short: 'Expenses', icon: 'expenses' },
  { page: 'Rainfall', short: 'Rain', icon: 'rainfall' },
  { page: 'Prices', short: 'Prices', icon: 'prices' },
  { page: 'Production', short: 'Harvest', icon: 'harvest' },
  { page: 'Documents', short: 'Docs', icon: 'documents' }
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [recoveringPassword, setRecoveringPassword] = useState(isPasswordRecovery)
  const [recoveryError, setRecoveryError] = useState(passwordRecoveryError)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [page, setPage] = useState<Page>('Dashboard')
  const [moreOpen, setMoreOpen] = useState(false)
  const [entry, setEntry] = useState<NavigationEntry>({})
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false)
  const [year, setYear] = useState(() => Number(estateToday().slice(0, 4)))
  const [notice, setNotice] = useState('')
  const [loadingDemo, setLoadingDemo] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null)
  const { data, loading, error, refresh } = useEstateData()

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      setSession(data.session); setChecking(false)
      if (error && recoveringPassword) setRecoveryError('This reset link could not be verified. Request a new link below.')
    }).catch(() => {
      if (!active) return
      setChecking(false)
      if (recoveringPassword) setRecoveryError('Could not open the reset link. Please check your connection and request a new link.')
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      setSession(nextSession); setChecking(false)
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveringPassword(true); setRecoveryError(''); setPasswordRecoveryUrl(true)
      }
      if (!nextSession) { setPasswordOpen(false); setPasswordBusy(false) }
      if (nextSession) void refresh()
    })
    return () => { active = false; listener.subscription.unsubscribe() }
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
  function navigate(nextPage: Page, nextEntry: NavigationEntry = {}) {
    setMoreOpen(false)
    setEntry(nextEntry)
    if (menuRef.current) menuRef.current.open = false
    if (nextPage !== page) setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'instant' })
    requestAnimationFrame(() => { if (!document.querySelector('dialog[open]')) mainRef.current?.focus({ preventScroll: true }) })
  }
  function startAdvance(week: string) {
    setYear(Number(week.slice(0, 4)))
    navigate('Labour', { advanceDate: week })
  }
  function finishPasswordRecovery() {
    setRecoveringPassword(false); setRecoveryError(''); setPasswordRecoveryUrl(false)
  }
  function openPasswordSettings() {
    setMoreOpen(false)
    if (menuRef.current) menuRef.current.open = false
    setPasswordOpen(true)
  }
  if (checking) return <main className="app-opening"><RecordLoading message="Opening Coffee Estate Manager…" compact /></main>
  if (recoveringPassword) {
    if (!session || recoveryError) return <AuthScreen key="password-recovery" initialMode="forgot-password" initialMessage={recoveryError || 'This reset link is invalid or has expired. Request a new link below.'} onReturnToSignIn={finishPasswordRecovery} />
    return <PasswordRecovery email={session.user.email} onComplete={finishPasswordRecovery} />
  }
  if (!session) return <AuthScreen />

  const currentYear = Number(estateToday().slice(0, 4))
  const recordYears = [...data.production.map((item) => item.production_year), ...data.sales.map((item) => Number(item.sale_date.slice(0, 4))), ...data.expenses.map((item) => Number(item.expense_date.slice(0, 4))), ...data.weeklyPayments.map((item) => Number(item.week_start.slice(0, 4)))]
  const years = [...new Set([year, ...Array.from({ length: 11 }, (_, index) => currentYear - 5 + index), ...recordYears])].filter(Number.isFinite).sort((a, b) => b - a)
  const current = () => {
    const props = { data, year, refresh }
    switch (page) {
      case 'Labour': return <Labour {...props} onYearChange={setYear} initialAdvanceDate={entry.advanceDate} />
      case 'Expenses': return <Expenses {...props} initialView={entry.expenseView} />
      case 'Rainfall': return <Rainfall defaultYear={year} />
      case 'Prices': return <Prices />
      case 'Production': return <Production {...props} />
      case 'Documents': return <Documents data={data} refresh={refresh} />
      case 'Backup': return <Backup data={data} refresh={refresh} />
      default: return <Dashboard data={data} year={year} onNavigate={navigate} onStartAdvance={startAdvance} onAddExpense={() => setQuickExpenseOpen(true)} />
    }
  }

  const hasRecords = data.workers.length || data.expenses.length || data.production.length || data.sales.length || data.documents.length

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="app-header sticky top-0 z-20">
      <div className="app-header-inner mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="brand-lockup">
          <EstateGuide data={data} refresh={refresh} page={page} disabled={loading} />
          <button type="button" className="brand-home" onClick={() => navigate('Dashboard')} aria-label="Coffee Estate Manager — go to dashboard">
            <span className="brand-eyebrow">COFFEE ESTATE</span><span className="brand-title">Manager<span className="brand-dot">.</span></span>
          </button>
        </div>
        <div className="header-actions flex items-center gap-2">
          {['Dashboard', 'Labour', 'Expenses', 'Production'].includes(page) && <label className="year-control" htmlFor="record-year"><span className="hidden sm:inline">Record year</span><select id="record-year" aria-label="Record year" className="year-picker" value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
          <details className="header-menu" ref={menuRef} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
            <summary className="header-more" aria-label="More options"><AppIcon name="more" /></summary>
            <div className="header-menu-panel">
              <p className="menu-caption">Your estate</p>
              <button onClick={() => navigate('Backup')}><AppIcon name="backup" /> Backup &amp; import</button>
              <button onClick={openPasswordSettings}><LockKeyhole size={18} aria-hidden="true" />Change password</button>
              {installPrompt && <button onClick={() => void installApp()}>＋ Install app</button>}
              <button onClick={() => { if (menuRef.current) menuRef.current.open = false; void supabase.auth.signOut() }}>Sign out</button>
            </div>
          </details>
        </div>
      </div>
      <SelectionNav value={page} aria-label="Main navigation" className="desktop-nav mx-auto hidden max-w-7xl gap-1 px-4 pb-2 sm:flex sm:px-6 lg:px-8">
        {navigation.map((item) => <button key={item.page} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined} className={page === item.page ? 'desktop-nav-item is-active' : 'desktop-nav-item'}><AppIcon name={item.icon} />{item.page === 'Production' ? 'Harvest & sales' : item.page}</button>)}
      </SelectionNav>
    </header>
    <main id="main-content" ref={mainRef} tabIndex={-1} className="main-content">
      {error && <div className="app-banner" role="alert"><strong>Your records could not be loaded.</strong><p>{error}</p><button className="button-secondary mt-3" onClick={() => void refresh()}>Try again</button></div>}
      {notice && <div className="app-banner notice-banner" role="status"><p>{notice}</p><button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div>}
      {!loading && !error && !hasRecords && page === 'Dashboard' && <div className="app-banner welcome-banner"><div><strong>Welcome to your estate desk.</strong><p>Add your first worker, expense or harvest to get started.</p></div><details><summary>Explore with sample records</summary><p className="mt-2 text-sm">This adds sample records to your account.</p><button className="button-secondary mt-2" disabled={loadingDemo} onClick={() => void loadDemo()}>{loadingDemo ? 'Adding records…' : 'Add sample records'}</button></details></div>}
      {loading ? <RecordLoading /> : <div className="page-transition" key={page}>{current()}</div>}
    </main>
    <SelectionNav value={moreOpen ? 'Menu' : page} aria-label="Main navigation" className="mobile-nav sm:hidden">{navigation.filter(item => ['Dashboard', 'Labour', 'Expenses'].includes(item.page)).map((item) => <button key={item.page} className={`mobile-nav-item ${!moreOpen && page === item.page ? 'is-active' : ''}`} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}><span className="mobile-nav-icon"><AppIcon name={item.icon} /></span><span className="mobile-nav-label">{item.short}</span></button>)}<button className={`mobile-nav-item ${moreOpen || ['Documents', 'Production', 'Prices', 'Rainfall', 'Backup'].includes(page) ? 'is-active' : ''}`} onClick={() => setMoreOpen(true)} aria-label="Menu" aria-haspopup="dialog" aria-expanded={moreOpen}><span className="mobile-nav-icon"><Menu size={21} aria-hidden="true" /></span><span className="mobile-nav-label">Menu</span></button></SelectionNav>
    <Sheet open={moreOpen} title="Menu" className="mobile-menu-sheet" onClose={() => setMoreOpen(false)}>
      <nav className="mobile-menu-sections" aria-label="Other sections">{navigation.filter(item => ['Documents', 'Production', 'Rainfall', 'Prices'].includes(item.page)).map(item => <button type="button" key={item.page} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}><span className="mobile-menu-section-icon"><AppIcon name={item.icon} /></span><span>{item.page === 'Production' ? 'Harvest & sales' : item.page === 'Prices' ? 'Coffee prices' : item.page}</span></button>)}</nav>
      <div className="mobile-menu-tools"><h3>Account &amp; tools</h3><button type="button" onClick={() => navigate('Backup')}><AppIcon name="backup" /><span>Backup &amp; import</span><AppIcon name="arrow" /></button><button type="button" onClick={openPasswordSettings}><LockKeyhole size={19} aria-hidden="true" /><span>Change password</span><AppIcon name="arrow" /></button>{installPrompt && <button type="button" onClick={() => { setMoreOpen(false); void installApp() }}><Download size={19} aria-hidden="true" /><span>Install app</span><AppIcon name="arrow" /></button>}<button type="button" className="mobile-menu-signout" onClick={() => { setMoreOpen(false); void supabase.auth.signOut() }}><LogOut size={19} aria-hidden="true" /><span>Sign out</span></button></div>
    </Sheet>
    <ExpenseEditor data={data} refresh={refresh} open={quickExpenseOpen} onClose={() => setQuickExpenseOpen(false)} onSaved={setNotice} onManageCategories={() => navigate('Expenses', { expenseView: 'categories' })} />
    <Sheet open={passwordOpen} title="Change password" busy={passwordBusy} onClose={() => setPasswordOpen(false)}>
      <p className="password-intro">Confirm your current password, then choose a new one for your account.</p>
      {passwordOpen && <PasswordForm email={session.user.email} verifyCurrent onBusyChange={setPasswordBusy} onCancel={() => setPasswordOpen(false)} onSuccess={() => { setPasswordOpen(false); setNotice('Your login password has been updated.') }} />}
    </Sheet>
  </div>
}
