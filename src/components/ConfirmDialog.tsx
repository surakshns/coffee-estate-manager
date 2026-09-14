import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ConfirmDialogProps = {
  open: boolean
  title: string
  children: ReactNode
  onCancel: () => void
  onConfirm: () => void
  confirmLabel?: string
  confirmVariant?: 'danger' | 'primary'
}

export function ConfirmDialog({ open, title, children, onCancel, onConfirm, confirmLabel = 'Delete', confirmVariant = 'danger' }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (!open) return

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallbackFocus = previousFocus?.closest<HTMLElement>('main, [role="main"]')
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'

    // Start on the safe action, and keep the same focus when a parent re-renders.
    const focusCancel = () => (cancelRef.current ?? dialogRef.current)?.focus({ preventScroll: true })
    const animationFrame = window.requestAnimationFrame(focusCancel)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'))
        .filter((element) => element.tabIndex >= 0
          && !element.matches(':disabled')
          && !element.closest('[hidden], [inert], [aria-hidden="true"]')
          && element.getClientRects().length > 0
          && window.getComputedStyle(element).visibility !== 'hidden')
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
      } else if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) focusCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      else if (fallbackFocus?.isConnected) fallbackFocus.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="confirm-backdrop fixed inset-0 z-[100] flex min-h-[100dvh] items-center justify-center overflow-y-auto overscroll-contain p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialogRef} className="confirm-dialog my-auto w-full max-w-md p-5 outline-none sm:p-6" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <h2 id={titleId} className="text-xl font-extrabold text-stone-900">{title}</h2>
        <div id={descriptionId} className="mt-3 text-base leading-6 text-stone-600">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" className="button-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className={confirmVariant === 'danger' ? 'button-danger' : 'button-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
