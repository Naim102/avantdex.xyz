Avantdex — R\&D and PRD Documentation Generation



Act as a Senior Product Manager, Blockchain Architect, Web3 Researcher, Smart Contract Engineer, and Technical Product Analyst.



Your task is to thoroughly analyze all the existing Avantdex project requirements, decisions, product concepts, architecture discussions, and UI/UX specifications established so far.



Based on those final requirements, create two professional, comprehensive, production-oriented Markdown documents:



R\&D.md — Research \& Development Document



PRD.md — Product Requirements Document



Both documents must be written in clear, professional English and must be detailed enough for developers, designers, blockchain engineers, security researchers, and project stakeholders to understand and implement Avantdex.



Do not create generic documentation. Everything must be specifically designed around Avantdex.



1\. Project Overview



Project Name: Avantdex



Product Category: Pre-Market Trading Marketplace



Blockchain: Arc Network



Primary Settlement Asset: USDC (final token contract, address and decimals must be verified before implementation).



Core Concept:



Avantdex is a pre-market trading marketplace where users can discover upcoming token markets, create buy and sell orders, trade through an order-book system, manage their portfolios, and complete settlement according to predefined market rules.



The product should provide a professional, simple, intuitive and premium trading experience.



The homepage must remain visually minimal. Advanced functionality should be available inside dedicated pages, tabs, modals, dropdowns and dashboards rather than overcrowding the homepage.



2\. Core Product Requirements



A. Trading System



Avantdex must use a full order-book trading model.



Required functionality:



Buy orders



Sell orders



Limit orders



Market orders, only if safe execution protections are implemented



Order matching



Partial order fills



Order cancellation



Order expiry



Open orders



Filled orders



Partially filled orders



Trade history



Order book



Market depth



Recent trades



Best bid and best ask



Trading volume



Market-specific trading limits



Define the matching algorithm, execution priority, order validation, price protection, slippage controls and transaction lifecycle.



Do not assume that a submitted order is automatically executed.



B. Project Listing System



Avantdex must use a hybrid project listing model.



There are two separate listing pathways:



Submit Your Project



For project owners and authorised team representatives.



Required information may include:



Project name



Token name and symbol



Project logo



Project description



Official website



Official social links



Blockchain



Token contract address



Token supply information



Allocation information



TGE information



Project documentation



Ownership or authorisation evidence



Team wallet verification



Request a Listing



For ordinary users who want to suggest a project.



Required information:



Project name



Token symbol



Official website or social link



Reason for requesting the listing



A community request must never automatically create a live market.



Admin review and approval are required.



C. Project Application Status



Define and document the following statuses:



Draft



Submitted



Under Review



Verification



Changes Requested



Approved



Rejected



Market Setup



Live



Suspended



Delisted



Completed



Clearly distinguish project approval, project verification and market activation.



D. Admin Dashboard



Design a separate restricted-access administration dashboard.



Required modules:



Overview



Applications



Verification



Approved Projects



Live Markets



Market Management



Settlement Management



Disputes



Users



Admin Roles



Audit Logs



Settings



Define admin permissions and responsibilities.



Suggested roles:



Super Admin



Project Reviewer



Verification Admin



Market Manager



Settlement Manager



Support Admin



Include multisig administration, role-based access control, two-person approval for sensitive operations and audit logging.



Admin access must not provide arbitrary control over users' escrowed funds.



E. Market Activation



Project approval must not automatically activate a market.



Define a separate market configuration and activation process containing:



Market ID



Project ID



Token information



Token contract address



Avantdex market contract address



Trading pair



Network



Minimum order size



Maximum order size



Tick size



Quantity precision



Trading fees



Trading start time



Expiry rules



TGE date



Settlement conditions



Include contract deployment, testing, configuration verification and final admin activation.



F. Verification System



Define separate verification badges:



Verified Project



Contract Verified



Allocation Verified



Explain exactly what each badge means and what it does not guarantee.



A verification badge must not imply investment safety, profitability or guaranteed token delivery.



G. Portfolio System



Design a complete portfolio dashboard.



