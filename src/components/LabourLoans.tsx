import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, CircleCheck, History, Plus, Trash2, Wallet } from 'lucide-react'
import { money } from '../lib/calculations'
import { WEEKLY_REPAYMENT_NOTE, workerLoanAccounts } from '../lib/labourLoans'
import type { EstateData, WorkerLoan } from '../lib/types'
import { EmptyState, SearchField, Sheet, displayDate } from './Workspace'

type Filter = 'outstanding' | 'settled' | 'all'
interface Props {
  data: EstateData
  busy: boolean
  onRecord: (kind: 'advance' | 'repayment', workerId?: string) => void
  onDelete: (loan: WorkerLoan) => void
  onEditWeek: (date: string) => void
}

export function LabourLoans({ data, busy, onRecord, onDelete, onEditWeek }: Props) {
  const accounts = useMemo(() => workerLoanAccounts(data.workers, data.workerLoans), [data.workers, data.workerLoans])
  const [filter, setFilter] = useState<Filter>('outstanding')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(8)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [historyLimit, setHistoryLimit] = useState(10)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'advance' | 'repayment'>('all')
  const selected = accounts.find(account => account.workerId === selectedId)
  const outstanding = accounts.filter(account => account.balance > 0)
  const totalDue = outstanding.reduce((sum, account) => sum + account.balance, 0)
  const totalRepaid = accounts.reduce((sum, account) => sum + account.repaid, 0)
  const credits = accounts.filter(account => account.balance < 0).reduce((sum, account) => sum - account.balance, 0)
  const query = search.trim().toLowerCase()
  const visible = accounts.filter(account => (filter === 'all' || (filter === 'outstanding' ? account.balance > 0 : account.balance === 0)) &&
    (!query || account.name.toLowerCase().includes(query) || account.records.some(record => [record.notes, record.loan_date, String(record.amount)].some(value => value.toLowerCase().includes(query)))))
  const history = selected?.records.filter(record => historyFilter === 'all' || record.kind === historyFilter) ?? []
  function showAccount(workerId: string) { setSelectedId(workerId); setHistoryLimit(10); setHistoryFilter('all') }
  function record(kind: 'advance' | 'repayment', workerId?: string) { setSelectedId(null); onRecord(kind, workerId) }

  return <section className="worker-loans" aria-label="Worker loan accounts">
    <div className="loan-overview">
      <div><span>Total outstanding</span><strong>{money(totalDue)}</strong><p>{outstanding.length} {outstanding.length === 1 ? 'worker owes' : 'workers owe'} a balance</p></div>
      <div><span>Repaid to date</span><strong>{money(totalRepaid)}</strong><p>All recorded repayments</p></div>
    </div>
    {credits > 0 && <p className="loan-credit-note">Worker credit: {money(credits)}. Shown under All accounts, separate from outstanding balances.</p>}
    <div className="loan-heading"><div><h2>Worker accounts</h2><p>See what each worker still owes. Open a statement for their history.</p><span>Balances include all years</span></div><button type="button" className="button-primary" disabled={busy || !data.workers.length} onClick={() => record('advance')}><Plus size={18} />Give advance</button></div>
    <div className="loan-filters">
      <SearchField value={search} onChange={value => { setSearch(value); setLimit(8) }} label="Search loan accounts" placeholder="Search worker or note" />
      <div className="loan-status-tabs" aria-label="Loan account status">{(['outstanding', 'settled', 'all'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setLimit(8) }}>{value === 'all' ? 'All accounts' : value === 'settled' ? 'Settled' : 'Outstanding'}<span>{accounts.filter(account => value === 'all' || (value === 'outstanding' ? account.balance > 0 : account.balance === 0)).length}</span></button>)}</div>
    </div>
    <p className="loan-results" role="status">{visible.length} {visible.length === 1 ? 'account' : 'accounts'}{search ? ` matching "${search}"` : ''}</p>
    <div className="loan-accounts">{visible.slice(0, limit).map(account => <article className="loan-account" key={account.workerId}>
      <div className="loan-account-heading"><span className="worker-avatar" aria-hidden="true">{account.name.slice(0, 1).toUpperCase()}</span><div><h3>{account.name}</h3><p>{account.active ? 'Worker account' : 'Inactive worker'}</p></div><span className={`loan-badge ${account.balance > 0 ? 'is-due' : ''}`}>{account.balance > 0 ? 'Outstanding' : account.balance < 0 ? 'Credit' : <><CircleCheck size={14} />Settled</>}</span></div>
      <div className="loan-account-balance"><span>{account.balance < 0 ? 'Worker credit' : 'Still to repay'}</span><strong>{money(Math.abs(account.balance))}</strong></div>
      <dl className="loan-account-totals"><div><dt>Advanced</dt><dd>{money(account.advanced)}</dd></div><div><dt>Repaid</dt><dd>{money(account.repaid)}</dd></div></dl>
      {account.advanced > 0 && <progress className="loan-progress" aria-label={`Loan repaid by ${account.name}`} value={Math.min(account.repaid, account.advanced)} max={account.advanced} />}
      <p className="loan-last-entry">Last entry {displayDate(account.lastDate)} · {account.records.length} {account.records.length === 1 ? 'transaction' : 'transactions'}</p>
      <div className="loan-account-actions"><button className="button-secondary" type="button" onClick={() => showAccount(account.workerId)} aria-label={`View statement for ${account.name}`}><History size={17} />Statement<ChevronRight size={16} /></button>{account.balance > 0 && <button className="button-secondary" type="button" disabled={busy} onClick={() => record('repayment', account.workerId)} aria-label={`Record repayment for ${account.name}`}><ArrowDownLeft size={17} />Repayment</button>}</div>
    </article>)}</div>
    {!visible.length && <EmptyState title={search ? 'No matching accounts' : filter === 'outstanding' ? 'No outstanding worker loans' : 'No accounts in this view'} detail={accounts.length ? 'All accounts includes settled balances and worker credits.' : 'No advances or repayments recorded.'} action={accounts.length ? 'Show all accounts' : undefined} onAction={() => { setSearch(''); setFilter('all'); setLimit(8) }} />}
    {visible.length > limit && <button className="button-secondary loan-load-more" type="button" onClick={() => setLimit(value => value + 8)}><ChevronDown size={18} />Show more accounts ({visible.length - limit})</button>}

    <Sheet open={!!selected} title={selected ? `${selected.name} · Loan statement` : 'Loan statement'} onClose={() => setSelectedId(null)}>
      {selected && <div className="loan-statement">
        <div className="loan-statement-balance"><Wallet size={22} /><div><span>{selected.balance < 0 ? 'Worker credit' : 'Outstanding balance'}</span><strong>{money(Math.abs(selected.balance))}</strong></div></div>
        <dl className="loan-account-totals"><div><dt>Total advanced</dt><dd>{money(selected.advanced)}</dd></div><div><dt>Total repaid</dt><dd>{money(selected.repaid)}</dd></div></dl>
        <div className="loan-statement-actions"><button type="button" className="button-secondary" disabled={busy} onClick={() => record('advance', selected.workerId)}><Plus size={17} />Give advance</button>{selected.balance > 0 && <button type="button" className="button-primary" disabled={busy} onClick={() => record('repayment', selected.workerId)}><ArrowDownLeft size={17} />Repayment</button>}</div>
        <p className="loan-explanation">An advance adds to the loan. A repayment or weekly pay deduction reduces it.</p>
        <div className="loan-statement-heading"><h3>Transactions</h3><select className="field" aria-label="Statement transaction type" value={historyFilter} onChange={event => { setHistoryFilter(event.target.value as typeof historyFilter); setHistoryLimit(10) }}><option value="all">All transactions</option><option value="advance">Advances</option><option value="repayment">Repayments</option></select></div>
        <p className="loan-results">{history.length} {history.length === 1 ? 'entry' : 'entries'} · Newest first</p>
        <ol className="loan-transactions">{history.slice(0, historyLimit).map(item => {
          const weekly = item.kind === 'repayment' && item.notes === WEEKLY_REPAYMENT_NOTE
          return <li key={item.id}>
            <div className={`loan-transaction-icon ${item.kind === 'repayment' ? 'is-repaid' : ''}`} aria-hidden="true">{item.kind === 'advance' ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}</div>
            <div className="loan-transaction-copy"><strong>{item.kind === 'advance' ? 'Advance given' : weekly ? 'Weekly pay deduction' : 'Repayment received'}</strong><time dateTime={item.loan_date}>{displayDate(item.loan_date)}</time>{item.notes && !weekly && <p>{item.notes}</p>}
              {weekly && <button type="button" className="loan-week-link" disabled={busy} onClick={() => { setSelectedId(null); onEditWeek(item.loan_date) }}>View weekly pay<ChevronRight size={14} /></button>}
            </div>
            <div className="loan-transaction-amount"><strong className={item.kind === 'repayment' ? 'is-repaid' : ''}>{item.kind === 'advance' ? '+' : '−'}{money(Number(item.amount))}</strong><span>{item.kind === 'advance' ? 'Added to loan' : 'Paid back'}</span>{!weekly && <button type="button" className="icon-button danger" title="Delete transaction" disabled={busy} aria-label={`Delete ${item.kind} of ${money(Number(item.amount))} on ${item.loan_date}`} onClick={() => { setSelectedId(null); onDelete(item) }}><Trash2 size={16} /></button>}</div>
          </li>
        })}</ol>
        {!history.length && <p className="labour-empty-record">No transactions of this type.</p>}
        {history.length > historyLimit && <button type="button" className="button-secondary loan-load-more" onClick={() => setHistoryLimit(value => value + 10)}><ChevronDown size={17} />Show older entries ({history.length - historyLimit})</button>}
      </div>}
    </Sheet>
  </section>
}
