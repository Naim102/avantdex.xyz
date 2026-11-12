import { useEffect, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'

const INTERACTIVE = 'a[href], button, [role=button], [role=tab], [role=menuitemradio], summary, label, select, .hoverable'
const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]), textarea'

/**
 * Cursor feedback for mouse users: a dot that sticks to the pointer and a soft ring that trails it, grows over
 * anything clickable and shrinks while pressed. Primary buttons also lean toward the pointer a few pixels.
 * The real cursor stays visible. Off for touch screens and for people who prefer reduced motion.
 */
export function CursorFx() {
  const reduce = useReducedMotion()
  const [fine, setFine] = useState(false)
  const [state, setState] = useState<'idle' | 'link' | 'text' | 'hidden'>('hidden')
  const [pressed, setPressed] = useState(false)
  const x = useMotionValue(-100)
  const y = useMotionValue(-100)
  const rx = useSpring(x, { stiffness: 260, damping: 26, mass: 0.5 })
  const ry = useSpring(y, { stiffness: 260, damping: 26, mass: 0.5 })

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => setFine(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const active = fine && !reduce
  useEffect(() => {
    if (!active) return
    let leaning: HTMLElement | null = null
    const release = () => {
      if (leaning) leaning.style.translate = ''
      leaning = null
    }
    const move = (e: PointerEvent) => {
      x.set(e.clientX)
      y.set(e.clientY)
      const t = e.target instanceof Element ? e.target : null
      setState(!t ? 'idle' : t.closest(TEXT_FIELD) ? 'text' : t.closest(INTERACTIVE) ? 'link' : 'idle')
      const btn = t?.closest<HTMLElement>('.btn-primary:not(:disabled)') ?? null
      if (btn !== leaning) release()
      if (btn) {
        leaning = btn
        const r = btn.getBoundingClientRect()
        const dx = ((e.clientX - (r.left + r.width / 2)) / r.width) * 8
        const dy = ((e.clientY - (r.top + r.height / 2)) / r.height) * 6
        btn.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`
      }
    }
    const leave = () => {
      setState('hidden')
      release()
    }
    const down = () => setPressed(true)
    const up = () => setPressed(false)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      document.documentElement.removeEventListener('pointerleave', leave)
      release()
    }
  }, [active, x, y])

  if (!active) return null
  const size = state === 'link' ? 52 : state === 'text' ? 6 : 30
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70]">
      <motion.div
        className="absolute left-0 top-0 rounded-full border border-[var(--ink)]"
        style={{ x: rx, y: ry, translateX: '-50%', translateY: '-50%' }}
        animate={{
          width: size,
          height: size,
          opacity: state === 'hidden' ? 0 : state === 'text' ? 0 : 0.5,
          scale: pressed ? 0.8 : 1,
          backgroundColor: state === 'link' ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'rgba(0,0,0,0)',
        }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      />
      <motion.div
        className="absolute left-0 top-0 size-1.5 rounded-full bg-[var(--accent-text)]"
        style={{ x, y, translateX: '-50%', translateY: '-50%' }}
        animate={{ opacity: state === 'hidden' || state === 'text' ? 0 : 1, scale: state === 'link' ? 0 : 1 }}
        transition={{ duration: 0.15 }}
      />
    </div>
  )
}
