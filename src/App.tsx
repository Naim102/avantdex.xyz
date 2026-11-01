import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Header, NetworkBanner } from '@/components/Header'
import { Notice } from '@/components/ui'
import { MARKETPLACE } from '@/lib/allocx'
import Home from '@/pages/Home'
import Explore from '@/pages/Explore'
import ListingDetail from '@/pages/ListingDetail'
import CreateListing from '@/pages/CreateListing'
import Dashboard from '@/pages/Dashboard'

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollTop />
      <div className="min-h-dvh">
        <Header />
        <NetworkBanner />
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-8">
          {!MARKETPLACE ? (
            <Notice tone="error">The AllocX marketplace address is not configured (VITE_ALLOCX_MARKETPLACE).</Notice>
          ) : (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/listing/:id" element={<ListingDetail />} />
              <Route path="/create" element={<CreateListing />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="*" element={<Home />} />
            </Routes>
          )}
        </main>
        <footer className="mx-auto max-w-6xl px-4 pb-24 text-xs text-[var(--subtle)]">
          AllocX runs on Arc Testnet. Onchain ownership and admin rights are not legal company ownership.
        </footer>
      </div>
    </BrowserRouter>
  )
}
