import { House, Users, ReceiptText, CloudRain, ChartNoAxesCombined, Sprout, Files, Download, Ellipsis, ArrowRight, Leaf } from 'lucide-react'

type IconName = 'home' | 'labour' | 'expenses' | 'rainfall' | 'prices' | 'harvest' | 'documents' | 'backup' | 'more' | 'arrow' | 'intelligence'
const icons = { home: House, labour: Users, expenses: ReceiptText, rainfall: CloudRain, prices: ChartNoAxesCombined, harvest: Sprout, documents: Files, backup: Download, more: Ellipsis, arrow: ArrowRight, intelligence: Leaf }
export function AppIcon({ name }: { name: IconName }) {
  const Icon = icons[name]
  return <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
}
