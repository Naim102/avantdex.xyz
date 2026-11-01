export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#14253b" stroke="rgba(255,255,255,0.14)" />
      <path d="M7 24C8.2 14 11.6 8 16 8s7.8 6 9 16" stroke="#acc6e9" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M11.5 20.5h9" stroke="#f9faf3" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="8" r="2" fill="#f9faf3" />
    </svg>
  )
}
