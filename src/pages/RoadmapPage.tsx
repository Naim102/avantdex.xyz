import { Link } from 'react-router-dom'
import { PageTitle } from '@/components/ui'
import { RoadmapWithControls } from '@/components/Roadmap'

export default function RoadmapPage() {
  return (
    <div className="space-y-4">
      <PageTitle title="Roadmap" subtitle="What is done and what comes next, with a date for each step." />
      <p className="max-w-2xl text-xs font-medium text-[var(--muted)] sm:text-sm">
        Avantdex runs on <b>Arc Testnet</b> today. Target dates are plans and can move. The contract is <b>not audited</b>; mainnet follows the audit in step 03.{' '}
        <Link to="/legal/risk" className="underline">Risk disclosure</Link>
      </p>
      <RoadmapWithControls />
    </div>
  )
}
