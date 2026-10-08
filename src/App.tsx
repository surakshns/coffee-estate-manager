import { lazy, Suspense, useEffect, useRef, useState, useTransition } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AppIcon } from './components/AppIcon'
import { AuthScreen } from './components/AuthScreen'
import { PasswordForm } from './components/PasswordForm'
import { PasswordRecovery } from './components/PasswordRecovery'
import { Bell, Download, LockKeyhole, LogOut, Menu, RefreshCw } from 'lucide-react'
import { EstateGuide } from './components/EstateGuide'
import { Expenses } from './components/Expenses'
import { ExpenseEditor } from './components/ExpenseEditor'
import { useEstateData } from './hooks/useEstateData'
import { supabase } from './lib/supabase'
import { isPasswordRecovery, passwordRecoveryError, setPasswordRecoveryUrl } from './lib/auth'
import { Sheet } from './components/Workspace'
import { SelectionNav } from './components/SelectionNav'
import { RecordLoading } from './components/RecordLoading'
import { estateToday } from './lib/estateDates'
import { AdvanceReminderSettings } from './components/AdvanceReminderSettings'
import { useAdvanceReminders } from './hooks/useAdvanceReminders'
import { advanceWeekFromUrl, applicationUrl, validAdvanceWeek } from './lib/advanceReminders'
import { PageBoundary } from './components/PageBoundary'

const Dashboard = lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })))
const Labour = lazy(() => import('./components/Labour').then(module => ({ default: module.Labour })))
const Prices = lazy(() => import('./components/Prices').then(module => ({ default: module.Prices })))
const Production = lazy(() => import('./components/Production').then(module => ({ default: module.Production })))
const Rainfall = lazy(() => import('./components/Rainfall').then(module => ({ default: module.Rainfall })))
const Documents = lazy(() => import('./components/Documents').then(module => ({ default: module.Documents })))
const Backup = lazy(() => import('./components/Backup').then(module => ({ default: module.Backup })))
const FarmIntelligence = lazy(() => import('./components/FarmIntelligence').then(module => ({ default: module.FarmIntelligence })))
const OurEstateWorkspace = lazy(() => import('./components/OurEstateWorkspace').then(module => ({ default: module.OurEstateWorkspace })))

