import { Suspense, lazy, useEffect } from 'react'
import { motion, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { Header, NetworkBanner } from '@/components/Header'
import Home from '@/pages/Home'
import Explore from '@/pages/Explore'
import MarketDetail from '@/pages/MarketDetail'
import Portfolio from '@/pages/Portfolio'
import Legal from '@/pages/Legal'
import RoadmapPage from '@/pages/RoadmapPage'
import { ListingHub, RequestListing, SubmitProject } from '@/pages/Listing'
import AdminLayout from '@/pages/admin/AdminLayout'
import { ApprovedProjects, Applications, Verification } from '@/pages/admin/Projects'
import { LiveMarkets, MarketManagement, SettlementManagement } from '@/pages/admin/Markets'
import { AuditLogs, Disputes, Overview, Roles, SettingsPage, Users } from '@/pages/admin/Misc'
import { EmptyState, Spinner } from '@/components/ui'
import { Footer } from '@/components/Footer'
import { CursorFx } from '@/components/CursorFx'

// Circle's Bridge Kit is large: it is only downloaded when someone opens the bridge page.
const Bridge = lazy(() => import('@/pages/Bridge'))

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** A thin bar at the top of the window that fills as the page scrolls. */
function ScrollProgress() {
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.4 })
  if (reduce) return null
  return <motion.div aria-hidden="true" className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-[var(--accent)]" style={{ scaleX }} />
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
      <ScrollProgress />
      <CursorFx />
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
            <Route path="/roadmap" element={<RoadmapPage />} />
            <Route path="/bridge" element={<Suspense fallback={<div className="py-16 text-center"><Spinner label="Loading the bridge…" /></div>}><Bridge /></Suspense>} />
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
