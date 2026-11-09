import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MotionValue } from 'framer-motion'
import type * as THREE_NS from 'three'

export type ThreeLib = typeof THREE_NS

export interface SceneApi {
  scene: THREE_NS.Scene
  camera: THREE_NS.PerspectiveCamera
  /** progress is 0..1 (scroll), pointer is -1..1 relative to the canvas */
  update: (progress: number, pointer: { x: number; y: number }) => void
  /** rebuild colors after a theme change */
  recolor: () => void
  dispose: () => void
}

export type SceneBuilder = (THREE: ThreeLib, container: HTMLElement) => SceneApi

/** Reads a theme color (a CSS variable holding a hex value) for use in three.js materials. */
export function themeColor(name: string, fallback = '#262627'): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v && !v.startsWith('rgba') ? v : fallback
}

/**
 * Hosts a three.js scene. Rendering is on demand (a frame is drawn when scroll, pointer, size or theme changes),
 * so an idle page costs nothing. Three.js is loaded on first use, in its own chunk.
 * Without WebGL, or when the user prefers reduced motion, the scene is drawn once in a static pose.
 */
export function ThreeCanvas({
  build,
  progress,
  label,
  className = '',
  fallback,
  reducedMotion = false,
}: {
  build: SceneBuilder
  progress?: MotionValue<number>
  label: string
  className?: string
  fallback?: ReactNode
  reducedMotion?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let cleanup = () => {}

    void import('three')
      .then((THREE) => {
        if (disposed) return
        let renderer: THREE_NS.WebGLRenderer
        try {
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
        } catch {
          setFailed(true)
          return
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.domElement.setAttribute('aria-hidden', 'true')
        renderer.domElement.style.display = 'block'
        el.appendChild(renderer.domElement)
        const api = build(THREE, el)
        const pointer = { x: 0, y: 0 }
        let raf = 0
        const draw = () => {
          raf = 0
          if (disposed) return
          api.update(reducedMotion ? 0.12 : progress?.get() ?? 0.12, reducedMotion ? { x: 0, y: 0 } : pointer)
          renderer.render(api.scene, api.camera)
        }
        const schedule = () => {
          if (!raf) raf = requestAnimationFrame(draw)
        }
        const resize = () => {
          const w = el.clientWidth || 1
          const h = el.clientHeight || 1
          renderer.setSize(w, h, false)
          renderer.domElement.style.width = '100%'
          renderer.domElement.style.height = '100%'
          api.camera.aspect = w / h
          api.camera.updateProjectionMatrix()
          schedule()
        }
        const onMove = (e: PointerEvent) => {
          const r = el.getBoundingClientRect()
          pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
          pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1
          schedule()
        }
        const ro = new ResizeObserver(resize)
        ro.observe(el)
        el.addEventListener('pointermove', onMove)
        const unsub = progress?.on('change', schedule)
        const mo = new MutationObserver(() => {
          api.recolor()
          schedule()
        })
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
        resize()
        cleanup = () => {
          if (raf) cancelAnimationFrame(raf)
          ro.disconnect()
          mo.disconnect()
          unsub?.()
          el.removeEventListener('pointermove', onMove)
          api.dispose()
          renderer.dispose()
          renderer.domElement.remove()
        }
        if (disposed) cleanup()
      })
      .catch(() => setFailed(true))

    return () => {
      disposed = true
      cleanup()
    }
  }, [build, progress, reducedMotion])

  return (
    <div ref={host} className={className} role="img" aria-label={label}>
      {failed && fallback}
    </div>
  )
}