Include:



Portfolio Overview



Open Orders



My Buy Orders



My Sell Orders



Partially Filled



Filled



Cancelled



Expired



Trade History



Settlement Status



Completed Transactions



Define how users can inspect their order details, transaction hashes and settlement status.



H. Escrow and Settlement



Research and design a secure settlement architecture.



Consider:



Buyer payment locking



Seller allocation or token delivery



Escrow management



Settlement opening conditions



TGE verification



Delivery confirmation



Payment release



Refund handling



Delayed TGE



Failed delivery



Dispute handling



Market suspension



Prefer atomic settlement where technically feasible.



All fund movement must follow transparent, predefined smart-contract rules.



Admin actions must not arbitrarily transfer escrowed assets.



Clearly distinguish between on-chain enforcement and off-chain administrative processes.



3\. Homepage and User Interface Requirements



The existing homepage design must remain minimal and premium.



The current homepage contains:



Avantdex logo



Arc Network badge



Search Tokens



Wallet connection



Explore card



Portfolio card



Marketplace section



Available Markets



Explore All



Market cards



Buy and Sell buttons



Create Listing section



Important distinction:



Create Listing is NOT Create Order.



Create Listing must offer two options:



Submit Your Project



Request a Listing



Buy and Sell buttons on market cards and token detail pages are responsible for initiating trading orders.



Do not introduce a separate Create Order CTA on the homepage.



Preserve the existing visual hierarchy and avoid unnecessary homepage sections.



Create detailed UI/UX requirements for:



Homepage



Explore Markets



Market Details



Order Book



Buy/Sell order interface



Portfolio



Wallet connection



Submit Your Project



Request a Listing



Admin Dashboard



Settlement interface



4\. Explore Markets



Define a complete market discovery experience.



Include:



All Markets



Trending



New Listings



Upcoming TGE



Closing Soon



Settled



Search



Category filters



Market status filters



Sorting



Market cards may display:



Project logo



Project name



Token symbol



Pre-market price



Best bid



Best ask



24-hour volume



Open interest



TGE date



Market status



Verification badges



Do not display fabricated market data.



5\. R\&D Document Requirements



Create R\&D.md as a serious technical research document.



It must include:



Executive Summary



Project Background



Product Vision



Problem Statement



Market Research



Competitor Analysis



Pre-Market Trading Models



Order Book Architecture Research



Centralized vs Decentralized vs Hybrid Order Book Comparison



Recommended Architecture



Arc Network Technical Research



USDC Integration Considerations



Smart Contract Architecture



Escrow Architecture



Matching Engine Research



Partial Fill Implementation



Order Cancellation and Expiry



Settlement Architecture



Token Delivery Verification



TGE Delay and Failed Delivery Handling



Admin and Governance Architecture



Security Threat Model



Smart Contract Security Requirements



Indexer and Backend Architecture



Database Design Considerations



Frontend Architecture



Wallet Integration



Scalability and Performance



Legal and Regulatory Research Considerations



Development Risks



Technical Challenges



Recommended Technology Stack



Development Roadmap



Testing and Audit Strategy



Open Research Questions



Final Technical Recommendations



Research and compare relevant pre-market platforms such as Whales Market and other directly relevant projects.



Do not blindly copy competitor functionality.



For every major technical decision, explain:



Available options



Advantages



Disadvantages



Risks



Recommended approach



Reason for the recommendation



Where current technical facts are required, research official Arc documentation and other primary technical sources.



Cite sources with their URLs and access dates.



Clearly label unverified assumptions and questions requiring further research.



Do not invent Arc APIs, contract addresses, network configurations, integrations or technical capabilities.



6\. PRD Document Requirements



Create PRD.md as a detailed implementation-ready Product Requirements Document.



It must include:



Document Information



Product Overview



Product Vision



Objectives



Target Users



User Personas



User Stories



User Journey



Functional Requirements



Non-Functional Requirements



Homepage Requirements



Explore Markets Requirements



Market Details Requirements



Trading and Order Management Requirements



Order Book Requirements



Portfolio Requirements