type Page = 'Dashboard' | 'Labour' | 'Expenses' | 'Rainfall' | 'Prices' | 'Production' | 'Documents' | 'Backup' | 'Farm Intelligence' | 'Our Estate'
type NavigationEntry = { advanceDate?: string; advanceRequest?: number; expenseView?: 'records' | 'breakdown' | 'categories' }
type DeferredInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const navigation: { page: Page; short: string; icon: 'home' | 'labour' | 'expenses' | 'rainfall' | 'prices' | 'harvest' | 'documents' | 'backup' | 'intelligence' | 'estate' }[] = [
  { page: 'Dashboard', short: 'Home', icon: 'home' },
  { page: 'Labour', short: 'Labour', icon: 'labour' },
  { page: 'Expenses', short: 'Expenses', icon: 'expenses' },
  { page: 'Our Estate', short: 'Estate', icon: 'estate' },
  { page: 'Farm Intelligence', short: 'Updates', icon: 'intelligence' },
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
  const [navigating, startTransition] = useTransition()
  const [moreOpen, setMoreOpen] = useState(false)
  const [entry, setEntry] = useState<NavigationEntry>({})
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [notificationWeek, setNotificationWeek] = useState(() => advanceWeekFromUrl(window.location.href, applicationUrl()))
  const advanceRequest = useRef(0)
  const [year, setYear] = useState(() => Number(estateToday().slice(0, 4)))
  const [notice, setNotice] = useState('')
  const [loadingDemo, setLoadingDemo] = useState(false)
  const [uiOwner, setUiOwner] = useState<string | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null)
  const { data, loading, refreshing, loadedAt, error, refresh } = useEstateData(session?.user.id ?? null)
  const reminders = useAdvanceReminders(session?.user.id ?? null, JSON.stringify([data.weeklyPayments, data.workers]))

  useEffect(() => {
    let active = true
    let authEventReceived = false
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEventReceived) return
      setSession(data.session); setChecking(false)
      if (error && recoveringPassword) setRecoveryError('This reset link could not be verified. Request a new link below.')
    }).catch(() => {
      if (!active || authEventReceived) return
      setChecking(false)
      if (recoveringPassword) setRecoveryError('Could not open the reset link. Please check your connection and request a new link.')
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      authEventReceived = true
      setSession(nextSession); setChecking(false)
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveringPassword(true); setRecoveryError(''); setPasswordRecoveryUrl(true)
      }
      if (!nextSession) { setPasswordOpen(false); setPasswordBusy(false); setReminderOpen(false) }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    setPage('Dashboard'); setEntry({}); setNotice(''); setMoreOpen(false)
    setPasswordOpen(false); setPasswordBusy(false); setQuickExpenseOpen(false); setReminderOpen(false)
    setUiOwner(session?.user.id ?? null)
  }, [session?.user.id])

  useEffect(() => {
    const onBeforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as DeferredInstallPrompt) }
    const onInstalled = () => { setInstallPrompt(null); setNotice('Coffee Estate Manager is installed and will open like an app.') }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => { window.removeEventListener('beforeinstallprompt', onBeforeInstall); window.removeEventListener('appinstalled', onInstalled) }
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const openReminder = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_ADVANCE' && validAdvanceWeek(event.data.weekStart)) setNotificationWeek(event.data.weekStart)
    }
    navigator.serviceWorker.addEventListener('message', openReminder)
    return () => navigator.serviceWorker.removeEventListener('message', openReminder)
  }, [])

  useEffect(() => {
    // Keep a notification link through sign-in and record loading. Existing weekly
    // drafts use Labour's save/discard guard when a different week is requested.
    if (!notificationWeek || !session || checking || loading || error || recoveringPassword || passwordOpen || quickExpenseOpen || reminderOpen || moreOpen) return
    startAdvance(notificationWeek)
    setNotificationWeek(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('advanceWeek')
    window.history.replaceState(window.history.state, '', url.href)
  }, [notificationWeek, session, checking, loading, error, recoveringPassword, passwordOpen, quickExpenseOpen, reminderOpen, moreOpen])

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
    if (nextPage !== page) startTransition(() => setPage(nextPage))
    window.scrollTo({ top: 0, behavior: 'instant' })
    requestAnimationFrame(() => { if (!document.querySelector('dialog[open]')) mainRef.current?.focus({ preventScroll: true }) })
  }
  function startAdvance(week: string) {
    if (!validAdvanceWeek(week)) return
    if (page !== 'Labour') setYear(Number(week.slice(0, 4)))
    navigate('Labour', { advanceDate: week, advanceRequest: ++advanceRequest.current })
  }
  function finishPasswordRecovery() {
    setRecoveringPassword(false); setRecoveryError(''); setPasswordRecoveryUrl(false)
  }
  function openPasswordSettings() {
    setMoreOpen(false)
    if (menuRef.current) menuRef.current.open = false
    setPasswordOpen(true)
  }
  function openReminderSettings() {
    setMoreOpen(false)
    if (menuRef.current) menuRef.current.open = false
    setReminderOpen(true)
    void reminders.refreshStatus()
  }
  function refreshFromMenu() {
    setMoreOpen(false)
    if (menuRef.current) menuRef.current.open = false
    void refresh()
  }
  async function signOut() {
    setMoreOpen(false)
    if (menuRef.current) menuRef.current.open = false
    await reminders.disconnectDevice()
    const { error } = await supabase.auth.signOut()
    if (error) setNotice(error.message)
  }
  if (checking) return <main className="app-opening"><RecordLoading message="Opening Coffee Estate Manager…" compact /></main>
  if (recoveringPassword) {
    if (!session || recoveryError) return <AuthScreen key="password-recovery" initialMode="forgot-password" initialMessage={recoveryError || 'This reset link is invalid or has expired. Request a new link below.'} onReturnToSignIn={finishPasswordRecovery} />
    return <PasswordRecovery email={session.user.email} onComplete={finishPasswordRecovery} />
  }
  if (!session) return <AuthScreen />
  if (uiOwner !== session.user.id) return <main className="app-opening"><RecordLoading compact /></main>

  const currentYear = Number(estateToday().slice(0, 4))
  const recordYears = [...data.production.map((item) => item.production_year), ...data.sales.map((item) => Number(item.sale_date.slice(0, 4))), ...data.expenses.map((item) => Number(item.expense_date.slice(0, 4))), ...data.weeklyPayments.map((item) => Number(item.week_start.slice(0, 4)))]
  const years = [...new Set([year, ...Array.from({ length: 11 }, (_, index) => currentYear - 5 + index), ...recordYears])].filter(Number.isFinite).sort((a, b) => b - a)
  const current = () => {
    const props = { data, year, refresh }
    switch (page) {
      case 'Labour': return <Labour {...props} onYearChange={setYear} initialAdvanceDate={entry.advanceDate} advanceRequest={entry.advanceRequest} onEditReminder={openReminderSettings} reminder={{ settings: reminders.settings, loading: reminders.loading, ready: reminders.ready, activeHere: reminders.deviceSubscribed && reminders.permission === 'granted', error: Boolean(reminders.error) }} />
      case 'Expenses': return <Expenses {...props} initialView={entry.expenseView} />
      case 'Rainfall': return <Rainfall defaultYear={year} />
      case 'Prices': return <Prices />
      case 'Production': return <Production {...props} />
      case 'Documents': return <Documents key={session.user.id} userId={session.user.id} data={data} refresh={refresh} />
      case 'Backup': return <Backup data={data} refresh={refresh} />
      case 'Farm Intelligence': return <FarmIntelligence key={session.user.id} userId={session.user.id} />
      case 'Our Estate': return <OurEstateWorkspace key={session.user.id} userId={session.user.id} email={session.user.email} onExit={() => navigate('Dashboard')} onOpenMenu={() => setMoreOpen(true)} />
      default: return <Dashboard data={data} year={year} onNavigate={navigate} onStartAdvance={startAdvance} onAddExpense={() => setQuickExpenseOpen(true)} advance={{ loading: reminders.loading, error: Boolean(reminders.error), weekStart: reminders.status?.weekStart, weekStatus: reminders.status?.weekStatus }} />
    }
  }

  const hasRecords = data.workers.length || data.expenses.length || data.production.length || data.sales.length || data.documents.length

  return <div className={`app-shell${page === 'Our Estate' ? ' is-estate-view' : ''}`}>
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
              <button onClick={openReminderSettings}><Bell size={18} aria-hidden="true" />Advance reminder</button>
              <button disabled={refreshing} onClick={refreshFromMenu}><RefreshCw size={18} aria-hidden="true" />Refresh records</button>
              <button onClick={openPasswordSettings}><LockKeyhole size={18} aria-hidden="true" />Change password</button>
              {installPrompt && <button onClick={() => void installApp()}>＋ Install app</button>}
              <button onClick={() => void signOut()}>Sign out</button>
            </div>
          </details>
        </div>
      </div>
      <SelectionNav value={page} aria-label="Main navigation" className="desktop-nav mx-auto hidden max-w-7xl gap-1 px-4 pb-2 sm:flex sm:px-6 lg:px-8">
        {navigation.map((item) => <button key={item.page} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined} className={page === item.page ? 'desktop-nav-item is-active' : 'desktop-nav-item'}><AppIcon name={item.icon} />{item.page === 'Production' ? 'Harvest & sales' : item.page}</button>)}
      </SelectionNav>
    </header>
    <main id="main-content" ref={mainRef} tabIndex={-1} className="main-content">
      {error && <div className="app-banner" role="alert"><strong>Your records could not be loaded.</strong><p>{error}</p>{loadedAt && <p>Showing the last loaded records. Refresh before making further changes.</p>}<button className="button-secondary mt-3" onClick={() => void refresh()}>Try again</button></div>}
      {(navigating || (refreshing && !loading)) && <div className="app-progress" role="status"><span>{navigating ? 'Opening screen…' : 'Updating records…'}</span></div>}
      {notice && <div className="app-banner notice-banner" role="status"><p>{notice}</p><button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div>}
      {!loading && !error && !hasRecords && page === 'Dashboard' && <div className="app-banner welcome-banner"><div><strong>Welcome to your estate desk.</strong><p>Add your first worker, expense or harvest to get started.</p></div><details><summary>Explore with sample records</summary><p className="mt-2 text-sm">This adds sample records to your account.</p><button className="button-secondary mt-2" disabled={loadingDemo} onClick={() => void loadDemo()}>{loadingDemo ? 'Adding records…' : 'Add sample records'}</button></details></div>}
      {loading ? <RecordLoading /> : (!error || loadedAt) && <PageBoundary key={session.user.id} resetKey={page}><Suspense fallback={<RecordLoading message="Opening screen…" />}><div className="page-transition" key={`${session.user.id}:${page}`}>{current()}</div></Suspense></PageBoundary>}
    </main>
    <SelectionNav value={moreOpen ? 'Menu' : page} aria-label="Main navigation" className="mobile-nav sm:hidden">{navigation.filter(item => ['Dashboard', 'Labour', 'Expenses'].includes(item.page)).map((item) => <button key={item.page} className={`mobile-nav-item ${!moreOpen && page === item.page ? 'is-active' : ''}`} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}><span className="mobile-nav-icon"><AppIcon name={item.icon} /></span><span className="mobile-nav-label">{item.short}</span></button>)}<button className={`mobile-nav-item ${moreOpen || ['Documents', 'Production', 'Prices', 'Rainfall', 'Backup', 'Farm Intelligence', 'Our Estate'].includes(page) ? 'is-active' : ''}`} onClick={() => setMoreOpen(true)} aria-label="Menu" aria-haspopup="dialog" aria-expanded={moreOpen}><span className="mobile-nav-icon"><Menu size={21} aria-hidden="true" /></span><span className="mobile-nav-label">Menu</span></button></SelectionNav>
    <Sheet open={moreOpen} title="Menu" className="mobile-menu-sheet" onClose={() => setMoreOpen(false)}>
      <nav className="mobile-menu-sections" aria-label="Other sections">{navigation.filter(item => ['Documents', 'Production', 'Rainfall', 'Prices', 'Farm Intelligence', 'Our Estate'].includes(item.page)).map(item => <button type="button" key={item.page} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}><span className="mobile-menu-section-icon"><AppIcon name={item.icon} /></span><span>{item.page === 'Production' ? 'Harvest & sales' : item.page === 'Prices' ? 'Coffee prices' : item.page}</span></button>)}</nav>
      <div className="mobile-menu-tools"><h3>Account &amp; tools</h3><button type="button" onClick={() => navigate('Backup')}><AppIcon name="backup" /><span>Backup &amp; import</span><AppIcon name="arrow" /></button><button type="button" onClick={openReminderSettings}><Bell size={19} aria-hidden="true" /><span>Advance reminder</span><AppIcon name="arrow" /></button><button type="button" disabled={refreshing} onClick={refreshFromMenu}><RefreshCw size={19} aria-hidden="true" /><span>Refresh records</span></button><button type="button" onClick={openPasswordSettings}><LockKeyhole size={19} aria-hidden="true" /><span>Change password</span><AppIcon name="arrow" /></button>{installPrompt && <button type="button" onClick={() => { setMoreOpen(false); void installApp() }}><Download size={19} aria-hidden="true" /><span>Install app</span><AppIcon name="arrow" /></button>}<button type="button" className="mobile-menu-signout" onClick={() => void signOut()}><LogOut size={19} aria-hidden="true" /><span>Sign out</span></button></div>
    </Sheet>
    <ExpenseEditor data={data} refresh={refresh} open={quickExpenseOpen} onClose={() => setQuickExpenseOpen(false)} onSaved={setNotice} onManageCategories={() => navigate('Expenses', { expenseView: 'categories' })} />
    <AdvanceReminderSettings open={reminderOpen} onClose={() => setReminderOpen(false)} settings={reminders.settings} loading={reminders.loading} saving={reminders.saving} support={reminders.support} permission={reminders.permission} deviceSubscribed={reminders.deviceSubscribed} setupReady={reminders.ready} message={reminders.message} error={reminders.error} onSave={reminders.save} />
    <Sheet open={passwordOpen} title="Change password" busy={passwordBusy} onClose={() => setPasswordOpen(false)}>
      <p className="password-intro">Confirm your current password, then choose a new one for your account.</p>
      {passwordOpen && <PasswordForm email={session.user.email} verifyCurrent onBusyChange={setPasswordBusy} onCancel={() => setPasswordOpen(false)} onSuccess={() => { setPasswordOpen(false); setNotice('Your login password has been updated.') }} />}
    </Sheet>
  </div>
}
