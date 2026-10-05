import type { Worker, WorkerLoan } from './types'

export const WEEKLY_REPAYMENT_NOTE = 'Repayment recorded with weekly payment'

export interface WorkerLoanAccount {
  workerId: string
  name: string
  active: boolean
  advanced: number
  repaid: number
  balance: number
  lastDate: string
  records: WorkerLoan[]
}

export function workerLoanAccounts(workers: Worker[], loans: WorkerLoan[]): WorkerLoanAccount[] {
  const grouped = new Map<string, WorkerLoan[]>()
  const workerNames = new Map(workers.map(worker => [worker.id, worker]))
  for (const loan of loans) {
    const records = grouped.get(loan.worker_id)
    if (records) records.push(loan)
    else grouped.set(loan.worker_id, [loan])
  }
  return [...grouped].map(([workerId, records]) => {
    const worker = workerNames.get(workerId)
    const advanced = records.filter(item => item.kind === 'advance').reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0)
    const repaid = records.filter(item => item.kind === 'repayment').reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0)
    return {
      workerId, name: worker?.name ?? 'Deleted worker', active: worker?.active ?? false,
      advanced: advanced / 100, repaid: repaid / 100, balance: (advanced - repaid) / 100,
      lastDate: records.reduce((latest, item) => item.loan_date > latest ? item.loan_date : latest, ''),
      records: [...records].sort((a, b) => b.loan_date.localeCompare(a.loan_date) || a.id.localeCompare(b.id))
    }
  }).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name))
}