Wallet Requirements



Project Submission Requirements



Community Listing Request Requirements



Project Verification Requirements



Admin Dashboard Requirements



Market Activation Requirements



Escrow Requirements



Settlement Requirements



Dispute Handling Requirements



Notification Requirements



Search and Filtering Requirements



Database and Data Model Requirements



API Requirements



Smart Contract Requirements



Security Requirements



Analytics and Monitoring



Error Handling



Empty States and Loading States



Acceptance Criteria



MVP Scope



Future Development Scope



Dependencies



Risks and Constraints



Open Questions



Release and Deployment Plan



For every major feature, define:



Feature description



User role



User story



Functional requirements



Expected behaviour



Validation rules



Error states



Security considerations



Acceptance criteria



Dependencies



Use unique requirement IDs, for example:



AUTH-001



MARKET-001



ORDER-001



PORT-001



LIST-001



ADMIN-001



SETTLE-001



SECURITY-001



Acceptance criteria should be testable, specific and unambiguous.



Use MoSCoW prioritisation:



Must Have



Should Have



Could Have



Won't Have in MVP



Separate MVP requirements from future enhancements.



7\. Technical Architecture



Research and propose a suitable architecture.



Evaluate a hybrid model where:



Smart contracts enforce escrow, order validity, execution and settlement rules.



An off-chain order book/indexer supports fast market discovery and order-book presentation.



The backend handles indexing, API services, market metadata and notifications.



The frontend provides the trading interface.



Wallets authorise user transactions.



Clearly explain which operations happen on-chain and which happen off-chain.



Never present an off-chain order as an on-chain guaranteed order.



Include architecture diagrams using Mermaid where helpful.



Provide a high-level data flow from order creation to matching, escrow, settlement and portfolio updates.



Recommend technologies only after considering Arc compatibility and actual project requirements.



Do not lock the implementation into an unverified technology or API.



8\. Legal, Risk and Compliance Considerations



Document the requirements for:



Terms \& Conditions



Privacy Policy



Risk Disclosure



Cookie Policy



Listing Policy



Trading \& Settlement Rules



Restricted Jurisdictions



User Eligibility



Data Protection



Dispute Handling



Do not invent a legal entity, registered address, jurisdiction, restricted-country list, regulatory approval or compliance certification.



Mark matters requiring qualified legal review.



Do not assume that a non-custodial design automatically removes regulatory obligations.



9\. Critical Development Principles



Follow these rules throughout both documents:



Do not change the established Avantdex product vision.



Do not confuse Create Listing with Create Order.



Do not add unnecessary features just to make the product appear complex.



Keep the homepage simple.



Make advanced features accessible through dedicated interfaces.



Prioritise security and transparent settlement.



Never invent technical facts.



Clearly distinguish confirmed requirements from assumptions.



Avoid vague requirements such as “the system should be secure” without explaining measurable implementation expectations.



Design for future scalability without overengineering the MVP.



Never claim a smart contract is audited unless an audit has actually been completed.



Do not assume a feature is implemented merely because it is described in this document.



Ensure that R\&D recommendations and PRD requirements remain consistent.



10\. Output Requirements



Create exactly these two primary files:



R\&D.md



PRD.md



Both files must:



Use professional Markdown formatting.



Have a clickable table of contents.



Use clear heading hierarchy.



Include tables where appropriate.



Include Mermaid diagrams where helpful.



Include requirement IDs in PRD.



Include citations and research links in R\&D.



Clearly mark assumptions, pending decisions and legal-review items.



Avoid duplicated or contradictory information.



Be comprehensive and implementation-oriented.



If the existing project repository or documentation is available, inspect it first. Reuse confirmed project details and identify inconsistencies rather than silently changing established decisions.



Do not modify the existing homepage or application code while generating these documents.



Do not create fake implementation claims, fake test results or fake audit reports.



Finally, provide a concise summary of:



What was documented.



Important assumptions.



Decisions that still require my confirmation.



Recommended next development steps.



The final goal is to produce two high-quality documents that can serve as the primary product and technical references for building Avantdex.

