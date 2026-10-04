// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import type { EstateData } from '../lib/types'
import { Dashboard } from './Dashboard'

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <>{children}</>
  const Element = () => null
  return {
    ResponsiveContainer: Container,
    BarChart: Container,
    ComposedChart: Container,
    LineChart: Container,
    CartesianGrid: Element,
    Tooltip: Element,
    XAxis: Element,
    YAxis: Element,
    Bar: Element,
    Line: Element,
  }
})

const data: EstateData = {
  workers: [
    { id: 'ravi', name: 'Ravi', active: true, default_weekly_amount: 2250 },
    { id: 'meena', name: 'Meena', active: false, default_weekly_amount: 2250 },
    { id: 'kumar', name: 'Kumar', active: false, default_weekly_amount: 2250 },
  ],
  weeklyPayments: [
    { id: 'january-1', worker_id: 'ravi', week_start: '2026-01-07', amount: 2250, days_worked: 5, loan_deduction: 250 },
    { id: 'january-2', worker_id: 'ravi', week_start: '2026-01-21', amount: 2700, days_worked: 6, loan_deduction: 500 },
    { id: 'skipped', worker_id: 'ravi', week_start: '2026-01-14', amount: 99999, days_worked: 99, loan_deduction: 666, excluded: true },
    { id: 'february', worker_id: 'ravi', week_start: '2026-02-04', amount: 1800, days_worked: 4, loan_deduction: 200 },
    { id: 'zero', worker_id: 'ravi', week_start: '2026-02-11', amount: 0, days_worked: 0, loan_deduction: 0 },
  ],
  workerLoans: [
    { id: 'ravi-opening', worker_id: 'ravi', loan_date: '2025-12-15', amount: 20000, kind: 'advance', notes: '' },
    { id: 'ravi-january-1', worker_id: 'ravi', loan_date: '2026-01-07', amount: 250, kind: 'repayment', notes: 'Weekly deduction' },
    { id: 'ravi-january-2', worker_id: 'ravi', loan_date: '2026-01-21', amount: 500, kind: 'repayment', notes: 'Weekly deduction' },
    { id: 'ravi-february-repaid', worker_id: 'ravi', loan_date: '2026-02-04', amount: 200, kind: 'repayment', notes: 'Weekly deduction' },
    { id: 'ravi-february-given', worker_id: 'ravi', loan_date: '2026-02-10', amount: 5000, kind: 'advance', notes: '' },
    { id: 'ravi-march-given', worker_id: 'ravi', loan_date: '2026-03-03', amount: 10000, kind: 'advance', notes: '' },
    { id: 'meena-opening', worker_id: 'meena', loan_date: '2025-10-01', amount: 1000, kind: 'advance', notes: '' },
    { id: 'meena-january-given', worker_id: 'meena', loan_date: '2026-01-25', amount: 4000, kind: 'advance', notes: '' },
    { id: 'meena-february-repaid', worker_id: 'meena', loan_date: '2026-02-15', amount: 500, kind: 'repayment', notes: '' },
  ],
  labourRates: [], categories: [], expenses: [], prices: [], monthlyGuideEntries: [], production: [], sales: [], documents: [],
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function openWorkers(from = '2026-01', to = '2026-02') {
  const user = userEvent.setup()
  render(<Dashboard data={data} year={2026} />)
  await user.click(screen.getByRole('button', { name: 'Workers & loans' }))
  changePeriod(from, to)
  return user
}

function changePeriod(from: string, to: string) {
  fireEvent.change(screen.getByLabelText('Period start month'), { target: { value: from } })
  fireEvent.change(screen.getByLabelText('Period end month'), { target: { value: to } })
}

function workerMetric(worker: HTMLElement, label: string) {
  return within(worker).getByText(label, { exact: true }).parentElement?.textContent ?? ''
}

describe('home record shortcuts', () => {
  it('opens the actual current pay week even when the overview shows a historical year', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    const onStartAdvance = vi.fn()
    const onAddExpense = vi.fn()
    const user = userEvent.setup()
    render(<Dashboard data={data} year={2024} onStartAdvance={onStartAdvance} onAddExpense={onAddExpense} />)
    const advance = screen.getByRole('button', { name: 'Start this week’s advance' })
    expect(advance.textContent).toMatch(/31 Dec,? 2025/)
    expect(advance.textContent).toContain('Not saved')
    await user.click(advance)
    expect(onStartAdvance).toHaveBeenCalledWith('2025-12-31')
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(onAddExpense).toHaveBeenCalledOnce()
  })

  it('offers editing only for saved records in the current Wednesday week', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-08T12:00:00Z'))
    const view = render(<Dashboard data={data} year={2026} onStartAdvance={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Edit this week’s advance' }).textContent).toContain('Saved')
    view.rerender(<Dashboard data={{ ...data, weeklyPayments: data.weeklyPayments.filter(payment => payment.week_start !== '2026-01-07') }} year={2026} onStartAdvance={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Start this week’s advance' })).toBeTruthy()
  })
})

describe('combined workers and loans dashboard', () => {
  it('keeps pay and loans in one view and removes the estimated payoff chart', async () => {
    await openWorkers()
    expect(screen.queryByRole('button', { name: 'Workers & pay' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Loans' })).toBeNull()
    expect(screen.queryByText('Loan journey & estimated payoff')).toBeNull()
    expect(screen.queryByText('Estimated payoff month & year')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Advances' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Repayments' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Advances by month' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Repayments by month' })).toBeTruthy()
    expect(screen.getAllByLabelText('Period start month')).toHaveLength(1)
    expect(screen.getAllByLabelText('Period end month')).toHaveLength(1)
  })

  it('shows each worker once with concise pay and loan totals and expandable details', async () => {
    const user = await openWorkers()
    const ravi = screen.getByRole('article', { name: 'Ravi pay and loans' })
    expect(within(ravi).getAllByRole('heading', { name: 'Ravi' })).toHaveLength(1)
    expect(workerMetric(ravi, 'Take-home pay')).toContain('₹5,800')
    expect(workerMetric(ravi, 'Loan balance')).toContain('₹24,050')
    await user.click(within(ravi).getByText('Pay & loan details for Ravi', { exact: true }))
    expect(workerMetric(ravi, 'Gross pay')).toContain('₹6,750')
    expect(workerMetric(ravi, 'Deducted from pay')).toContain('₹950')
    expect(workerMetric(ravi, 'Advances in range')).toContain('₹5,000')
    expect(workerMetric(ravi, 'Repaid in range')).toContain('₹950')
  })

  it('retains an inactive worker with debt and loan activity even without wages', async () => {
    await openWorkers()
    const meena = screen.getByRole('article', { name: 'Meena pay and loans' })
    expect(workerMetric(meena, 'Take-home pay')).toContain('₹0')
    expect(workerMetric(meena, 'Loan balance')).toContain('₹4,500')
    expect(screen.queryByRole('article', { name: 'Kumar pay and loans' })).toBeNull()
  })

  it('updates wages, loan amounts and historical balances with the same selected months', async () => {
    const user = await openWorkers('2026-01', '2026-01')
    const ravi = screen.getByRole('article', { name: 'Ravi pay and loans' })
    expect(workerMetric(ravi, 'Take-home pay')).toContain('₹4,200')
    expect(workerMetric(ravi, 'Loan balance')).toContain('₹19,250')
    await user.click(screen.getByText('View monthly loan amounts', { exact: true }))
    const table = screen.getByRole('table', { name: 'Monthly advances, repayments and closing balances' })
    expect(within(table).getByRole('row', { name: /Jan 2026/ }).textContent).toContain('₹750')
    expect(within(table).queryByRole('row', { name: /Feb 2026/ })).toBeNull()

    changePeriod('2026-02', '2026-02')
    const februaryRavi = screen.getByRole('article', { name: 'Ravi pay and loans' })
    expect(workerMetric(februaryRavi, 'Take-home pay')).toContain('₹1,600')
    expect(workerMetric(februaryRavi, 'Loan balance')).toContain('₹24,050')
    await user.click(screen.getByText('View monthly loan amounts', { exact: true }))
    const februaryTable = screen.getByRole('table', { name: 'Monthly advances, repayments and closing balances' })
    expect(within(februaryTable).getByRole('row', { name: /Feb 2026/ }).textContent).toContain('₹700')
    expect(within(februaryTable).getByRole('row', { name: /Feb 2026/ }).textContent).toContain('₹5,000')
    expect(within(februaryTable).queryByRole('row', { name: /Jan 2026/ })).toBeNull()
  })

  it('does not count skipped payroll or inflate totals with zero payments', async () => {
    const user = await openWorkers()
    const ravi = screen.getByRole('article', { name: 'Ravi pay and loans' })
    await user.click(within(ravi).getByText('Pay & loan details for Ravi', { exact: true }))
    expect(workerMetric(ravi, 'Take-home pay')).toContain('₹5,800')
    expect(workerMetric(ravi, 'Gross pay')).toContain('₹6,750')
    expect(workerMetric(ravi, 'Deducted from pay')).toContain('₹950')
    expect(ravi.textContent).not.toContain('₹99,999')
    expect(ravi.textContent).not.toContain('₹666')
  })

  it('explains reversed ranges and recovers when the range becomes valid', async () => {
    await openWorkers('2026-03', '2026-01')
    expect(screen.getByRole('alert').textContent).toMatch(/from|start/i)
    changePeriod('2026-01', '2026-02')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(workerMetric(screen.getByRole('article', { name: 'Ravi pay and loans' }), 'Take-home pay')).toContain('₹5,800')
  })

  it('uses both loan and wage history for the All recorded range shortcut', async () => {
    const user = await openWorkers()
    await user.click(screen.getByRole('button', { name: 'All recorded' }))
    expect((screen.getByLabelText('Period start month') as HTMLInputElement).value).toBe('2025-10')
    expect((screen.getByLabelText('Period end month') as HTMLInputElement).value).toBe('2026-03')
    const ravi = screen.getByRole('article', { name: 'Ravi pay and loans' })
    expect(workerMetric(ravi, 'Take-home pay')).toContain('₹5,800')
    expect(workerMetric(ravi, 'Loan balance')).toContain('₹34,050')
  })

  it('resets a custom range when the selected dashboard year changes', async () => {
    const user = userEvent.setup()
    const view = render(<Dashboard data={data} year={2026} />)
    await user.click(screen.getByRole('button', { name: 'Workers & loans' }))
    changePeriod('2026-01', '2026-02')
    view.rerender(<Dashboard data={data} year={2025} />)
    expect((screen.getByLabelText('Period start month') as HTMLInputElement).value).toBe('2025-01')
    expect((screen.getByLabelText('Period end month') as HTMLInputElement).value).toBe('2025-12')
    const ravi = screen.getByRole('article', { name: 'Ravi pay and loans' })
    expect(workerMetric(ravi, 'Take-home pay')).toContain('₹0')
    expect(workerMetric(ravi, 'Loan balance')).toContain('₹20,000')
  })

  it('uses twelve inclusive months across the year boundary for Last 12 months', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'))
    const user = await openWorkers('2026-01', '2026-01')
    await user.click(screen.getByRole('button', { name: 'Last 12 months' }))
    expect((screen.getByLabelText('Period start month') as HTMLInputElement).value).toBe('2025-03')
    expect((screen.getByLabelText('Period end month') as HTMLInputElement).value).toBe('2026-02')
    expect(workerMetric(screen.getByRole('article', { name: 'Ravi pay and loans' }), 'Loan balance')).toContain('₹24,050')
  })

  it('marks missing attendance rather than estimating workdays from wages', async () => {
    const user = userEvent.setup()
    const incompleteAttendance = {
      ...data,
      weeklyPayments: data.weeklyPayments.map(payment => payment.id === 'january-1' ? { ...payment, days_worked: null } : payment),
    }
    render(<Dashboard data={incompleteAttendance} year={2026} />)
    await user.click(screen.getByRole('button', { name: 'Workers & loans' }))
    changePeriod('2026-01', '2026-01')
    const ravi = screen.getByRole('article', { name: 'Ravi pay and loans' })
    expect(within(ravi).getByText(/Attendance not recorded/)).toBeTruthy()
    expect(workerMetric(ravi, 'Take-home pay')).toContain('₹4,200')
    expect(screen.getByText('Recorded workdays').parentElement?.textContent).toContain('6 days')
    expect(screen.getByText(/1 entry has no attendance/)).toBeTruthy()
  })

  it('starts with six worker cards, shows all on request and resets that limit for a new range', async () => {
    const user = userEvent.setup()
    const manyWorkers = Array.from({ length: 8 }, (_, index) => ({ id: `worker-${index}`, name: `Worker ${index + 1}`, active: true, default_weekly_amount: 2250 }))
    render(<Dashboard data={{ ...data, workers: manyWorkers, weeklyPayments: [], workerLoans: [] }} year={2026} />)
    await user.click(screen.getByRole('button', { name: 'Workers & loans' }))
    changePeriod('2026-01', '2026-02')
    expect(screen.getAllByRole('article', { name: /pay and loans$/ })).toHaveLength(6)
    await user.click(screen.getByRole('button', { name: 'Show all 8 workers' }))
    expect(screen.getAllByRole('article', { name: /pay and loans$/ })).toHaveLength(8)
    expect(screen.getByRole('button', { name: 'Show fewer workers' })).toBeTruthy()
    changePeriod('2026-02', '2026-02')
    expect(screen.getAllByRole('article', { name: /pay and loans$/ })).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Show all 8 workers' })).toBeTruthy()
  })
})
