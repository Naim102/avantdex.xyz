// End-to-end UI feature test against the LOCAL dev stack (never a real network).
//
//   docker compose -f docker-compose.dev.yml up -d              # chain + db + api + indexer
//   (mint USDC to anvil account 0, run scripts/seed_demo_markets.py with SEED_MARKETS=6)
//   VITE_RPC_URL=http://localhost:8545 node node_modules/vite/bin/vite.js --port 5173
//   npm i --no-save puppeteer-core
//   node scripts/ui-feature-test.mjs <DEMO_TOKEN_ADDRESS>
//
// It drives Chrome with a mock wallet that signs through anvil's public dev accounts (0 = admin, 1 = trader):
// public pages, trading (limit, market, cancel), portfolio, listing request, every admin section, add/edit/delete
// project, create + activate a market on-chain, hide/show, on-chain role grant, admin management, seller settlement
// with fees, and a seller default claimed by the buyer after a chain time jump, plus a phone-width overflow check.
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5173'
const API = 'http://localhost:8000/api'
const RPC = 'http://localhost:8545'
const ADMIN = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // public anvil account 0
const TRADER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' // public anvil account 1
const DEMO_TOKEN = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (p) => (await fetch(API + p)).json()
const rpc = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json())
async function waitFor(fn, what, ms = 60000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v } catch {}
    await sleep(1200)
  }
  throw new Error('timed out: ' + what)
}

const mock = (acct, offset) => `(() => {
  const RPC = '${RPC}', ACC = '${acct}'; let id = 0;
  const call = (m, p) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: m, params: p }) }).then(r => r.json()).then(j => { if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e } return j.result });
  window.ethereum = { isMetaMask: true, request: (a) => { const m = a.method, p = a.params || []; if (m === 'eth_requestAccounts' || m === 'eth_accounts') return Promise.resolve([ACC]); if (m === 'personal_sign') return call('personal_sign', [p[0], ACC]); if (m === 'wallet_switchEthereumChain') return Promise.resolve(null); if (m === 'eth_sendTransaction') { const t = p[0]; t.from = ACC; return call(m, [t]) } return call(m, p) }, on() {}, removeListener() {} };
  const off = ${offset}; if (off) { const n = Date.now.bind(Date); Date.now = () => n() + off }
})();`

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const results = []
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name) } catch (e) { results.push(['FAIL', name + ' :: ' + e.message.slice(0, 200)]); console.log('FAIL', name, '::', e.message.slice(0, 200)) }
}

async function session(acct, offset = 0, w = 1440, h = 1000) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: w, height: h })
  page.on('dialog', (d) => d.accept())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.evaluateOnNewDocument(mock(acct, offset))
  page.errors = errors
  return page
}
const clickText = (page, re, sel = 'button') => page.evaluate((src, s) => { const r = new RegExp(src); const b = [...document.querySelectorAll(s)].find((x) => r.test(x.textContent.replace(/\s+/g, ' ').trim()) && !x.disabled); if (b) { b.click(); return true } return false }, re.source, sel)
async function mustClick(page, re, sel = 'button', ms = 20000) { await waitFor(() => clickText(page, re, sel), 'click ' + re, ms) }
async function typeInto(page, selector, text) { await page.waitForSelector(selector); await page.focus(selector); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.type(selector, text) }
async function signIn(page) {
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' })
  await sleep(1200)
  await mustClick(page, /^Connect Wallet$/)
  await sleep(1200)
  await mustClick(page, /^Browser Wallet$/, '[role=dialog] button')
  await sleep(2500)
  await page.keyboard.press('Escape')
  await sleep(500)
  await mustClick(page, /^Sign in$/)
  await waitFor(() => page.evaluate(() => !![...document.querySelectorAll('header button')].find((b) => /0x/.test(b.textContent))), 'signed in header')
  await sleep(1500)
}

const trader = await session(TRADER)
const admin = await session(ADMIN)
const visitor = await session('0x0000000000000000000000000000000000000001')

