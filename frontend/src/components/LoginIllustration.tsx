import lottie from "lottie-web";
import { useEffect, useRef, useState } from "react";
import placeholderAnimation from "@/assets/lottie/medical-illustration.json";

export default function LoginIllustration() {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

    return () => anim.destroy();
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="hidden lg:flex lg:w-1/2 items-center justify-center">
      <div ref={containerRef} className="w-full max-w-lg [&>canvas]:!w-full [&>canvas]:!h-auto" />
    </div>
  );
}
