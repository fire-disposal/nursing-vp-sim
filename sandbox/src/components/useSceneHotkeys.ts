import { useEffect } from "react"

interface HotkeyMap {
  "r"?: () => void   // reset camera
  "s"?: () => void   // screenshot
  "w"?: () => void   // toggle wireframe
  "f"?: () => void   // toggle fps
  "h"?: () => void   // toggle help
}

type Key = keyof HotkeyMap

/**
 * Keyboard shortcuts for scene development.
 *
 * ```tsx
 * useSceneHotkeys({ r: resetCamera, s: screenshot, w: toggleWireframe })
 * ```
 */
export function useSceneHotkeys(map: HotkeyMap) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLElement && e.target.tagName === "INPUT") return

      const key = e.key.toLowerCase() as Key
      const fn = map[key]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [map])
}
