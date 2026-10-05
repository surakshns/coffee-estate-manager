import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EstateData } from '../lib/types'

export const emptyEstateData: EstateData = { workers: [], weeklyPayments: [], workerLoans: [], labourRates: [], categories: [], expenses: [], prices: [], monthlyGuideEntries: [], production: [], sales: [], documents: [] }
const tables = [
  ['workers', 'id,name,active,default_weekly_amount,default_days_worked,created_at', 'name', true],
  ['weekly_payments', 'id,worker_id,week_start,amount,excluded,days_worked,daily_rate,loan_deduction', 'week_start', false],
  ['worker_loans', 'id,worker_id,loan_date,amount,kind,notes', 'loan_date', false],
  ['labour_daily_rates', 'id,rate_year,daily_rate', 'rate_year', false],
  ['expense_categories', 'id,name,archived', 'name', true],
  ['expenses', 'id,expense_date,category_id,description,amount,expense_categories(name)', 'expense_date', false],
  ['coffee_prices', 'id,price_date,coffee_type,grade,source,price_per_kg', 'price_date', false],
  ['monthly_tasks', 'id,month_number,title,notes,created_at,updated_at', 'month_number', true],
  ['production_records', 'id,production_year,bags_produced,bag_weight_kg,notes', 'production_year', false],
  ['sales', 'id,sale_date,production_year,bags_sold,selling_price_per_bag,buyer', 'sale_date', false],
  ['property_documents', 'id,title,document_date,category,notes,file_path,file_name,file_type,file_size,created_at,encryption_version,encrypted_metadata', 'created_at', false],
] as const

// Stable ordering and explicit pages avoid silently truncating account totals.
// Build a fresh query for each page rather than reusing its mutable URL.
async function readTable(spec: typeof tables[number], userId: string, signal: AbortSignal) {
  const rows: Record<string, unknown>[] = []
  const columns: string = spec[1]
  for (;;) {
    const { data, error } = await supabase.from(spec[0]).select(columns).eq('user_id', userId)
      .order(spec[2], { ascending: spec[3] }).order('id')
      .range(rows.length, rows.length + 499).abortSignal(signal).returns<Record<string, unknown>[]>()
    if (error) throw error
    if (signal.aborted) throw new Error('Record loading was cancelled.')
    const page = data ?? []
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

type Snapshot = { owner: string | null; data: EstateData; loading: boolean; refreshing: boolean; error: string; loadedAt: number | null }
const blank = (owner: string | null): Snapshot => ({ owner, data: emptyEstateData, loading: !!owner, refreshing: false, error: '', loadedAt: null })

export function useEstateData(userId: string | null) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => blank(userId))
  const account = useRef(userId)
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  account.current = userId

  const refresh = useCallback(async () => {
    if (!userId || account.current !== userId) return
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    const sequence = ++generation.current
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; request.abort() }, 30000)
    const current = () => account.current === userId && generation.current === sequence
    setSnapshot(previous => ({ ...(previous.owner === userId ? previous : blank(userId)), loading: previous.owner !== userId || !previous.loadedAt, refreshing: true, error: '' }))
    try {
      const rows = await Promise.all(tables.map(spec => readTable(spec, userId, request.signal)))
      if (!current()) return
      const expenses = rows[5].map(expense => ({ ...expense, expense_categories: Array.isArray(expense.expense_categories) ? expense.expense_categories[0] ?? null : expense.expense_categories }))
      const data = Object.fromEntries(['workers', 'weeklyPayments', 'workerLoans', 'labourRates', 'categories', 'expenses', 'prices', 'monthlyGuideEntries', 'production', 'sales', 'documents'].map((key, index) => [key, index === 5 ? expenses : rows[index]])) as unknown as EstateData
      setSnapshot({ owner: userId, data, error: '', loading: false, refreshing: false, loadedAt: Date.now() })
    } catch (cause) {
      if (!current()) return
      request.abort()
      const detail = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Check your connection and try again.'
      setSnapshot(previous => ({ ...previous, loading: false, refreshing: false, error: timedOut ? 'Loading took too long. Check your connection and try again.' : detail }))
    } finally { window.clearTimeout(timer) }
  }, [userId])

  useEffect(() => {
    setSnapshot(blank(userId))
    if (userId) void refresh()
    return () => { generation.current++; controller.current?.abort() }
  }, [userId, refresh])

  // Hide the previous account synchronously, before effects or requests finish.
  const visible = snapshot.owner === userId ? snapshot : blank(userId)
  return { ...visible, refresh }
}
