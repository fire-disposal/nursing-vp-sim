import { useEffect, useState } from "react";
import type { LayoutDef, SlotGrid } from "./types";

type Breakpoint = "desktop" | "tablet" | "mobile";

function getBreakpoint(): Breakpoint {
  const w = window.innerWidth;
  if (w >= 1024) return "desktop";
  if (w >= 768) return "tablet";
  return "mobile";
}

export function useResponsiveLayout(layout: LayoutDef): SlotGrid {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint);

  useEffect(() => {
    const handler = () => setBp(getBreakpoint());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  if (bp === "desktop") return layout.breakpoints.desktop;
  if (bp === "tablet") return layout.breakpoints.tablet ?? layout.breakpoints.mobile;
  return layout.breakpoints.mobile;
}
