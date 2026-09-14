/** A small, original coffee-house emblem for the estate guide and app header. */
export function CoffeeCup({ className = 'h-10 w-10' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
    <circle cx="24" cy="24" r="23" fill="#00754A" />
    <circle cx="24" cy="24" r="20" stroke="#fff" strokeOpacity=".45" strokeWidth="1.25" />
    <path d="M15.5 18h17l-2 18H17.5l-2-18Z" fill="#FFFDF5" />
    <path d="M13.5 15.5h21l-1.2 3.4H14.7l-1.2-3.4Z" fill="#fff" />
    <path d="M18.5 12h11l1 3.5h-13l1-3.5Z" fill="#DDEEE4" />
    <path d="M16.8 23h14.4l-1 8.2H17.8L16.8 23Z" fill="#00754A" />
    <path d="m24 23.9 1 2.05 2.25.33-1.63 1.59.38 2.24-2-1.05-2 1.05.38-2.24-1.63-1.59 2.25-.33 1-2.05Z" fill="#fff" />
  </svg>
}
