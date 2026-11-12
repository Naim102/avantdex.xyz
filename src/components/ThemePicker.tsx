import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { THEMES, useTheme } from '@/hooks/useTheme'

export function ThemePicker({ up = false }: { up?: boolean }) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="btn btn-ghost !min-h-11 !gap-2 !px-3" aria-label={`Theme: ${current.name}. Change theme`}>
        <span className="size-4 rounded-sm border border-[var(--line)]" style={{ background: `linear-gradient(135deg, ${current.swatch[0]} 50%, ${current.swatch[1]} 50%)` }} aria-hidden="true" />
        <span className="text-sm">Theme: {current.name}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Themes" className={`glass lift absolute z-40 w-60 p-1.5 ${up ? 'bottom-full right-0 mb-3 sm:left-0 sm:right-auto' : 'right-0 mt-3'}`}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === theme}
              onClick={() => {
                setTheme(t.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--tint-2)] ${t.id === theme ? 'bg-[var(--tint-2)]' : ''}`}
            >
              <span className="size-7 shrink-0 rounded-sm border border-[var(--line)]" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-bold">{t.name}</span>
                <span className="block text-xs text-[var(--muted)]">{t.note}</span>
              </span>
              {t.id === theme && <Check className="ml-auto size-4 shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
