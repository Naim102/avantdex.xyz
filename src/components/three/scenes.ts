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
    const line = themeColor('--ink', '#262627')
    const base = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.16, 6.6), new THREE.MeshBasicMaterial({ color: themeColor('--line-strong', '#bdbbb0') }))
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
      // tall, narrow canvases (phones) need the camera further back to keep the whole stack in frame
      camera.position.z = 15.5 / Math.min(1, camera.aspect * 0.95 + 0.15)
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
