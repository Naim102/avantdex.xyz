import { useEffect } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { Header, NetworkBanner } from '@/components/Header'
import Home from '@/pages/Home'
import Explore from '@/pages/Explore'
import MarketDetail from '@/pages/MarketDetail'
import Portfolio from '@/pages/Portfolio'
import Legal from '@/pages/Legal'
import { ListingHub, RequestListing, SubmitProject } from '@/pages/Listing'
import AdminLayout from '@/pages/admin/AdminLayout'
import { ApprovedProjects, Applications, Verification } from '@/pages/admin/Projects'
import { LiveMarkets, MarketManagement, SettlementManagement } from '@/pages/admin/Markets'
import { AuditLogs, Disputes, Overview, Roles, SettingsPage, Users } from '@/pages/admin/Misc'
import { EmptyState } from '@/components/ui'
import { useConfig } from '@/hooks/useApp'

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function Footer() {
  const { data: cfg } = useConfig()
  return (
    <footer className="mx-auto max-w-6xl space-y-2 px-4 pb-24 text-xs text-[var(--subtle)]">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {[['terms', 'Terms'], ['privacy', 'Privacy'], ['risk', 'Risk Disclosure'], ['cookies', 'Cookies'], ['listing-policy', 'Listing Policy'], ['rules', 'Trading & Settlement Rules']].map(([k, l]) => (
          <Link key={k} to={`/legal/${k}`} className="hover:text-[var(--ink)]">
            {l}
          </Link>
        ))}
      </div>
      <p>
        Avantdex runs on {cfg?.network ?? 'Arc Testnet'}. Testnet software, <b>not audited</b>. Onchain tokens and pre-market positions are not investment advice and carry significant risk. Verification badges do not imply safety or guaranteed delivery.
      </p>
    </footer>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollTop />
      <div className="min-h-dvh">
        <Header />
        <NetworkBanner />
        <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/market/:key" element={<MarketDetail />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/list" element={<ListingHub />} />
            <Route path="/list/submit" element={<SubmitProject />} />
            <Route path="/list/request" element={<RequestListing />} />
            <Route path="/legal/:page" element={<Legal />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Overview />} />
              <Route path="applications" element={<Applications />} />
              <Route path="verification" element={<Verification />} />
              <Route path="approved" element={<ApprovedProjects />} />
              <Route path="live-markets" element={<LiveMarkets />} />
              <Route path="market-management" element={<MarketManagement />} />
              <Route path="settlement" element={<SettlementManagement />} />
              <Route path="disputes" element={<Disputes />} />
              <Route path="users" element={<Users />} />
              <Route path="roles" element={<Roles />} />
              <Route path="audit-logs" element={<AuditLogs />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route
              path="*"
              element={
                <EmptyState
                  title="Page not found"
                  action={
                    <Link to="/" className="btn btn-primary">
                      Home
                    </Link>
                  }
                />
              }
            />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  )
}
