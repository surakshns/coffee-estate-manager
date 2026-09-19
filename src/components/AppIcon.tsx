type IconName = 'home' | 'labour' | 'expenses' | 'rainfall' | 'prices' | 'harvest' | 'backup' | 'more' | 'arrow'

const paths: Record<IconName, string> = {
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  labour: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  expenses: 'M4 4h16v16H4zM8 8h8m-8 4h5m-5 4h8',
  rainfall: 'M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9M8 19v3m8-3v3m-4-1v3',
  prices: 'M4 3v17h17M8 14l4-4 4 2 5-6',
  harvest: 'M5 9h14l-1 12H6ZM3 5h18v4H3zM12 5C12 1 7 1 7 3c0 2 5 2 5 2Zm0 0c0-4 5-4 5-2 0 2-5 2-5 2Z',
  backup: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
}

export function AppIcon({ name }: { name: IconName }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 4 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
