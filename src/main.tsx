import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
