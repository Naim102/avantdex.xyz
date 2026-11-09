import { useEffect, useRef } from 'react'
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'

/** Counts a figure up to its value the first time it scrolls into view. Shows the value at once for reduced motion. */
export function CountUp({ value, format = (n: number) => String(Math.round(n)), className = '' }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const reduce = useReducedMotion()
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => format(v))
  useEffect(() => {
    if (reduce) {
      mv.set(value)
      return
    }
    if (!inView) return
    const controls = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] })
    return () => controls.stop()
  }, [inView, value, reduce, mv])
  return (
    <span ref={ref} className={className}>
      <motion.span>{text}</motion.span>
    </span>
  )
}