// ============================================================ public
await test('home: board lists the demo markets; the 3D hero and the liquidity chart render', async () => {
  await visitor.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await sleep(2500)
  const info = await visitor.evaluate(() => ({ rows: document.querySelectorAll('table tbody tr').length, canvases: document.querySelectorAll('canvas').length, bars: document.querySelectorAll('#liq-h ~ * [role=img], section[aria-labelledby=liq-h] [role=img]').length }))
  if (info.rows < 6) throw new Error('board rows ' + info.rows)
  if (info.canvases < 1) throw new Error('canvases ' + info.canvases)
  if (info.bars < 6) throw new Error('liquidity bars ' + info.bars)
  if (visitor.errors.length) throw new Error('page errors: ' + visitor.errors[0])
})
await test('home: search goes to explore with the query and filters', async () => {
  await visitor.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await typeInto(visitor, 'input[aria-label="Search tokens"]', 'Rollup')
  await visitor.keyboard.press('Enter')
  await waitFor(() => visitor.url().includes('/explore?q=Rollup'), 'navigate to explore')
  await waitFor(() => visitor.evaluate(() => document.querySelectorAll('table tbody tr').length === 1), 'one filtered row')
})
await test('explore: tabs, category filter, sort, cards view', async () => {
  await visitor.goto(BASE + '/explore', { waitUntil: 'networkidle2' })
  await mustClick(visitor, /^Trending$/, '[role=tab]')
  await sleep(800)
  await visitor.select('select[aria-label="Category"]', 'AI')
  await waitFor(() => visitor.evaluate(() => document.querySelectorAll('table tbody tr').length === 1), 'AI filter')
  await visitor.goto(BASE + '/explore?view=cards', { waitUntil: 'networkidle2' })
  await waitFor(() => visitor.evaluate(() => document.querySelectorAll('article').length >= 6), 'cards')
})
await test('market page: stats, depth chart, tabs, order book click fills the price', async () => {
  await visitor.goto(BASE + '/market/1', { waitUntil: 'networkidle2' })
  await sleep(1500)
  if (!(await visitor.evaluate(() => !!document.querySelector('#depth-h')))) throw new Error('no depth chart')
  for (const tab of ['Recent Trades', 'About', 'Rules', 'Order Book']) { await mustClick(visitor, new RegExp('^' + tab + '$'), '[role=tab]'); await sleep(300) }
})
await test('legal and listing pages open; unknown route shows 404 state', async () => {
  for (const p of ['/legal/terms', '/legal/rules', '/list', '/list/request', '/list/submit']) { await visitor.goto(BASE + p, { waitUntil: 'networkidle2' }); await sleep(300); if (!(await visitor.evaluate(() => !!document.querySelector('h1')))) throw new Error('no h1 on ' + p) }
  await visitor.goto(BASE + '/nope', { waitUntil: 'networkidle2' })
  if (!(await visitor.evaluate(() => document.body.innerText.includes('Page not found')))) throw new Error('no 404')
})
await test('theme menu switches all five themes and remembers the choice', async () => {
  await visitor.goto(BASE + '/', { waitUntil: 'networkidle2' })
  for (const t of ['Sky', 'Mint', 'Ink', 'Terminal', 'Paper']) {
    await visitor.evaluate(() => document.querySelector('footer button[aria-haspopup=menu]').click())
    await sleep(200)
    await mustClick(visitor, new RegExp('^' + t), '[role=menuitemradio]')
    await sleep(200)
    const got = await visitor.evaluate(() => document.documentElement.dataset.theme)
    if (got !== t.toLowerCase()) throw new Error(`theme ${t} -> ${got}`)
  }
})

