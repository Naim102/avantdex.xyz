import { Link } from 'react-router-dom'
import { Notice, PageTitle } from '@/components/ui'
import { RoadmapDiagram } from '@/components/Roadmap'

export default function RoadmapPage() {
  return (
    <div className="space-y-8">
      <PageTitle title="Avantdex roadmap" subtitle="From foundation to ecosystem expansion: what is done, and what comes next, with the date for each step." />
      <Notice tone="info">
        Avantdex runs on <b>Arc Testnet</b> today. Dates marked Target are plans, not promises, and can move. The contract is <b>not audited</b>: mainnet deployment follows the independent audit in step 03. See the{' '}
        <Link to="/legal/risk" className="underline">risk disclosure</Link>.
      </Notice>
      <RoadmapDiagram open />
    </div>
  )
}
