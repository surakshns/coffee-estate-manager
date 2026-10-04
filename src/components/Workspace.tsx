import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Plus, Pencil, Trash2, FileSearch } from 'lucide-react'

export function PageHeading({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <header className="workspace-heading"><div><h1>{title}</h1><p>{detail}</p></div>{action && <button className="button-primary" onClick={onAction}><Plus size={18} />{action}</button>}</header>
}

export function ViewTabs<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (value: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return <nav className="workspace-tabs" aria-label={label}>{items.map(item => <button key={item.value} className={value === item.value ? 'is-active' : ''} aria-current={value === item.value ? 'page' : undefined} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</nav>
}

export function SearchField({ value, onChange, label, placeholder = 'Search records' }: { value: string; onChange: (value: string) => void; label: string; placeholder?: string }) {
  return <label className="workspace-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} />{value && <button type="button" aria-label={`Clear ${label.toLowerCase()}`} title="Clear search" onClick={() => onChange('')}><X size={17} /></button>}</label>
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return children ? <p className={`workspace-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p> : null
}

export function EmptyState({ title, detail, action, onAction }: { title: string; detail?: string; action?: string; onAction?: () => void }) {
  return <div className="workspace-empty"><FileSearch size={32} strokeWidth={1.4} aria-hidden="true" /><h3>{title}</h3>{detail && <p>{detail}</p>}{action && <button className="button-secondary" onClick={onAction}>{action}</button>}</div>
}

export function RecordActions({ name, onEdit, onDelete }: { name: string; onEdit: () => void; onDelete: () => void }) {
  return <div className="record-actions"><button className="icon-button" title="Edit" aria-label={`Edit ${name}`} onClick={onEdit}><Pencil size={17} /></button><button className="icon-button danger" title="Delete" aria-label={`Delete ${name}`} onClick={onDelete}><Trash2 size={17} /></button></div>
}

// A native modal supplies focus containment and makes the underlying page inert.
export function Sheet({ open, title, onClose, children, wide = false, busy = false, className = '', closeLabel }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean; className?: string; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.documentElement.style.overflow
    dialog?.showModal()
    document.documentElement.style.overflow = 'hidden'
    return () => { dialog?.close(); document.documentElement.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [open])
  if (!open) return null
  return createPortal(<dialog ref={ref} className={`workspace-sheet ${wide ? 'is-wide' : ''} ${className}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}><div className="sheet-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label={closeLabel ?? 'Close panel'} title={closeLabel ?? 'Close'} disabled={busy} onClick={onClose}><X size={22} /></button></div><div className="sheet-body">{children}</div></dialog>, document.body)
}

export const displayDate = (value: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
