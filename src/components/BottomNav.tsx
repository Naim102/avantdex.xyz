import { NavLink } from 'react-router-dom'
import { ArrowLeftRight, Compass, CirclePlus, House, Wallet, type LucideIcon } from 'lucide-react'

const TABS: { to: string; label: string; Icon: LucideIcon; end: boolean }[] = [
  { to: '/', label: 'Home', Icon: House, end: true },
  { to: '/explore', label: 'Explore', Icon: Compass, end: false },
  { to: '/portfolio', label: 'Portfolio', Icon: Wallet, end: false },
  { to: '/bridge', label: 'Bridge', Icon: ArrowLeftRight, end: false },
  { to: '/list', label: 'List', Icon: CirclePlus, end: false },
]

/**
 * Phones: the five main places in a bar fixed to the bottom of the screen, within thumb reach. Replaces the menu
 * button of the header. Hidden from the large breakpoint, where the header has the links.
 */
export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {TABS.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={end} className="group flex flex-col items-center gap-0.5 px-1 pb-1.5 pt-1.5 text-[10px] font-semibold leading-none">
              {({ isActive }) => (
                <>
                  <span
                    className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${isActive ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--muted)] group-active:bg-[var(--tint-2)]'}`}
                  >
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <span className={isActive ? 'text-[var(--ink)]' : 'text-[var(--muted)]'}>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