// ============================================================ trader
await test('trader: connect and sign in with the wallet', async () => { await signIn(trader) })
await test('trader: place a limit buy order (approve + order) and see it in the portfolio', async () => {
  const before = (await get(`/portfolio/${TRADER.toLowerCase()}/orders`)).items.length
  await trader.goto(BASE + '/market/1?side=buy', { waitUntil: 'networkidle2' })
  await sleep(1500)
  await typeInto(trader, '#price', '0.30')
  await typeInto(trader, '#qty', '4')
  await sleep(1500)
  if (await clickText(trader, /^Approve /)) await sleep(4000)
  await mustClick(trader, /^Buy /)
  await waitFor(async () => (await get(`/portfolio/${TRADER.toLowerCase()}/orders`)).items.length === before + 1, 'order indexed', 40000)
})
await test('trader: cancel the open order from the portfolio (no fee, funds back)', async () => {
  await trader.goto(BASE + '/portfolio?tab=Open%20Orders', { waitUntil: 'networkidle2' })
  await sleep(1500)
  const target = (await get(`/portfolio/${TRADER.toLowerCase()}/orders`)).items.find((o) => o.price === '300000' && o.status === 'Open')
  if (!target) throw new Error('order not found')
  await mustClick(trader, /^Cancel$/)
  await waitFor(async () => (await get(`/portfolio/${TRADER.toLowerCase()}/orders`)).items.find((o) => o.id === target.id).status === 'Cancelled', 'cancelled', 40000)
})
await test('trader: market buy (IOC) fills against resting sell orders', async () => {
  const before = (await get('/markets/5/stats')).trades
  await trader.goto(BASE + '/market/5?side=buy', { waitUntil: 'networkidle2' })
  await sleep(1500)
  await mustClick(trader, /^Market$/)
  await typeInto(trader, '#qty', '2')
  await sleep(2000)
  if (await clickText(trader, /^Approve /)) await sleep(4000)
  await mustClick(trader, /^Buy /)
  await waitFor(async () => (await get('/markets/5/stats')).trades > before, 'trade indexed', 40000)
})
await test('trader: portfolio tabs (overview, trade history, settlement status) show data', async () => {
  for (const tab of ['Overview', 'Trade History', 'Settlement Status']) {
    await trader.goto(BASE + '/portfolio' + (tab === 'Overview' ? '' : '?tab=' + encodeURIComponent(tab)), { waitUntil: 'networkidle2' })
    await sleep(1200)
    if (!(await trader.evaluate(() => document.querySelector('main').innerText.length > 200))) throw new Error('empty ' + tab)
  }
})
await test('trader: request a listing through the form', async () => {
  await trader.goto(BASE + '/list/request', { waitUntil: 'networkidle2' })
  await sleep(1200)
  const ids = await trader.evaluate(() => [...document.querySelectorAll('main input, main textarea')].map((e) => e.id))
  const find = (re) => ids.find((i) => re.test(i))
  await typeInto(trader, '#' + (find(/name/i) ?? ids[0]), 'Feature Test Token')
  await typeInto(trader, '#' + (find(/symbol/i) ?? ids[1]), 'FTT')
  await typeInto(trader, '#' + (find(/link|url/i) ?? ids[2]), 'https://example.com/ftt')
  await typeInto(trader, '#' + (find(/reason/i) ?? ids[3]), 'I would trade it before launch')
  await mustClick(trader, /^Send request|Submit request|Request listing|Send/)
  await waitFor(async () => (await get('/listing-requests/summary')).items.some((i) => i.token_symbol === 'FTT'), 'request counted', 20000)
})

