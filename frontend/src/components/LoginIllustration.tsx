import lottie from "lottie-web";
import { useEffect, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";
import placeholderAnimation from "@/assets/lottie/medical-illustration.json";

export default function LoginIllustration() {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    setVisible(mql.matches);
    const handler = (e: MediaQueryListEvent) => setVisible(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!visible || !containerRef.current) return;

    const anim = lottie.loadAnimation({
      container: containerRef.current,
      animationData: placeholderAnimation,
      renderer: "canvas",
      loop: true,
      autoplay: true,
      rendererSettings: {
        clearCanvas: true,
        preserveAspectRatio: "xMidYMid meet",
        progressiveLoad: true,
      },
    });
    anim.setSubframe(false);
    animRef.current = anim;

    const ro = new ResizeObserver(() => anim.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      anim.destroy();
      animRef.current = null;
    };
  }, [visible]);

  if (!visible) return null;

  return <div ref={containerRef} className="hidden lg:block flex-1" />;
}
