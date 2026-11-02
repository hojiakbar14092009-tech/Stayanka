import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import BossPage from './BossPage.jsx'

// /boshliq?key=... — boshliq uchun alohida sahifa (login yo'q, maxfiy havola)
const Page = window.location.pathname.startsWith('/boshliq') ? BossPage : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)

// Oflayn rejim: sahifa fayllari keshlanadi (faqat build qilingan saytda; dev serverda HMR ga xalal bermasin)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