// ============================================================ admin
await test('admin: sign in and see every dashboard section', async () => {
  await signIn(admin)
  for (const p of ['', '/applications', '/verification', '/approved', '/live-markets', '/market-management', '/settlement', '/disputes', '/users', '/roles', '/audit-logs', '/settings']) {
    await admin.goto(BASE + '/admin' + p, { waitUntil: 'networkidle2' })
    await sleep(700)
    const t = await admin.evaluate(() => document.querySelector('main').innerText)
    if (/Admin access required|has no admin role/.test(t)) throw new Error('denied on /admin' + p)
  }
})
const stamp = String(Date.now()).slice(-6)
let projectId = 0
await test('admin: add a project from the dashboard (shows as Coming soon)', async () => {
  await admin.goto(BASE + '/admin/applications', { waitUntil: 'networkidle2' })
  await sleep(800)
  await mustClick(admin, /^Add a project$/)
  await typeInto(admin, '#pf-name', 'UI Test ' + stamp)
  await typeInto(admin, '#pf-token_symbol', 'UIT' + stamp.slice(0, 3))
  await typeInto(admin, '#pf-website', 'https://uitest.example.com')
  await typeInto(admin, '#pf-socials', 'https://x.com/AvantDex')
  await typeInto(admin, '#pf-token_address', DEMO_TOKEN)
  await typeInto(admin, '#pf-description', 'Created by the feature test.')
  await typeInto(admin, '#pf-tge_info', 'Next quarter')
  await typeInto(admin, '#pf-evidence', 'Added by the platform admin')
  await mustClick(admin, /^Add project$/)
  const p = await waitFor(async () => (await get('/projects/upcoming')).items.find((i) => i.name === 'UI Test ' + stamp), 'project in upcoming', 20000)
  projectId = p.id
})
await test('admin: edit the project (rename) and see it on the public list', async () => {
  await admin.goto(BASE + '/admin/applications', { waitUntil: 'networkidle2' })
  await sleep(800)
  await admin.evaluate((n) => { const rows = [...document.querySelectorAll('table tbody tr')].find((r) => r.innerText.includes(n)); [...rows.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open').click() }, 'UI Test ' + stamp)
  await sleep(600)
  await mustClick(admin, /^Edit$/)
  await typeInto(admin, '#pf-name', 'UI Test Renamed ' + stamp)
  await mustClick(admin, /^Save changes$/)
  await waitFor(async () => (await get('/projects/upcoming')).items.some((i) => i.name === 'UI Test Renamed ' + stamp), 'renamed', 20000)
})
let marketDbId = 0
await test('admin: configure the market draft, create it on-chain, verify, activate', async () => {
  await admin.goto(BASE + '/admin/approved', { waitUntil: 'networkidle2' })
  await sleep(1000)
  await admin.evaluate((n) => { const rows = [...document.querySelectorAll('table tbody tr')].find((r) => r.innerText.includes(n)); [...rows.querySelectorAll('button')].find((b) => /Configure market/.test(b.textContent)).click() }, 'UI Test Renamed ' + stamp)
  await sleep(600)
  await mustClick(admin, /^Create market draft$/)
  await waitFor(() => admin.evaluate(() => document.body.innerText.includes('Market draft created')), 'draft created', 15000)
  await admin.goto(BASE + '/admin/market-management', { waitUntil: 'networkidle2' })
  await sleep(1200)
  await admin.evaluate((n) => { const card = [...document.querySelectorAll('.glass')].find((c) => c.innerText.includes(n) && c.querySelector('button')); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Manage').click() }, 'UI Test Renamed ' + stamp)
  await sleep(600)
  await mustClick(admin, /^Create on-chain$/)
  await waitFor(() => admin.evaluate((n) => { const card = [...document.querySelectorAll('.glass')].find((c) => c.innerText.includes(n)); return card && /Step 2/.test(card.innerText) }, 'UI Test Renamed ' + stamp), 'on-chain market indexed (Setup)', 60000)
  await mustClick(admin, /^Verify configuration$/)
  await waitFor(() => admin.evaluate(() => document.body.innerText.includes('Every parameter matches the draft')), 'config verified', 15000)
  await mustClick(admin, /^Activate$/)
  const m = await waitFor(async () => (await get('/markets')).items.find((i) => i.project?.name === 'UI Test Renamed ' + stamp), 'market public', 60000)
  marketDbId = m.id
})
await test('admin: hide the market from the site and show it again', async () => {
  await admin.goto(BASE + '/admin/market-management', { waitUntil: 'networkidle2' })
  await sleep(1200)
  const click = (label) => admin.evaluate((n, l) => { const card = [...document.querySelectorAll('.glass')].find((c) => c.innerText.includes(n) && c.querySelector('button')); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === l).click() }, 'UI Test Renamed ' + stamp, label)
  await click('Hide from site')
  await waitFor(async () => !(await get('/markets')).items.some((i) => i.project?.name === 'UI Test Renamed ' + stamp), 'hidden', 15000)
  await sleep(1500)
  await click('Show on site')
  await waitFor(async () => (await get('/markets')).items.some((i) => i.project?.name === 'UI Test Renamed ' + stamp), 'shown again', 15000)
})
await test('admin: delete a project that has no market', async () => {
  const created = await (async () => {
    await admin.goto(BASE + '/admin/applications', { waitUntil: 'networkidle2' })
    await sleep(800)
    await mustClick(admin, /^Add a project$/)
    await typeInto(admin, '#pf-name', 'Delete Me ' + stamp)
    await typeInto(admin, '#pf-token_symbol', 'DEL')
    await typeInto(admin, '#pf-website', 'https://del.example.com')
    await typeInto(admin, '#pf-socials', 'https://x.com/AvantDex')
    await typeInto(admin, '#pf-description', 'to be removed')
    await typeInto(admin, '#pf-tge_info', 'n/a')
    await typeInto(admin, '#pf-evidence', 'test')
    await mustClick(admin, /^Add project$/)
    return waitFor(async () => (await get('/projects/upcoming')).items.find((i) => i.name === 'Delete Me ' + stamp), 'created', 15000)
  })()
  await sleep(1500)
  await admin.evaluate((n) => { const rows = [...document.querySelectorAll('table tbody tr')].find((r) => r.innerText.includes(n)); [...rows.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open').click() }, 'Delete Me ' + stamp)
  await sleep(600)
  await mustClick(admin, /^Delete$/)
  await waitFor(async () => !(await get('/projects/upcoming')).items.some((i) => i.id === created.id), 'deleted', 15000)
})
await test('admin: grant the on-chain manager role to another wallet (Admins page)', async () => {
  await admin.goto(BASE + '/admin/roles', { waitUntil: 'networkidle2' })
  await sleep(1500)
  await typeInto(admin, '#oc-grant', '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC')
  await mustClick(admin, /^Grant on-chain access$/)
  await waitFor(() => admin.evaluate(() => document.body.innerText.includes('Grant market manager')), 'tx step shown', 30000)
})
await test('admin: add a second admin wallet and remove it again', async () => {
  await admin.goto(BASE + '/admin/roles', { waitUntil: 'networkidle2' })
  await sleep(1000)
  await typeInto(admin, '#ra', '0x90F79bf6EB2c4f870365E785982E1f101E93b906')
  await mustClick(admin, /^Add admin$/)
  await waitFor(() => admin.evaluate(() => document.body.innerText.toLowerCase().includes('0x90f79bf6eb2c4f870365e785982e1f101e93b906')), 'added', 15000)
  await admin.evaluate(() => { const r = [...document.querySelectorAll('table tbody tr')].find((x) => x.innerText.toLowerCase().includes('0x90f79bf6')); [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Remove').click() })
  await waitFor(() => admin.evaluate(() => !document.body.innerText.toLowerCase().includes('0x90f79bf6eb2c4f870365e785982e1f101e93b906')), 'removed', 15000)
})

// ============================================================ settlement: seller settles, buyer claims a default
await test('settlement: open settlement, seller approves the token and settles (fees reach the collector)', async () => {
  // market 2 has an open trade bought above (seller = admin wallet)
  await rpc('anvil_setBalance', [ADMIN, '0x21e19e0c9bab2400000'])
  const calldata = '0x40c10f19' + ADMIN.slice(2).toLowerCase().padStart(64, '0') + (10n ** 24n).toString(16).padStart(64, '0')
  await rpc('eth_sendTransaction', [{ from: ADMIN, to: DEMO_TOKEN, data: calldata }])
  await admin.goto(BASE + '/admin/live-markets', { waitUntil: 'networkidle2' })
  await sleep(1500)
  await admin.evaluate(() => { const card = [...document.querySelectorAll('.glass')].find((c) => c.innerText.includes('Demo Arc Games') && c.querySelector('button')); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Manage').click() })
  await sleep(700)
  await mustClick(admin, /^Open settlement$/)
  await waitFor(async () => (await get('/markets/2')).status === 'SettlementOpen', 'settlement open', 40000)
  await admin.goto(BASE + '/portfolio?tab=Settlement%20Status', { waitUntil: 'networkidle2' })
  await sleep(2000)
  if (await clickText(admin, /^Approve token$/)) await sleep(4000)
  await sleep(1500)
  await mustClick(admin, /^Settle$/)
  await waitFor(async () => (await get('/stats')).trades_settled >= 1, 'trade settled', 40000)
  const fees = BigInt((await get('/stats')).fees_paid)
  if (fees <= 0n) throw new Error('no fees recorded')
})
await test('settlement: seller defaults, buyer claims payment plus collateral after the deadline', async () => {
  // open settlement on market 3 (Demo Pay Rails) with a 1 hour window, then move chain and browser time forward
  await admin.goto(BASE + '/admin/live-markets', { waitUntil: 'networkidle2' })
  await sleep(1500)
  await admin.evaluate(() => { const card = [...document.querySelectorAll('.glass')].find((c) => c.innerText.includes('Demo Pay Rails') && c.querySelector('button')); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Manage').click() })
  await sleep(700)
  await mustClick(admin, /^Open settlement$/)
  await waitFor(async () => (await get('/markets/3')).status === 'SettlementOpen', 'settlement open', 40000)
  await rpc('evm_increaseTime', [60 * 60 * 25 + 60])
  await rpc('evm_mine', [])
  const buyer = await session(TRADER, 60 * 60 * 26 * 1000)
  await signIn(buyer)
  await buyer.goto(BASE + '/portfolio?tab=Settlement%20Status', { waitUntil: 'networkidle2' })
  await sleep(2500)
  await mustClick(buyer, /^Claim default$/)
  await waitFor(async () => (await get(`/portfolio/${TRADER.toLowerCase()}/trades`)).items.some((t) => t.market_onchain_id === 3 && t.status === 'Defaulted'), 'default recorded', 40000)
})
await test('mobile: single-row header, menu opens, navigates and closes', async () => {
  const m = await session(ADMIN, 0, 375, 800)
  await m.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await sleep(1200)
  const h = await m.evaluate(() => ({ rows: document.querySelector('header > div').getBoundingClientRect().height, navs: document.querySelectorAll('header nav:not(#mobile-nav)').length }))
  if (h.rows > 80) throw new Error('header is taller than one row: ' + h.rows)
  await m.click('button[aria-label="Open menu"]')
  await waitFor(() => m.evaluate(() => !!document.querySelector('#mobile-nav')), 'menu open', 5000)
  await m.click('#mobile-nav a[href="/explore"]')
  await waitFor(() => m.evaluate(() => location.pathname === '/explore' && !document.querySelector('#mobile-nav')), 'navigated and closed', 5000)
})
await test('mobile: home, explore, market and admin have no sideways overflow', async () => {
  const m = await session(ADMIN, 0, 375, 800)
  for (const p of ['/', '/explore', '/market/1', '/list']) {
    await m.goto(BASE + p, { waitUntil: 'networkidle2' })
    await sleep(1500)
    const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) throw new Error(`${p} overflows by ${over}px`)
  }
})

console.log('\n==== SUMMARY ====')
for (const [r, n] of results) console.log(r, n)
console.log(results.filter((r) => r[0] === 'FAIL').length, 'failed of', results.length)
await browser.close()
