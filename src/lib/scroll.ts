export function scrollToEditor(element: HTMLElement | null) {
  window.requestAnimationFrame(() => {
    element?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start'
    })
  })
}
