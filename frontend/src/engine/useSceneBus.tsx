import { useEffect, type ReactNode } from "react";
import { useSceneStore } from "@/stores/sceneStore";
import type { MessageBus } from "./types";

export function SceneStateProvider({
  bus,
  children,
}: {
  bus: MessageBus | null;
  children: ReactNode;
}) {
  const attachBus = useSceneStore((s) => s.attachBus);
  const patchScene = useSceneStore((s) => s.patchScene);

  useEffect(() => {
    attachBus(bus);
    if (!bus) return;
    return bus.on("scene:state", patchScene);
  }, [attachBus, bus, patchScene]);

  return <>{children}</>;
}

export function useSceneStateValue() {
  return useSceneStore((s) => s.scene);
}
