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
