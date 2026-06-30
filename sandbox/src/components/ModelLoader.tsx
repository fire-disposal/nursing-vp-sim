import { type ReactNode, Suspense } from "react"
import { useLoader } from "@react-three/fiber"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import * as THREE from "three"

interface ModelLoaderProps {
  url: string
  fallback?: ReactNode
  onLoad?: (scene: THREE.Group) => void
  [key: string]: any
}

/**
 * Loads a GLTF/GLB model with suspense + fallback.
 *
 * ```tsx
 * <ModelLoader url="/models/chair.glb" position={[1, 0, 0]} scale={0.8} />
 * ```
 *
 * When the model file is absent (dev/build without assets), the fallback
 * renders a simple coloured box so the scene never breaks.
 */
function ModelInner({ url, onLoad, ...rest }: ModelLoaderProps) {
  const gltf = useLoader(GLTFLoader, url)

  // Clone so each <Model> instance gets its own copy
  const scene = gltf.scene.clone(true)
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })

  onLoad?.(scene)
  return <primitive object={scene} {...rest} />
}

const FALLBACK_COLORS = ["#d4b898", "#a8c8e8", "#b8d4c8", "#e8c0a0", "#c8c8d0"]

/** Loads a 3D model with suspense + graceful fallback (box). */
export function ModelLoader({ url, fallback, ...rest }: ModelLoaderProps) {
  const hash = url.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  const color = FALLBACK_COLORS[hash % FALLBACK_COLORS.length]

  return (
    <Suspense fallback={
      fallback ?? (
        <mesh {...rest}>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
      )
    }>
      <ModelInner url={url} {...rest} />
    </Suspense>
  )
}
