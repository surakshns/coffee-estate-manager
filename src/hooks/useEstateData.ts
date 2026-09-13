import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EstateData } from '../lib/types'

const empty: EstateData = { workers: [], weeklyPayments: [], categories: [], expenses: [], prices: [], production: [], sales: [] }

export function useEstateData() {
  const [data, setData] = useState<EstateData>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    const [workers, weeklyPayments, categories, expenses, prices, production, sales] = await Promise.all([
      supabase.from('workers').select('id,name,active,default_weekly_amount,created_at').order('name'),
      supabase.from('weekly_payments').select('id,worker_id,week_start,amount').order('week_start', { ascending: false }),
      supabase.from('expense_categories').select('id,name,archived').order('name'),
      supabase.from('expenses').select('id,expense_date,category_id,description,amount,expense_categories(name)').order('expense_date', { ascending: false }),
      supabase.from('coffee_prices').select('id,price_date,coffee_type,grade,source,price_per_kg').order('price_date', { ascending: false }),
      supabase.from('production_records').select('id,production_year,bags_produced,bag_weight_kg,notes').order('production_year', { ascending: false }),
      supabase.from('sales').select('id,sale_date,production_year,bags_sold,selling_price_per_bag,buyer').order('sale_date', { ascending: false })
    ])
    const firstError = [workers, weeklyPayments, categories, expenses, prices, production, sales].find((result) => result.error)?.error
    if (firstError) setError(firstError.message)
    else {
      const normalizedExpenses: EstateData['expenses'] = (expenses.data ?? []).map((expense) => ({
        ...expense,
        expense_categories: Array.isArray(expense.expense_categories) ? expense.expense_categories[0] ?? null : expense.expense_categories
      }))
      setData({
        workers: workers.data ?? [], weeklyPayments: weeklyPayments.data ?? [], categories: categories.data ?? [],
        expenses: normalizedExpenses, prices: prices.data ?? [], production: production.data ?? [], sales: sales.data ?? []
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  return { data, loading, error, refresh }
}
