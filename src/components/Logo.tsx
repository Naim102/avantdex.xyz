/** Avantdex brand mark (public/logo.png): black party-hat pyramid on brand green. */
export function Logo({ className = 'size-9' }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={`${className} shrink-0 rounded-[0.55rem] border-2 border-[var(--line)] object-cover`} width={36} height={36} />
}
