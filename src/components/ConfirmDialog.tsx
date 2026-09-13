import type { ReactNode } from 'react'

export function ConfirmDialog({ open, title, children, onCancel, onConfirm, confirmLabel = 'Delete', confirmVariant = 'danger' }: { open: boolean; title: string; children: ReactNode; onCancel: () => void; onConfirm: () => void; confirmLabel?: string; confirmVariant?: 'danger' | 'primary' }) {
  if (!open) return null
  return <div className="fixed inset-0 z-50 grid place-items-center bg-stone-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <h2 id="confirm-title" className="text-xl font-extrabold text-stone-900">{title}</h2>
      <div className="mt-3 text-base leading-6 text-stone-600">{children}</div>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button className="button-secondary" onClick={onCancel}>Cancel</button>
        <button className={confirmVariant === 'danger' ? 'button-danger' : 'button-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>
}
