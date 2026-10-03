import type { ReactNode } from 'react'
import { CoffeeCup } from './CoffeeCup'

export function AuthLayout({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return <main className="auth-shell px-4 py-10">
    <section className="auth-card mx-auto max-w-md p-6 sm:p-8">
      <div className="auth-brand"><div className="auth-mark" aria-hidden="true"><CoffeeCup /></div><div><p className="text-sm font-bold tracking-widest text-white/75">COFFEE ESTATE</p><h1 className="mt-1 text-3xl font-extrabold text-white">Manager</h1></div><span className="auth-leaf" aria-hidden="true">🌿</span></div>
      <h2 className="mt-7 text-2xl font-extrabold">{title}</h2>
      <p className="mt-2 text-stone-600">{detail}</p>
      {children}
    </section>
  </main>
}
