import { useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
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
import { Footer } from '@/components/Footer'

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** Every route change fades and slides the new page in. Static for people who prefer reduced motion. */
function PageFrame({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const reduce = useReducedMotion()
  const cls = 'mx-auto max-w-6xl px-3 pb-12 pt-5 sm:px-4 sm:pb-16 sm:pt-8'
  if (reduce) return <main className={cls}>{children}</main>
  return (
    <motion.main key={pathname} className={cls} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollTop />
      <div className="min-h-dvh">
        <Header />
        <NetworkBanner />
        <PageFrame>
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
        </PageFrame>
        <Footer />
      </div>
    </BrowserRouter>
  )
}
