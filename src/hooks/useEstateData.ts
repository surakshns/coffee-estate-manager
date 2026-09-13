import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EstateData } from '../lib/types'

const empty: EstateData = { workers: [], weeklyPayments: [], workerLoans: [], categories: [], expenses: [], prices: [], monthlyGuideEntries: [], production: [], sales: [] }

export function useEstateData() {
  const [data, setData] = useState<EstateData>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const hasLoaded = useRef(false)

  const refresh = useCallback(async () => {
    const initialLoad = !hasLoaded.current
    if (initialLoad) setLoading(true)
    setError('')
    const [workers, weeklyPayments, workerLoans, categories, expenses, prices, monthlyGuideEntries, production, sales] = await Promise.all([
      supabase.from('workers').select('id,name,active,default_weekly_amount,created_at').order('name'),
      supabase.from('weekly_payments').select('id,worker_id,week_start,amount,excluded').order('week_start', { ascending: false }),
      supabase.from('worker_loans').select('id,worker_id,loan_date,amount,kind,notes').order('loan_date', { ascending: false }),
      supabase.from('expense_categories').select('id,name,archived').order('name'),
      supabase.from('expenses').select('id,expense_date,category_id,description,amount,expense_categories(name)').order('expense_date', { ascending: false }),
      supabase.from('coffee_prices').select('id,price_date,coffee_type,grade,source,price_per_kg').order('price_date', { ascending: false }),
      supabase.from('monthly_tasks').select('id,month_number,title,notes,created_at,updated_at').order('month_number').order('created_at'),
      supabase.from('production_records').select('id,production_year,bags_produced,bag_weight_kg,notes').order('production_year', { ascending: false }),
      supabase.from('sales').select('id,sale_date,production_year,bags_sold,selling_price_per_bag,buyer').order('sale_date', { ascending: false })
    ])
    const firstError = [workers, weeklyPayments, workerLoans, categories, expenses, prices, monthlyGuideEntries, production, sales].find((result) => result.error)?.error
    if (firstError) setError(firstError.message)
    else {
      const normalizedExpenses: EstateData['expenses'] = (expenses.data ?? []).map((expense) => ({
        ...expense,
        expense_categories: Array.isArray(expense.expense_categories) ? expense.expense_categories[0] ?? null : expense.expense_categories
      }))
      setData({
        workers: workers.data ?? [], weeklyPayments: weeklyPayments.data ?? [], workerLoans: workerLoans.data ?? [], categories: categories.data ?? [],
        expenses: normalizedExpenses, prices: prices.data ?? [], monthlyGuideEntries: monthlyGuideEntries.data ?? [], production: production.data ?? [], sales: sales.data ?? []
      })
    }
    hasLoaded.current = true
    if (initialLoad) setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  return { data, loading, error, refresh }
}
