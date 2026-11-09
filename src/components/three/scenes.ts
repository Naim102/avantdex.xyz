import type * as THREE_NS from 'three'
import { themeColor, type SceneApi, type SceneBuilder, type ThreeLib } from '@/components/three/ThreeCanvas'

function disposeGroup(group: THREE_NS.Group) {
  group.traverse((o) => {
    const m = o as THREE_NS.Mesh
    m.geometry?.dispose()
    const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else if (mat) {
      ;(mat as THREE_NS.SpriteMaterial).map?.dispose()
      mat.dispose()
    }
  })
  group.clear()
}

/**
 * The Avantdex mark in 3D: a striped pyramid. As the page scrolls the stack turns and the slabs pull apart,
 * so the shape reads as layers, which is what an order book is.
 */
export const buildPyramid: SceneBuilder = (THREE: ThreeLib): SceneApi => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  camera.position.set(0, 4.6, 15.5)
  camera.lookAt(0, 2.1, 0)
  const root = new THREE.Group()
  scene.add(root)
  const slabs: { mesh: THREE_NS.Group; y: number }[] = []
  const LAYERS = 7
  const H = 0.62
  const GAP = 0.08

  const make = () => {
    disposeGroup(root)
    slabs.length = 0
    const accent = themeColor('--accent', '#28df99')
    const surface = themeColor('--surface', '#ffffff')
    const line = themeColor('--line', '#262627')
    const base = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.16, 6.6), new THREE.MeshBasicMaterial({ color: line }))
    base.position.y = -0.1
    root.add(base)
    for (let i = 0; i < LAYERS; i++) {
      const rBottom = 3.0 * (1 - i / LAYERS)
      const rTop = 3.0 * (1 - (i + 1) / LAYERS)
      const geo = new THREE.CylinderGeometry(rTop, rBottom, H, 4, 1)
      geo.rotateY(Math.PI / 4)
      const g = new THREE.Group()
      g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? accent : surface })))
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: line })))
      const y = 0.08 + i * (H + GAP) + H / 2
      g.position.y = y
      root.add(g)
      slabs.push({ mesh: g, y })
    }
  }
  make()

  return {
    scene,
    camera,
    update(p, pointer) {
      root.rotation.y = 0.7 + p * Math.PI * 1.6 + pointer.x * 0.35
      root.rotation.x = pointer.y * 0.06
      slabs.forEach((s, i) => {
        s.mesh.position.y = s.y + p * 0.9 * i
      })
    },
    recolor: make,
    dispose: () => disposeGroup(root),
  }
}

export interface Tower {
  symbol: string
  bid: number
  ask: number
}

function label(THREE: ThreeLib, text: string, color: string): THREE_NS.Sprite {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 72
  const ctx = c.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = '800 44px Archivo, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text.slice(0, 10), 128, 38)
  const tex = new THREE.CanvasTexture(c)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  sprite.scale.set(1.8, 0.5, 1)
  return sprite
}

/**
 * Liquidity landscape: one pair of towers per market. Height is the USDC value resting on that side of the book
 * (green = buy side, red = sell side), all on one scale. Scrolling through the section turns the view.
 */
export function landscapeBuilder(towers: Tower[]): SceneBuilder {
  return (THREE: ThreeLib, container: HTMLElement): SceneApi => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    const root = new THREE.Group()
    scene.add(root)
    const n = Math.max(towers.length, 1)
    const max = Math.max(...towers.flatMap((t) => [t.bid, t.ask]), 1)
    const SPAN = 2.3
    const MAXH = 4.2
    // tall, narrow canvases (phones) get two rows of towers so they stay readable
    const rows = n > 4 && container.clientWidth / Math.max(container.clientHeight, 1) < 1.1 ? 2 : 1
    const cols = Math.ceil(n / rows)
    const ROWGAP = 3.0
    const spanW = cols * SPAN + 1.6

    const make = () => {
      disposeGroup(root)
      const bidC = themeColor('--success', '#08774c')
      const askC = themeColor('--danger', '#b42318')
      const line = themeColor('--line', '#262627')
      const ink = themeColor('--ink', '#262627')
      const floor = themeColor('--bg-2', '#ebe7da')
      const width = cols * SPAN + 1.2
      const plate = new THREE.Mesh(new THREE.BoxGeometry(width, 0.14, rows * ROWGAP + 0.4), new THREE.MeshBasicMaterial({ color: floor }))
      plate.position.y = -0.08
      root.add(plate)
      root.add(new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: line })).translateY(-0.08))
      towers.forEach((t, i) => {
        const row = Math.floor(i / cols)
        const col = i % cols
        const cx = (col - (Math.min(cols, n - row * cols) - 1) / 2) * SPAN
        const cz = ((rows - 1) / 2 - row) * ROWGAP
        ;([[t.bid, -0.5, bidC], [t.ask, 0.5, askC]] as const).forEach(([v, dx, color]) => {
          const h = Math.max((v / max) * MAXH, 0.04)
          const geo = new THREE.BoxGeometry(0.8, h, 0.8)
          const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }))
          m.position.set(cx + dx, h / 2, cz)
          root.add(m)
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: line }))
          e.position.copy(m.position)
          root.add(e)
        })
        const s = label(THREE, t.symbol, ink)
        s.position.set(cx, 0.05, cz + 1.25)
        root.add(s)
      })
    }
    make()

    return {
      scene,
      camera,
      update(p, pointer) {
        root.rotation.y = (p - 0.5) * 1.1 + pointer.x * 0.18
        // keep every tower in frame whatever the canvas shape: distance follows the scene width and the aspect ratio
        const half = Math.tan((camera.fov * Math.PI) / 360)
        camera.position.z = Math.max((spanW / 2) / (half * Math.max(camera.aspect, 0.4)) * 0.94, 9) + (rows - 1) * 1.5
        camera.position.y = 4.8 - p * 1.1 + pointer.y * 0.3
        camera.lookAt(0, 1.5, 0)
      },
      recolor: make,
      dispose: () => disposeGroup(root),
    }
  }
}
