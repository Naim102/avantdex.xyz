/** The public roadmap. Text and dates are maintained here and rendered by components/Roadmap.tsx. */

export type RoadmapStatus = 'completed' | 'upcoming' | 'vision'

export interface RoadmapStep {
  n: string
  title: string
  status: RoadmapStatus
  /** "Completed" or "Target": the label printed before the date under the box. */
  dateLabel: string
  date: string
  points: string[]
  milestone: string
}

export const ROADMAP: RoadmapStep[] = [
  {
    n: '01',
    title: 'Core Platform Development & Testnet Validation',
    status: 'completed',
    dateLabel: 'Completed',
    date: 'November 15, 2026',
    points: [
      'Developed the core Avantdex pre-market trading platform.',
      'Implemented order-book trading and Buy/Sell functionality.',
      'Integrated wallet connectivity and USDC-based trading flows.',
      'Completed testnet deployment and end-to-end platform testing.',
      'Validated core user journeys and escrow interactions.',
    ],
    milestone: 'Functional testnet platform with successfully tested core trading flows.',
  },
  {
    n: '02',
    title: 'Core Smart Contract Implementation & Testing',
    status: 'completed',
    dateLabel: 'Completed',
    date: 'November 17, 2026',
    points: [
      'Implemented the core pre-market order-book and escrow contract functionality.',
      'Tested order placement, cancellation and matching workflows.',
      'Validated essential escrow interactions and settlement logic on testnet.',
      'Completed initial contract testing and documented test results.',
    ],
    milestone: 'Working testnet contracts with documented initial testing results.',
  },
  {
    n: '03',
    title: 'Security Hardening & Independent Audit',
    status: 'upcoming',
    dateLabel: 'Target',
    date: 'February 28, 2027',
    points: [
      'Perform comprehensive smart contract security testing.',
      'Conduct an independent security audit.',
      'Resolve critical and high-severity vulnerabilities.',
      'Strengthen access controls, escrow protections and settlement mechanisms.',
    ],
    milestone: 'Independent security review completed and critical/high-severity findings remediated.',
  },
  {
    n: '04',
    title: 'Arc Mainnet Deployment & USDC Settlement',
    status: 'upcoming',
    dateLabel: 'Target',
    date: 'March 31, 2027',
    points: [
      'Deploy Avantdex production smart contracts on Arc Mainnet.',
      'Integrate and validate native USDC trading and escrow settlement.',
      'Verify and publish deployed contract addresses.',
      'Complete end-to-end mainnet transaction and settlement validation.',
      'Enable production monitoring and emergency response mechanisms.',
    ],
    milestone: 'Publicly verifiable mainnet contracts and successful end-to-end USDC settlement.',
  },
  {
    n: '05',
    title: 'Controlled Beta & Ecosystem Onboarding',
    status: 'upcoming',
    dateLabel: 'Target',
    date: 'April 15, 2027',
    points: [
      'Launch a controlled beta with selected traders and token projects.',
      'Onboard initial project listings and early participants.',
      'Monitor trading execution, liquidity and settlement performance.',
      'Gather user feedback and improve the platform.',
    ],
    milestone: 'Initial project onboarding and successful controlled beta operations.',
  },
  {
    n: '06',
    title: 'Public Beta Launch & Community Growth',
    status: 'upcoming',
    dateLabel: 'Target',
    date: 'April 30, 2027',
    points: [
      'Open Avantdex to the wider community.',
      'Launch trader and project onboarding campaigns.',
      'Target 100 unique connected wallets.',
      'Target 10 project listings and 25 completed trades.',
      'Track platform usage, user retention and settlement performance.',
    ],
    milestone: 'Public beta launch with measurable early adoption.',
  },
  {
    n: '07',
    title: 'Ecosystem Expansion & Advanced Trading Infrastructure',
    status: 'vision',
    dateLabel: 'Target',
    date: 'September 30, 2027 and ongoing',
    points: [
      'Introduce advanced trading features, analytics and improved order-book tools.',
      'Explore cross-chain asset accessibility and broader liquidity opportunities.',
      'Build APIs and integration tools for project teams and ecosystem partners.',
      'Expand project discovery, verification and onboarding infrastructure.',
      'Explore institutional-grade trading tools and automated market insights.',
      'Continuously improve platform security, scalability and user experience.',
    ],
    milestone: 'An expanding pre-market trading ecosystem connecting projects, traders and liquidity across the Arc ecosystem.',
  },
]
