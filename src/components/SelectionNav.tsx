import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'

type Bounds = { left: number; top: number; width: number; height: number }

// Keep the selected button's native semantics; the moving surface is decorative.
export function SelectionNav({ value, className = '', children, ...props }: ComponentPropsWithoutRef<'nav'> & { value: string }) {
  const ref = useRef<HTMLElement>(null)
  const [bounds, setBounds] = useState<Bounds | null>(null)

  useLayoutEffect(() => {
    const nav = ref.current
    if (!nav) return
    const measure = () => {
      const selected = nav.querySelector<HTMLElement>(':scope > button.is-active')
      const next = selected && selected.offsetWidth > 0 && selected.offsetHeight > 0
        ? { left: selected.offsetLeft, top: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight }
        : null
      setBounds(previous => previous?.left === next?.left && previous?.top === next?.top && previous?.width === next?.width && previous?.height === next?.height ? previous : next)
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(nav)
    nav.querySelectorAll(':scope > button').forEach(button => observer?.observe(button))
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [value])

  return <nav {...props} ref={ref} className={`${className} selection-nav${bounds ? ' has-selection' : ''}`}>
    {bounds && <span aria-hidden="true" className="selection-indicator" style={{ transform: `translate3d(${bounds.left}px, ${bounds.top}px, 0)`, width: bounds.width, height: bounds.height }} />}
    {children}
  </nav>
}
